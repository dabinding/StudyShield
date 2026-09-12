const DEFAULT_CONFIG = {
  apiBaseUrl: "http://localhost:8787",
  apiToken: "",
  failMode: "closed",
  timeoutMs: 25000
};

async function getConfig() {
  const [managed, local] = await Promise.all([
    chrome.storage.managed.get(null).catch(() => ({})),
    chrome.storage.local.get(DEFAULT_CONFIG)
  ]);
  return { ...DEFAULT_CONFIG, ...local, ...managed };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CLASSIFY_YOUTUBE_VIDEO") return false;
  classify(message.video).then(sendResponse);
  return true;
});

async function classify(video) {
  const config = await getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/v1/classify/youtube`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiToken ? { "Authorization": `Bearer ${config.apiToken}` } : {})
      },
      body: JSON.stringify(video),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Study Shield API returned ${response.status}`);
    return { ok: true, decision: await response.json() };
  } catch (error) {
    return {
      ok: false,
      decision: {
        allowed: config.failMode === "open",
        category: "unavailable",
        confidence: 0,
        reason: config.failMode === "open"
          ? "The classifier is unavailable; playback is temporarily allowed."
          : "The classifier is unavailable; playback is temporarily blocked."
      },
      error: error.message
    };
  } finally {
    clearTimeout(timer);
  }
}
