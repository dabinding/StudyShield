const DEFAULT_CONFIG = {
  apiBaseUrl: "http://localhost:8787", apiToken: "", failMode: "closed", timeoutMs: 25000,
  studentName: "", deviceLabel: "", screenshotEnabled: false, screenshotIntervalSeconds: 60,
  policyContext: {}
};
const HEARTBEAT_ALARM = "study-shield-heartbeat";
const GAME_TERMS = ["minecraft", "roblox", "fortnite", "call of duty", "gameplay", "gaming", "speedrun", "let's play"];
let latestDecision = null;
let latestPolicyEvent = null;
let lastActivityAt = Date.now();
let lastScreenshotAt = 0;
let heartbeatTimer = null;

async function getConfig() {
  const [managed, local] = await Promise.all([
    chrome.storage.managed.get(null).catch(() => ({})), chrome.storage.local.get(DEFAULT_CONFIG)
  ]);
  return { ...DEFAULT_CONFIG, ...local, ...managed };
}

async function getDeviceId() {
  const stored = await chrome.storage.local.get("studyShieldDeviceId");
  if (stored.studyShieldDeviceId) return stored.studyShieldDeviceId;
  const deviceId = `device-${crypto.randomUUID()}`;
  await chrome.storage.local.set({ studyShieldDeviceId: deviceId });
  return deviceId;
}

function apiHeaders(config) {
  return { "Content-Type": "application/json", ...(config.apiToken ? { "Authorization": `Bearer ${config.apiToken}` } : {}) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CLASSIFY_YOUTUBE_VIDEO") {
    classify(message.video, sender.tab).then(sendResponse);
    return true;
  }
  if (message?.type === "CLASSIFY_WEBSITE") {
    classifyWebsite(message.site, sender.tab).then(sendResponse);
    return true;
  }
  if (message?.type === "REPORT_POLICY_EVENT") {
    recordPolicyEvent(message.event, sender.tab);
    scheduleHeartbeat(0);
    sendResponse({ ok: true });
  }
  return false;
});

async function classify(video, tab) {
  const config = await getConfig();
  latestDecision = { tabId: tab?.id, url: tab?.url, state: "checking", checkedAt: Date.now() };
  scheduleHeartbeat(0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let result;
  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/v1/classify/youtube`, {
      method: "POST", headers: apiHeaders(config), body: JSON.stringify(video), signal: controller.signal
    });
    if (!response.ok) throw new Error(`Study Shield API returned ${response.status}`);
    result = { ok: true, decision: await response.json() };
  } catch (error) {
    result = {
      ok: false,
      decision: {
        allowed: config.failMode === "open", category: "unavailable", confidence: 0,
        reason: config.failMode === "open"
          ? "The classifier is unavailable; playback is temporarily allowed."
          : "The classifier is unavailable; playback is temporarily blocked."
      },
      error: error.message
    };
  } finally {
    clearTimeout(timer);
  }

  const decisionText = `${result.decision?.title ?? ""} ${result.decision?.reason ?? ""}`.toLowerCase();
  latestDecision = {
    tabId: tab?.id, url: tab?.url, state: result.ok ? "complete" : "unavailable",
    category: result.decision?.category, confidence: result.decision?.confidence,
    cached: result.decision?.cached, reason: result.decision?.reason,
    blocked: !result.decision?.allowed,
    gameDetected: GAME_TERMS.some(term => decisionText.includes(term)), checkedAt: Date.now()
  };
  if (latestDecision.blocked) {
    latestPolicyEvent = {
      eventId: crypto.randomUUID(), violation: true, at: Date.now(),
      reason: latestDecision.reason, category: latestDecision.category
    };
  }
  scheduleHeartbeat(0);
  return result;
}

async function classifyWebsite(site, tab) {
  const config = await getConfig();
  try {
    if (new URL(site.url).origin === new URL(config.apiBaseUrl).origin) {
      return { ok: true, decision: { allowed: true, category: "school_resource", confidence: 1, reason: "Study Shield service page." } };
    }
  } catch { /* The API validates the page URL. */ }

  const previousDecision = latestDecision;
  latestDecision = { tabId: tab?.id, url: tab?.url, state: "checking", checkedAt: Date.now() };
  scheduleHeartbeat(0);
  let result;
  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/v1/classify/website`, {
      method: "POST", headers: apiHeaders(config),
      body: JSON.stringify({ ...site, scopeContext: config.policyContext ?? {} })
    });
    if (!response.ok) throw new Error(`Study Shield website API returned ${response.status}`);
    result = { ok: true, decision: await response.json() };
  } catch (error) {
    result = {
      ok: false,
      decision: {
        allowed: config.failMode === "open", category: "unavailable", confidence: 0,
        reason: config.failMode === "open"
          ? "Website checking is temporarily unavailable."
          : "Website checking is temporarily unavailable."
      },
      error: error.message
    };
  }
  const decisionText = `${site.title ?? ""} ${site.domain ?? ""} ${result.decision?.reason ?? ""}`.toLowerCase();
  const nextDecision = {
    tabId: tab?.id, url: tab?.url, state: result.ok ? "complete" : "unavailable",
    category: result.decision?.category, confidence: result.decision?.confidence,
    cached: result.decision?.cached, reason: result.decision?.reason,
    blocked: !result.decision?.allowed,
    gameDetected: GAME_TERMS.some(term => decisionText.includes(term)), checkedAt: Date.now()
  };
  const repeatedBlock = previousDecision?.blocked === true &&
    previousDecision.tabId === nextDecision.tabId && previousDecision.url === nextDecision.url &&
    previousDecision.category === nextDecision.category && previousDecision.reason === nextDecision.reason;
  latestDecision = nextDecision;
  if (latestDecision.blocked && !repeatedBlock) {
    latestPolicyEvent = {
      eventId: crypto.randomUUID(), violation: true, at: Date.now(),
      reason: latestDecision.reason, category: latestDecision.category
    };
  }
  scheduleHeartbeat(0);
  return result;
}

