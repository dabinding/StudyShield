import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHandler } from "../src/app.js";
import { WebsitePolicyService } from "../src/website-policy.js";
import { InMemoryWebsitePolicyRepository } from "../src/website-policy-repository.js";

async function request(handler, { method = "GET", url, body, token = "" }) {
  const input = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const incoming = Readable.from(input);
  incoming.method = method;
  incoming.url = url;
  incoming.headers = token ? { authorization: `Bearer ${token}` } : {};
  incoming.socket = { remoteAddress: "127.0.0.1" };
  const result = {};
  const response = {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(data) { result.body = data ? JSON.parse(data.toString()) : null; }
  };
  await handler(incoming, response);
  return result;
}

test("telemetry heartbeat appears in the open teacher dashboard snapshot", async () => {
  const handler = createHandler({ token: "device-token" });
  const heartbeat = await request(handler, {
    method: "POST", url: "/v1/telemetry/heartbeat", token: "device-token",
    body: {
      deviceId: "device-test-01", studentName: "Taylor", deviceLabel: "Chromebook 3",
      idleState: "active", blocked: false,
      activity: { title: "Geometry lesson", url: "https://youtube.com/watch?v=test", domain: "youtube.com", category: "educational" },
      network: { online: true, effectiveType: "4g" },
      deviceHealth: { status: "healthy", platform: "cros", extensionVersion: "0.2.0" }
    }
  });
  assert.equal(heartbeat.status, 200);

  const snapshot = await request(handler, { url: "/v1/dashboard/snapshot" });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.summary.online, 1);
  assert.equal(snapshot.body.devices[0].studentName, "Taylor");
  assert.equal(snapshot.body.devices[0].activity.category, "educational");
});

test("telemetry writes still require the extension API token", async () => {
  const handler = createHandler({ token: "device-token" });
  const response = await request(handler, {
    method: "POST", url: "/v1/telemetry/heartbeat", body: { deviceId: "device-test-02" }
  });
  assert.equal(response.status, 401);
});

test("website rule API evaluates policy before the classifier", async () => {
  const websitePolicyService = new WebsitePolicyService({
    repository: new InMemoryWebsitePolicyRepository(),
    classifier: async () => assert.fail("matching policy should decide")
  });
  const handler = createHandler({ token: "device-token", websitePolicyService });
  const rule = await request(handler, {
    method: "POST", url: "/v1/policies/website/rules", token: "device-token",
    body: { scopeType: "school", scopeId: "school-1", action: "blacklist", pattern: "games.example.org" }
  });
  assert.equal(rule.status, 201);

  const decision = await request(handler, {
    method: "POST", url: "/v1/classify/website", token: "device-token",
    body: { url: "https://games.example.org/play", title: "Game", scopeContext: { school: "school-1" } }
  });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.allowed, false);
  assert.equal(decision.body.source, "policy");
});

test("website rules can be listed and edited for the policy dashboard", async () => {
  const repository = new InMemoryWebsitePolicyRepository({ rules: [] });
  const websitePolicyService = new WebsitePolicyService({ repository, classifier: async () => ({ category: "uncertain", confidence: 0, reason: "unused" }) });
  const handler = createHandler({ token: "teacher-token", websitePolicyService });
  const created = await request(handler, {
    method: "POST", url: "/v1/policies/website/rules", token: "teacher-token",
    body: { scopeType: "global", scopeId: "global", action: "blacklist", matchType: "suffix", pattern: "games.example.org" }
  });
  assert.equal(created.status, 201);

  const listed = await request(handler, { url: "/v1/policies/website/rules" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.rules.length, 1);
  assert.equal(listed.body.rules[0].pattern, "games.example.org");

  const updated = await request(handler, {
    method: "PUT", url: `/v1/policies/website/rules/${created.body.rule.id}`, token: "teacher-token",
    body: { ...created.body.rule, action: "whitelist", active: false }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.rule.action, "whitelist");
  assert.equal(updated.body.rule.active, false);
});
