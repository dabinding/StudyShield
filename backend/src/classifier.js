const CLASSIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "confidence", "reason"],
  properties: {
    category: {
      type: "string",
      enum: ["educational", "non_educational", "uncertain"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 240 }
  }
};

const INSTRUCTIONS = `You classify YouTube videos for a K-12 school content filter.
Use only the supplied title and description. A video is educational when its primary purpose is teaching, explaining, demonstrating an academic or vocational skill, documenting a subject for learning, or supporting a classroom assignment. Entertainment, gameplay, music videos, comedy, reactions, celebrity content, sports highlights, and general amusement are non-educational even if the viewer might learn something incidentally. Do not infer facts absent from the metadata. Use uncertain when the metadata is too sparse or ambiguous. Return a short, plain-language reason that does not mention hidden policies.`;

export function normalizeResult(result) {
  const category = ["educational", "non_educational", "uncertain"].includes(result?.category)
    ? result.category
    : "uncertain";
  const confidence = Number.isFinite(result?.confidence)
    ? Math.min(1, Math.max(0, result.confidence))
    : 0;
  const reason = typeof result?.reason === "string" && result.reason.trim()
    ? result.reason.trim().slice(0, 240)
    : "The available metadata was insufficient for a reliable decision.";
  return { category, confidence, reason };
}

export function heuristicClassify({ title, description }) {
  const text = `${title} ${description}`.toLowerCase();
  const educational = [
    "tutorial", "lesson", "lecture", "explained", "how to", "course",
    "mathematics", "math", "science", "history", "grammar", "coding",
    "programming", "educational", "documentary", "classroom"
  ];
  const entertainment = [
    "gameplay", "walkthrough", "let's play", "lets play", "music video",
    "prank", "reaction", "funny moments", "trailer", "speedrun", "gaming"
  ];
  const eduHits = educational.filter((term) => text.includes(term)).length;
  const entertainmentHits = entertainment.filter((term) => text.includes(term)).length;

  if (eduHits > entertainmentHits && eduHits > 0) {
    return { category: "educational", confidence: 0.55, reason: "Educational keywords were found in the video metadata." };
  }
  if (entertainmentHits > eduHits && entertainmentHits > 0) {
    return { category: "non_educational", confidence: 0.55, reason: "Entertainment-focused keywords were found in the video metadata." };
  }
  return { category: "uncertain", confidence: 0.2, reason: "The title and description do not clearly establish an educational purpose." };
}

export async function openAIClassify(video, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.4-nano";
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required when CLASSIFIER_MODE=openai");

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: INSTRUCTIONS,
      input: JSON.stringify({
        videoId: video.videoId,
        title: video.title,
        description: video.description
      }),
      text: {
        format: {
          type: "json_schema",
          name: "youtube_education_classification",
          strict: true,
          schema: CLASSIFICATION_SCHEMA
        }
      }
    }),
    signal: AbortSignal.timeout(12_000)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`OpenAI request failed (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  if (!payload.output_text) throw new Error("OpenAI response did not contain output_text");
  return normalizeResult(JSON.parse(payload.output_text));
}

export function createClassifier(mode = process.env.CLASSIFIER_MODE ?? "openai") {
  if (mode === "heuristic") return async (video) => heuristicClassify(video);
  if (mode === "openai") return openAIClassify;
  throw new Error(`Unsupported CLASSIFIER_MODE: ${mode}`);
}
