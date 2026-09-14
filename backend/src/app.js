import { createClassifier } from "./classifier.js";
import { fetchMetadata } from "./metadata.js";
import { isAllowed } from './policy.js';
import { TtlLruCache } from "./cache.js";
import { ClassroomStore } from "./classroom-store.js";
import { readFile } from "node:fs/promises";
import { WebsitePolicyService, normalizeDomain } from "./website-policy.js";
import { createWebsitePolicyRepository } from "./website-policy-repository.js";

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

const DASHBOARD_ROOT = new URL("../public/dashboard/", import.meta.url);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

async function serveDashboardAsset(response, pathname, requestId) {
  const relativePath = pathname === "/dashboard" || pathname === "/dashboard/"
    ? "index.html"
    : pathname.slice("/dashboard-assets/".length);
  if (!relativePath || relativePath.includes("..")) return json(response, 404, { error: "not_found" }, requestId);
  let body;
  try {
    body = await readFile(new URL(relativePath, DASHBOARD_ROOT));
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { error: "not_found" }, requestId);
    throw error;
  }
  const extension = relativePath.slice(relativePath.lastIndexOf("."));
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
    "Cache-Control": relativePath === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Request-Id": requestId
  });
  response.end(body);
}

function validVideoId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(value);
}

function approvedVideoIds(value) {
  const entries = value instanceof Set || Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return new Set([...entries].map(id => String(id).trim()).filter(validVideoId));
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

function normalizeWebsiteInput(body) {
  const url = typeof body?.url === "string" ? body.url.trim().slice(0, 2048) : "";
  let parsed;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error("website URL is invalid"), { status: 400 }); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("website URL must use HTTP or HTTPS"), { status: 400 });
  }
  const domain = normalizeDomain(parsed.hostname);
  if (!domain) throw Object.assign(new Error("website domain is invalid"), { status: 400 });
  return {
    url: parsed.toString(), domain,
    title: typeof body.title === "string" ? body.title.trim().slice(0, 500) : "",
    description: typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "",
    scopeContext: body.scopeContext && typeof body.scopeContext === "object" ? body.scopeContext : {}
  };
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("request body too large"), { status: 413 });
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
  const cacheMaxEntries = Number(options.cacheMaxEntries ?? process.env.CACHE_MAX_ENTRIES ?? 5000);
  const limit = Number(options.rateLimit ?? process.env.RATE_LIMIT_PER_MINUTE ?? 120);
  const approvedIds = approvedVideoIds(options.approvedVideoIds ?? process.env.APPROVED_YOUTUBE_VIDEO_IDS);
  const cache = options.cache ?? new TtlLruCache({ maxEntries: cacheMaxEntries });
  const classroom = options.classroomStore ?? new ClassroomStore({
    offlineAfterMs: Number(options.offlineAfterMs ?? process.env.DEVICE_OFFLINE_AFTER_SECONDS ?? 75) * 1000,
    maxDevices: Number(options.maxDevices ?? process.env.DASHBOARD_MAX_DEVICES ?? 500)
  });
  const websitePolicy = options.websitePolicyService ?? new WebsitePolicyService({
    repository: options.websitePolicyRepository ?? createWebsitePolicyRepository(),
    cacheTtlMs: Number(process.env.WEBSITE_CACHE_TTL_SECONDS ?? 604800) * 1000
  });
  const inFlight = new Map();
  const rate = new Map();

  return async function handler(request, response) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url, "http://study-shield.local");
    const pathname = url.pathname;
    if (request.method === "GET" && pathname === "/healthz") {
      return json(response, 200, { ok: true }, requestId);
    }
    if (request.method === "GET" && (pathname === "/dashboard" || pathname === "/dashboard/" || pathname.startsWith("/dashboard-assets/"))) {
      return serveDashboardAsset(response, pathname, requestId);
    }
    if (request.method === "GET" && pathname === "/v1/dashboard/snapshot") {
      return json(response, 200, classroom.snapshot(), requestId);
    }
    if (request.method === "GET" && pathname.startsWith("/v1/dashboard/screenshot/")) {
      const deviceId = decodeURIComponent(pathname.slice("/v1/dashboard/screenshot/".length));
      const screenshot = classroom.getScreenshot(deviceId);
      return screenshot
        ? json(response, 200, screenshot, requestId)
        : json(response, 404, { error: "screenshot_not_found" }, requestId);
    }
    if (request.method === "POST" && pathname === "/v1/telemetry/heartbeat") {
      if (token && request.headers.authorization !== `Bearer ${token}`) {
        return json(response, 401, { error: "unauthorized" }, requestId);
      }
      try {
        return json(response, 200, { ok: true, device: classroom.report(await readJson(request)) }, requestId);
      } catch (error) {
        return json(response, error.status ?? 500, { error: error.status ? error.message : "telemetry_unavailable" }, requestId);
      }
    }
    if (request.method === "POST" && pathname === "/v1/telemetry/screenshot") {
      if (token && request.headers.authorization !== `Bearer ${token}`) {
        return json(response, 401, { error: "unauthorized" }, requestId);
      }
      try {
        const body = await readJson(request, 1_600_000);
        classroom.saveScreenshot(body.deviceId, body.dataUrl, body.capturedAt);
        return json(response, 200, { ok: true }, requestId);
      } catch (error) {
        return json(response, error.status ?? 500, { error: error.status ? error.message : "screenshot_unavailable" }, requestId);
      }
    }
    if (request.method === "POST" && pathname === "/v1/classify/website") {
      if (token && request.headers.authorization !== `Bearer ${token}`) {
        return json(response, 401, { error: "unauthorized" }, requestId);
      }
      try {
        const site = normalizeWebsiteInput(await readJson(request));
        const decision = await websitePolicy.decide(site, site.scopeContext);
        console.info(JSON.stringify({ event: "website_classification", requestId, domain: site.domain, ...decision }));
        return json(response, 200, decision, requestId);
      } catch (error) {
        const status = error.status ?? (error.message?.includes("required") ? 503 : 500);
        const publicMessage = status < 500 ? error.message : "website_classification_unavailable";
        console.error(JSON.stringify({ requestId, error: error.message }));
        return json(response, status, { error: publicMessage }, requestId);
      }
    }
    if (request.method === "POST" && pathname === "/v1/policies/website/rules") {
      if (token && request.headers.authorization !== `Bearer ${token}`) {
        return json(response, 401, { error: "unauthorized" }, requestId);
      }
      try {
        const rule = await websitePolicy.saveRule(await readJson(request));
        console.info(JSON.stringify({ event: "website_rule_saved", requestId, rule }));
        return json(response, 201, { rule }, requestId);
      } catch (error) {
        return json(response, error.status ?? 500, { error: error.status ? error.message : "website_rule_unavailable" }, requestId);
      }
    }
    if (request.method !== "POST" || pathname !== "/v1/classify/youtube") {
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
      if (approvedIds.has(video.videoId)) {
        const value = {
          allowed: true,
          category: "educational",
          confidence: 1,
          reason: "This video is approved by school policy.",
          videoId: video.videoId,
          title: video.title,
          metadataSource: "policy_override",
          policyVersion: "3"
        };
        console.info(JSON.stringify({ event: "classification", requestId, ...value }));
        return json(response, 200, { ...value, cached: false }, requestId);
      }
      const cacheKey = `youtube:${video.videoId}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        console.info(JSON.stringify({ event: "cache_hit", requestId, videoId: video.videoId }));
        return json(response, 200, { ...cached, cached: true }, requestId);
      }

      const pending = inFlight.get(cacheKey);
      if (pending) {
        const value = await pending;
        console.info(JSON.stringify({ event: "cache_coalesced", requestId, videoId: video.videoId }));
        return json(response, 200, { ...value, cached: true }, requestId);
      }

      const classificationTask = (async () => {
        const metadata = await resolveMetadata(video);
        const classification = await classifier(metadata);
        const allowed = isAllowed(classification.category, allowUncertain);
        const value = { allowed, ...classification, videoId: video.videoId, title: metadata.title, metadataSource: metadata.metadataSource, policyVersion: '3' };
        console.info(JSON.stringify({ event: 'classification', requestId, ...value }));
        const resultTtl = classification.category === 'uncertain' ? Math.min(ttlMs, 60000) : ttlMs;
        cache.set(cacheKey, value, resultTtl);
        return value;
      })();
      inFlight.set(cacheKey, classificationTask);
      try {
        const value = await classificationTask;
        return json(response, 200, { ...value, cached: false }, requestId);
      } finally {
        if (inFlight.get(cacheKey) === classificationTask) inFlight.delete(cacheKey);
      }
    } catch (error) {
      const status = error.status ?? (error.message?.includes("required") ? 503 : 500);
      const publicMessage = status < 500 ? error.message : "classification_unavailable";
      console.error(JSON.stringify({ requestId, error: error.message }));
      return json(response, status, { error: publicMessage }, requestId);
    }
  };
}