function recordPolicyEvent(event = {}, tab) {
  latestDecision = {
    tabId: tab?.id, url: tab?.url, state: event.aiState ?? "not_applicable",
    category: event.category ?? "policy", confidence: null, cached: false,
    reason: event.reason ?? "Blocked by school policy.", blocked: event.blocked === true,
    gameDetected: event.gameDetected === true, checkedAt: Date.now()
  };
  latestPolicyEvent = {
    eventId: crypto.randomUUID(), violation: event.violation === true,
    at: Date.now(), reason: latestDecision.reason, category: latestDecision.category
  };
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] ?? null;
}

async function idleState() {
  try { return await chrome.idle.queryState(60); } catch { return "unknown"; }
}

async function deviceHealth() {
  const [platform, memory] = await Promise.all([
    chrome.runtime.getPlatformInfo().catch(() => ({})),
    chrome.system?.memory?.getInfo().catch(() => null)
  ]);
  return {
    status: "healthy", platform: [platform.os, platform.arch].filter(Boolean).join(" "),
    extensionVersion: chrome.runtime.getManifest().version, memoryCapacityBytes: memory?.capacity ?? null
  };
}

function tabActivity(tab) {
  let domain = "";
  try { domain = new URL(tab?.url ?? "").hostname; } catch { /* restricted browser page */ }
  const matchingDecision = latestDecision && latestDecision.tabId === tab?.id;
  return {
    activity: { title: tab?.title ?? "", url: tab?.url ?? "", domain, category: matchingDecision ? latestDecision.category ?? "web" : "web" },
    decision: matchingDecision ? latestDecision : null
  };
}

async function reportHeartbeat() {
  const config = await getConfig();
  const [deviceId, tab, idle, health] = await Promise.all([getDeviceId(), activeTab(), idleState(), deviceHealth()]);
  const { activity, decision } = tabActivity(tab);
  if (idle === "active") lastActivityAt = Date.now();
  const connection = navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection;
  const payload = {
    deviceId, studentName: config.studentName, deviceLabel: config.deviceLabel,
    lastActivityAt, idleState: idle, blocked: decision?.blocked === true,
    gameDetected: decision?.gameDetected === true, activity,
    aiStatus: decision ? {
      state: decision.state, category: decision.category, confidence: decision.confidence,
      cached: decision.cached, reason: decision.reason, checkedAt: decision.checkedAt
    } : { state: "not_applicable" },
    policyEvent: latestPolicyEvent,
    network: { online: navigator.onLine !== false, effectiveType: connection?.effectiveType ?? "unknown" },
    deviceHealth: health,
    screenshotStatus: config.screenshotEnabled ? "enabled_no_capture" : "disabled_by_policy"
  };

  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/v1/telemetry/heartbeat`, {
      method: "POST", headers: apiHeaders(config), body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Telemetry API returned ${response.status}`);
    if (config.screenshotEnabled) await maybeCaptureScreenshot(config, deviceId, tab);
  } catch (error) {
    console.warn("[Study Shield] Telemetry heartbeat failed", error.message);
  }
}

async function maybeCaptureScreenshot(config, deviceId, tab) {
  const intervalMs = Math.max(60, Number(config.screenshotIntervalSeconds) || 60) * 1000;
  if (!tab?.windowId || Date.now() - lastScreenshotAt < intervalMs) return;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 30 });
    if (dataUrl.length > 1_500_000) throw new Error("Captured image is too large");
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/v1/telemetry/screenshot`, {
      method: "POST", headers: apiHeaders(config), body: JSON.stringify({ deviceId, dataUrl, capturedAt: Date.now() })
    });
    if (!response.ok) throw new Error(`Screenshot API returned ${response.status}`);
    lastScreenshotAt = Date.now();
  } catch (error) {
    console.warn("[Study Shield] Screen preview capture failed", error.message);
  }
}

function scheduleHeartbeat(delay = 500) {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => reportHeartbeat().catch(error => console.warn("[Study Shield] Telemetry failed", error.message)), delay);
}

async function ensureHeartbeatAlarm() {
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === HEARTBEAT_ALARM) scheduleHeartbeat(0); });
chrome.tabs.onActivated.addListener(() => { lastActivityAt = Date.now(); scheduleHeartbeat(); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && latestDecision?.tabId === tabId && latestDecision.url !== changeInfo.url) latestDecision = null;
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") { lastActivityAt = Date.now(); scheduleHeartbeat(); }
});
chrome.idle.onStateChanged.addListener(() => scheduleHeartbeat(0));
chrome.runtime.onInstalled.addListener(() => { ensureHeartbeatAlarm(); scheduleHeartbeat(0); });
chrome.runtime.onStartup.addListener(() => { ensureHeartbeatAlarm(); scheduleHeartbeat(0); });
ensureHeartbeatAlarm();
scheduleHeartbeat(0);
