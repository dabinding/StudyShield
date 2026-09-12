import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHandler } from "../src/app.js";

async function invoke(handler, { body, token = "" }) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = "POST";
  request.url = "/v1/classify/youtube";
  request.headers = token ? { authorization: `Bearer ${token}` } : {};
  request.socket = { remoteAddress: "127.0.0.1" };
  const result = {};
  const response = {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(data) { result.body = JSON.parse(data); }
  };
  await handler(request, response);
  return result;
}

test("classifies and caches a video", async () => {
  let calls = 0;
  const handler = createHandler({
    token: "test-token",
    resolveMetadata: async video => ({ ...video, title: 'Algebra lesson', description: 'Equations' }),
    classifier: async () => {
      calls += 1;
      return { category: "educational", confidence: 0.95, reason: "It teaches algebra." };
    }
  });

  const input = { body: { videoId: "abc123XYZ_-", title: "Algebra lesson", description: "Equations" }, token: "test-token" };
  const first = await invoke(handler, input);
  const second = await invoke(handler, input);
  assert.equal(first.body.allowed, true);
  assert.equal(first.body.cached, false);
  assert.equal(second.body.cached, true);
  assert.equal(calls, 1);
});

test("rejects an invalid video id", async () => {
  const handler = createHandler({ classifier: async () => assert.fail("should not classify") });
  const response = await invoke(handler, { body: { videoId: "!", title: "Anything" } });
  assert.equal(response.status, 400);
});

test("allows a school-approved classroom video without calling the classifier", async () => {
  const videoId = "HtxOsOuY7hA";
  const handler = createHandler({
    approvedVideoIds: new Set([videoId]),
    resolveMetadata: async () => assert.fail("should not fetch metadata for an approved video"),
    classifier: async () => assert.fail("should not classify an approved video")
  });

  const response = await invoke(handler, { body: { videoId } });
  assert.equal(response.status, 200);
  assert.equal(response.body.allowed, true);
  assert.equal(response.body.category, "educational");
  assert.equal(response.body.metadataSource, "policy_override");
});
