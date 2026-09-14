import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWalkingHandler, validCoordinates, normalizeWalkingRoute } = require('../server/walking.js');

const coordinates = [[-113.52, 53.52], [-113.53, 53.53]];
const feature = () => ({ features: [{ geometry: { type: 'LineString', coordinates }, properties: { summary: { distance: 1400 }, segments: [{ steps: [{ type: 11, instruction: 'Head north', distance: 1400 }, { type: 10, instruction: 'Arrive', distance: 0 }] }] } }] });
function response() { return { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }

test('coordinate validation rejects malformed, excessive and non-finite inputs', () => {
  assert.equal(validCoordinates(coordinates), true);
  for (const value of [[], [[0, 0]], [[0, 0], [181, 90]], [[0, 0], ['1', 2]], [[0, 0], [NaN, 3]], Array(51).fill([0, 0])]) assert.equal(validCoordinates(value), false);
});

test('missing routing key fails closed without calling a provider', async () => {
  let calls = 0;
  const handler = createWalkingHandler({ apiKey: '', fetchImpl: async () => { calls++; } });
  const res = response();
  await handler({ body: { coordinates } }, res);
  assert.equal(res.code, 503);
  assert.equal(calls, 0);
});

test('provider route keeps actual distance and authoritative steps', () => {
  const result = normalizeWalkingRoute(feature());
  assert.equal(result.distanceKm, 1.4);
  assert.equal(result.source, 'walking');
  assert.equal(result.navigationSteps.at(-1).distanceKm, 1.4);
  assert.equal(result.navigationSteps.at(-1).id, 'finish');
  assert.deepEqual(result.coordinates[0], { lng: -113.52, lat: 53.52 });
});

test('via-point arrivals have unique IDs, not premature finish IDs', () => {
  const data = feature();
  data.features[0].properties.segments.push(data.features[0].properties.segments[0]);
  const result = normalizeWalkingRoute(data);
  assert.equal(new Set(result.navigationSteps.map((s) => s.id)).size, 4);
  assert.equal(result.navigationSteps.filter((s) => s.id === 'finish').length, 1);
});

test('malformed provider geometry is not returned as a route', () => {
  const data = feature();
  data.features[0].geometry.coordinates = [[0, 0], [null, 2]];
  assert.throws(() => normalizeWalkingRoute(data));
});

test('walking routing is cached and uses only foot-walking', async () => {
  let calls = 0;
  const handler = createWalkingHandler({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    calls++;
    assert.ok(url.endsWith('/foot-walking/geojson'));
    assert.equal(JSON.parse(options.body).instructions, true);
    return { ok: true, json: async () => feature() };
  } });
  const first = response(), second = response();
  await handler({ ip: 'test', body: { coordinates } }, first);
  await handler({ ip: 'test', body: { coordinates } }, second);
  assert.equal(first.code, 200);
  assert.equal(second.body.cached, true);
  assert.equal(calls, 1);
});

test('daily budget prevents additional provider calls but permits cache hits', async () => {
  let calls = 0;
  const handler = createWalkingHandler({ apiKey: 'test-key', dailyLimit: 1, fetchImpl: async () => { calls++; return { ok: true, json: async () => feature() }; } });
  await handler({ body: { coordinates } }, response());
  const res = response();
  await handler({ body: { coordinates: [[-113.52, 53.52], [-113.54, 53.54]] } }, res);
  assert.equal(res.code, 429);
  assert.equal(calls, 1);
});

test('provider failure never returns estimated geometry or raw credentials', async () => {
  const handler = createWalkingHandler({ apiKey: 'test-secret', fetchImpl: async () => { throw Error('test-secret'); } });
  const res = response();
  await handler({ body: { coordinates } }, res);
  assert.equal(res.code, 502);
  assert.equal(res.body.route, undefined);
  assert.ok(!JSON.stringify(res.body).includes('test-secret'));
});
