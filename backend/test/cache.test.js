import test from "node:test";
import assert from "node:assert/strict";
import { TtlLruCache } from "../src/cache.js";

test("TTL cache expires entries", () => {
  let now = 1000;
  const cache = new TtlLruCache({ now: () => now });
  cache.set("video", { allowed: true }, 500);
  assert.deepEqual(cache.get("video"), { allowed: true });
  now = 1500;
  assert.equal(cache.get("video"), undefined);
  assert.equal(cache.size, 0);
});

test("LRU cache evicts the least recently used entry", () => {
  const cache = new TtlLruCache({ maxEntries: 2, now: () => 0 });
  cache.set("first", 1, 1000);
  cache.set("second", 2, 1000);
  assert.equal(cache.get("first"), 1);
  cache.set("third", 3, 1000);
  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("first"), 1);
  assert.equal(cache.get("third"), 3);
});
