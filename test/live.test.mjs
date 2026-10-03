/* Live smoke test against the public demo domain (key "open"). Needs network.
   Run: npm run test:live */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBundles, summary, checkpointReport, OptelError } from '../optel-client.js';

test('loads real bundles for the open demo domain', async () => {
  const { bundles, failed, granularity } = await loadBundles({ domain: 'emigrationbrewing.com', domainKey: 'open', last: '30d' });
  assert.equal(granularity, 'day');
  assert.equal(failed.length, 0);
  assert.ok(bundles.length > 0, 'expected some bundles in 30 days');
  const b = bundles[0];
  for (const k of ['id', 'url', 'userAgent', 'weight', 'time', 'timeSlot', 'events']) assert.ok(k in b, `bundle has ${k}`);
  const s = summary(bundles);
  assert.ok(s.views > 0);
  assert.ok(checkpointReport(bundles).some((r) => r.checkpoint === 'top'));
});

test('a hostname without a key is rejected with OptelError', async () => {
  await assert.rejects(
    loadBundles({ domain: 'www.emigrationbrewing.com', domainKey: 'open', last: '24h' }),
    (err) => err instanceof OptelError && [401, 403].includes(err.status),
  );
});
