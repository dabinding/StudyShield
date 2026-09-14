import { TtlLruCache } from "./cache.js";
import { createWebsiteClassifier } from "./classifier.js";

export const SCOPE_ORDER = ["global", "state", "district", "school", "class", "teacher", "student"];

export function normalizeDomain(value) {
  let hostname = String(value ?? "").trim().toLowerCase();
  if (!hostname) return "";
  try {
    hostname = new URL(hostname.includes("://") ? hostname : `https://${hostname}`).hostname;
  } catch {
    return "";
  }
  return hostname.replace(/^www\./, "").replace(/\.$/, "");
}

export function normalizeScopeContext(context = {}) {
  const text = value => typeof value === "string" ? value.trim().slice(0, 160) : "";
  const classes = Array.isArray(context.classIds)
    ? context.classIds.map(text).filter(Boolean).slice(0, 30)
    : text(context.classIds).split(",").map(value => value.trim()).filter(Boolean).slice(0, 30);
  return {
    state: text(context.state).toUpperCase(), district: text(context.district), school: text(context.school),
    classIds: classes, teacher: text(context.teacher), student: text(context.student)
  };
}

export function matchingScopes(context) {
  const normalized = normalizeScopeContext(context);
  return [
    { type: "global", ids: ["global"] },
    ...(normalized.state ? [{ type: "state", ids: [normalized.state] }] : []),
    ...(normalized.district ? [{ type: "district", ids: [normalized.district] }] : []),
    ...(normalized.school ? [{ type: "school", ids: [normalized.school] }] : []),
    ...(normalized.classIds.length ? [{ type: "class", ids: normalized.classIds }] : []),
    ...(normalized.teacher ? [{ type: "teacher", ids: [normalized.teacher] }] : []),
    ...(normalized.student ? [{ type: "student", ids: [normalized.student] }] : [])
  ];
}

export function ruleMatchesDomain(rule, domain) {
  const pattern = normalizeDomain(rule.pattern);
  if (!pattern) return false;
  if (rule.matchType === "exact") return domain === pattern;
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

export function normalizeWebsiteRule(input = {}) {
  const scopeType = SCOPE_ORDER.includes(input.scopeType) ? input.scopeType : "";
  const scopeId = typeof input.scopeId === "string" ? input.scopeId.trim().slice(0, 160) : "";
  const action = ["blacklist", "whitelist"].includes(input.action) ? input.action : "";
  const matchType = ["exact", "suffix"].includes(input.matchType) ? input.matchType : "suffix";
  const pattern = normalizeDomain(input.pattern);
  if (!scopeType || !scopeId || !action || !pattern) {
    throw Object.assign(new Error("website rule is invalid"), { status: 400 });
  }
  if (scopeType === "global" && scopeId !== "global") {
    throw Object.assign(new Error("global rules must use scopeId global"), { status: 400 });
  }
  return { scopeType, scopeId, action, matchType, pattern, active: input.active !== false };
}

function specificity(rule) {
  return SCOPE_ORDER.indexOf(rule.scopeType);
}

export class WebsitePolicyService {
  constructor({ repository, classifier = createWebsiteClassifier(), cache = new TtlLruCache({ maxEntries: 100_000 }), now = Date.now, cacheTtlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    if (!repository) throw new Error("A website policy repository is required");
    this.repository = repository;
    this.classifier = classifier;
    this.cache = cache;
    this.now = now;
    this.cacheTtlMs = cacheTtlMs;
    this.inFlight = new Map();
  }

  async decide(site, context) {
    const domain = normalizeDomain(site.domain || site.url);
    if (!domain) throw Object.assign(new Error("website domain is invalid"), { status: 400 });
    const normalizedContext = normalizeScopeContext(context);
    const rules = await this.repository.findRules(matchingScopes(normalizedContext));
    const matches = rules.filter(rule => ruleMatchesDomain(rule, domain));
    const blacklists = matches.filter(rule => rule.action === "blacklist").sort((a, b) => specificity(b) - specificity(a));
    if (blacklists.length) return this.ruleDecision(domain, blacklists[0], false);
    const whitelists = matches.filter(rule => rule.action === "whitelist").sort((a, b) => specificity(b) - specificity(a));
    if (whitelists.length) return this.ruleDecision(domain, whitelists[0], true);

    const localKey = `website:${domain}`;
    const local = this.cache.get(localKey);
    if (local) return { ...local, cached: true, source: "cache" };
    const persistent = await this.repository.getClassification(domain, this.now());
    if (persistent) {
      const value = { ...persistent, domain, cached: true, source: "cache" };
      this.cache.set(localKey, value, Math.max(1_000, persistent.expiresAt - this.now()));
      return value;
    }

    const pending = this.inFlight.get(localKey);
    if (pending) return { ...(await pending), cached: true, source: "cache" };
    const task = this.classifyAndCache(site, domain, localKey);
    this.inFlight.set(localKey, task);
    try {
      return await task;
    } finally {
      if (this.inFlight.get(localKey) === task) this.inFlight.delete(localKey);
    }
  }

  async saveRule(input) {
    const rule = normalizeWebsiteRule(input);
    const saved = await this.repository.saveRule(rule);
    this.cache.clear();
    return saved;
  }

  ruleDecision(domain, rule, allowed) {
    return {
      allowed, domain, category: allowed ? "educational" : "non_educational", confidence: 1,
      reason: `This website is ${allowed ? "allowed" : "blocked"} by a ${rule.scopeType} policy rule.`,
      source: "policy", cached: false,
      matchedRule: { id: rule.id, scopeType: rule.scopeType, scopeId: rule.scopeId, action: rule.action, pattern: rule.pattern }
    };
  }

  async classifyAndCache(site, domain, key) {
    const classification = await this.classifier({ ...site, domain });
    const value = {
      allowed: classification.category === "educational", domain, ...classification,
      source: "ai", cached: false, checkedAt: this.now(), expiresAt: this.now() + this.cacheTtlMs
    };
    await this.repository.saveClassification(value);
    this.cache.set(key, value, this.cacheTtlMs);
    return value;
  }
}
