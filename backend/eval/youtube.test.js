// Explicit opt-in integration tests: uses YouTube quota and paid OpenAI calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMetadata } from '../src/metadata.js';
import { openAIClassify } from '../src/classifier.js';
import { cases } from './cases.js';
import { isAllowed } from '../src/policy.js';

if (!process.env.YOUTUBE_API_KEY || !process.env.OPENAI_API_KEY) {
  throw new Error('Live video tests require YOUTUBE_API_KEY and OPENAI_API_KEY in .env or the terminal environment.');
}

for (const example of cases) {
  test(`${example.label}: ${example.expected} (${example.url})`, async () => {
    const url = new URL(example.url);
    const videoId = url.searchParams.get('v') ?? url.pathname.split('/')[2];
    const metadata = await fetchMetadata({ videoId });
    assert.equal(metadata.metadataSource, 'youtube_data_api');
    const result = await openAIClassify(metadata);
    const allowed = isAllowed(result.category, process.env.ALLOW_UNCERTAIN === 'true');
    console.info(JSON.stringify({ videoId, title: metadata.title, descriptionLength: metadata.description.length,
      expected: example.expected, actual: result.category, allowed, reason: result.reason, model: process.env.OPENAI_MODEL ?? 'gpt-5.4-nano' }));
    assert.equal(allowed, example.expected === 'educational', result.reason);
    // Sparse metadata cannot establish the Shorts example's semantic category.
    // Its required outcome is blocked; uncertain is acceptable only for this case.
    if (!(example.label === 'Shorts example' && result.category === 'uncertain')) {
      assert.equal(result.category, example.expected, result.reason);
    }
  });
}
