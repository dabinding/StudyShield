import { createClassifier } from "./classifier.js";
import { fetchMetadata } from "./metadata.js";

const MAX_BODY_BYTES = 64 * 1024;

function json(response, status, body, requestId) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId
  });
  response.end(JSON.stringify(body));
}

function validVideoId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

function normalizeInput(body) {
  if (!validVideoId(body?.videoId)) throw Object.assign(new Error("videoId is invalid"), { status: 400 });
  return {
    videoId: body.videoId,
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 500) : '',
    description: typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "",
    url: typeof body.url === "string" ? body.url.slice(0, 2048) : ""
  };
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

export function createHandler(options = {}) {
  const classifier = options.classifier ?? createClassifier();
  const resolveMetadata = options.resolveMetadata ?? fetchMetadata;
  const allowUncertain = options.allowUncertain ?? process.env.ALLOW_UNCERTAIN === "true";
  const token = options.token ?? process.env.STUDY_SHIELD_API_TOKEN ?? "";
  const ttlMs = Number(options.cacheTtlMs ?? (Number(process.env.CACHE_TTL_SECONDS ?? 86400) * 1000));
  const limit = Number(options.rateLimit ?? process.env.RATE_LIMIT_PER_MINUTE ?? 120);
  const cache = new Map();
  const rate = new Map();

  return async function handler(request, response) {
    const requestId = crypto.randomUUID();
    if (request.method === "GET" && request.url === "/healthz") {
      return json(response, 200, { ok: true }, requestId);
    }
    if (request.method !== "POST" || request.url !== "/v1/classify/youtube") {
      return json(response, 404, { error: "not_found" }, requestId);
    }
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      return json(response, 401, { error: "unauthorized" }, requestId);
    }

    const ip = request.socket.remoteAddress ?? "unknown";
    const minute = Math.floor(Date.now() / 60_000);
    const rateKey = `${ip}:${minute}`;
    const count = (rate.get(rateKey) ?? 0) + 1;
    rate.set(rateKey, count);
    if (count > limit) return json(response, 429, { error: "rate_limited" }, requestId);

    try {
      const video = normalizeInput(await readJson(request));
      const cached = cache.get(video.videoId);
      if (cached && cached.expiresAt > Date.now()) {
        return json(response, 200, { ...cached.value, cached: true }, requestId);
      }

      const metadata = await resolveMetadata(video);
      const classification = await classifier(metadata);
      const allowed = classification.category === "educational" ||
        (classification.category === "uncertain" && allowUncertain);
      const value = { allowed, ...classification, videoId: video.videoId, title: metadata.title, metadataSource: metadata.metadataSource, policyVersion: '2' };
      console.info(JSON.stringify({ event: 'classification', requestId, ...value }));
      cache.set(video.videoId, { value, expiresAt: Date.now() + (classification.category === 'uncertain' ? Math.min(ttlMs, 60000) : ttlMs) });
      return json(response, 200, { ...value, cached: false }, requestId);
    } catch (error) {
      const status = error.status ?? (error.message?.includes("required") ? 503 : 500);
      const publicMessage = status < 500 ? error.message : "classification_unavailable";
      console.error(JSON.stringify({ requestId, error: error.message }));
      return json(response, status, { error: publicMessage }, requestId);
    }
  };
}
