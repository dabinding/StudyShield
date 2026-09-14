import test from "node:test";
import assert from "node:assert/strict";
import { WebsitePolicyService, normalizeDomain } from "../src/website-policy.js";
import { InMemoryWebsitePolicyRepository } from "../src/website-policy-repository.js";

const site = { url: "https://learn.example.org/lesson?unit=2", domain: "learn.example.org", title: "Lesson", description: "Academic material" };
const context = { state: "NY", district: "district-1", school: "school-1", classIds: ["class-a"], teacher: "teacher-1", student: "student-1" };

test("domain normalization removes www and URL paths", () => {
  assert.equal(normalizeDomain("https://www.Example.org/path"), "example.org");
  assert.equal(normalizeDomain("not a domain"), "");
});

test("blacklist at any matching scope wins over a lower-level whitelist", async () => {
  const repository = new InMemoryWebsitePolicyRepository({ rules: [
    { id: "state-block", scopeType: "state", scopeId: "NY", action: "blacklist", matchType: "suffix", pattern: "games.example.org" },
    { id: "student-allow", scopeType: "student", scopeId: "student-1", action: "whitelist", matchType: "exact", pattern: "games.example.org" }
  ] });
  const service = new WebsitePolicyService({ repository, classifier: async () => assert.fail("policy should decide") });
  const decision = await service.decide({ ...site, domain: "games.example.org" }, context);
  assert.equal(decision.allowed, false);
  assert.equal(decision.matchedRule.id, "state-block");
});

test("most-specific whitelist allows a matching website", async () => {
  const repository = new InMemoryWebsitePolicyRepository({ rules: [
    { id: "school-allow", scopeType: "school", scopeId: "school-1", action: "whitelist", matchType: "suffix", pattern: "learn.example.org" },
    { id: "teacher-allow", scopeType: "teacher", scopeId: "teacher-1", action: "whitelist", matchType: "exact", pattern: "learn.example.org" }
  ] });
  const service = new WebsitePolicyService({ repository, classifier: async () => assert.fail("policy should decide") });
  const decision = await service.decide(site, context);
  assert.equal(decision.allowed, true);
  assert.equal(decision.matchedRule.id, "teacher-allow");
});

test("unruled websites are classified once and served from cache", async () => {
  let calls = 0;
  const repository = new InMemoryWebsitePolicyRepository();
  const service = new WebsitePolicyService({
    repository,
    classifier: async () => { calls += 1; return { category: "educational", confidence: 0.91, reason: "Academic content." }; }
  });
  const first = await service.decide(site, context);
  const second = await service.decide({ ...site, url: "https://learn.example.org/another-page" }, context);
  assert.equal(first.allowed, true);
  assert.equal(first.source, "ai");
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test("saving a rule clears the local classification cache", async () => {
  const repository = new InMemoryWebsitePolicyRepository();
  const service = new WebsitePolicyService({
    repository,
    classifier: async () => ({ category: "educational", confidence: 0.91, reason: "Academic content." })
  });
  await service.decide(site, context);
  const rule = await service.saveRule({ scopeType: "district", scopeId: "district-1", action: "blacklist", matchType: "suffix", pattern: "learn.example.org" });
  const decision = await service.decide(site, context);
  assert.equal(rule.scopeType, "district");
  assert.equal(decision.allowed, false);
  assert.equal(decision.source, "policy");
});
