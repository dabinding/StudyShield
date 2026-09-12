import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../src/policy.js';

test('only educational videos are allowed under the default policy', () => {
  assert.equal(isAllowed('educational'), true);
  for (const category of ['non_educational', 'uncertain', 'unavailable', undefined]) {
    assert.equal(isAllowed(category), false);
  }
});

test('uncertain override never allows confirmed non-educational content', () => {
  assert.equal(isAllowed('uncertain', true), true);
  assert.equal(isAllowed('non_educational', true), false);
});
