import test from "node:test";
import assert from "node:assert/strict";
import { heuristicClassify, normalizeResult } from "../src/classifier.js";

test("heuristic classifier recognizes obvious lesson metadata", () => {
  assert.equal(heuristicClassify({ title: "Algebra lesson", description: "Math tutorial" }).category, "educational");
});

test("recognizes the reported Introduction to Geometry video", () => {
  const result = heuristicClassify({ title: "Introduction to Geometry", description: "" });
  assert.equal(result.category, "educational");
});

test("heuristic classifier recognizes obvious gameplay metadata", () => {
  assert.equal(heuristicClassify({ title: "Epic gameplay", description: "Funny moments" }).category, "non_educational");
});

test("normalization safely handles malformed output", () => {
  assert.deepEqual(normalizeResult({ category: "other", confidence: 5, reason: "" }), {
    category: "uncertain",
    confidence: 1,
    reason: "The available metadata was insufficient for a reliable decision."
  });
});
