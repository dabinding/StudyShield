import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMetadata } from '../src/metadata.js';
import { openAIClassify } from '../src/classifier.js';

test('stale client metadata is discarded and timestamp URLs become canonical', async () => {
  const result = await fetchMetadata({ videoId: '302eJ3TzJQU', url: 'https://www.youtube.com/watch?v=302eJ3TzJQU&t=4s', title: 'Tik Tokers Having A Bad Day' }, {
    apiKey: '', fetchImpl: async url => {
      assert.equal(url.searchParams.get('url'), 'https://www.youtube.com/watch?v=302eJ3TzJQU');
      return { ok: true, json: async () => ({ title: 'Introduction to Geometry' }) };
    }
  });
  assert.equal(result.title, 'Introduction to Geometry');
  assert.equal(result.description, '');
});

test('Data API supplies matching video description', async () => {
  const result = await fetchMetadata({ videoId: '302eJ3TzJQU' }, {
    apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ items: [{ id: '302eJ3TzJQU', snippet: { title: 'Introduction to Geometry', description: 'Learn angles and triangles.' } }] }) })
  });
  assert.equal(result.description, 'Learn angles and triangles.');
});

test('raw Responses API JSON is parsed without SDK output_text helper', async () => {
  const decision = { category: 'educational', confidence: 0.95, reason: 'Teaches geometry.' };
  const result = await openAIClassify({ videoId: '302eJ3TzJQU', title: 'Introduction to Geometry', description: '' }, {
    apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(decision) }] }] }) })
  });
  assert.deepEqual(result, decision);
});
