import test from 'node:test';
import assert from 'node:assert/strict';
import { artPlacements, evaluateArtFit, findArtMatches, repeatedSegmentRatio } from '../src/lib/art-fitting.js';
import { geoDistance, templateStrokes } from '../src/lib/route-art.js';

const options = { strokes: templateStrokes('heart'), center: { lat: 53.5232, lng: -113.5263 }, targetKm: 10, rotation: 0 };
const walking = (coordinates, distanceKm = 10) => ({ source: 'walking', coordinates, distanceKm });

test('nearby search is limited to three placements within 400 m', () => {
  assert.equal(artPlacements(options).length, 1);
  const placements = artPlacements({ ...options, nearby: true });
  assert.equal(placements.length, 3);
  for (const placement of placements) {
    assert.ok(geoDistance(options.center, placement.center) <= 0.401);
    assert.ok(Math.abs(placement.rotation - options.rotation) <= 15);
    assert.ok(placement.design.coordinates.length <= 48);
  }
});

test('reverse-direction repeated edges count as overlap', () => {
  const a = { lat: 0, lng: 0 }, b = { lat: 0, lng: 0.01 };
  assert.equal(repeatedSegmentRatio([a, b]), 0);
  assert.equal(repeatedSegmentRatio([a, b, a]), 0.5);
});

test('coverage penalizes a route that only follows a small part of the outline', () => {
  const design = artPlacements(options)[0].design;
  const full = evaluateArtFit(design, walking(design.coordinates), 10);
  const shortcut = evaluateArtFit(design, walking(design.coordinates.slice(0, 3), 1), 10);
  assert.equal(full.pathDeviationM, 0);
  assert.equal(full.outlineDeviationM, 0);
  assert.ok(shortcut.outlineDeviationM > 100);
  assert.ok(shortcut.cost > full.cost);
  assert.equal(shortcut.needsReview, true);
});

test('search ranks real responses and never exceeds the requested budget', async () => {
  let calls = 0;
  const progress = [];
  const result = await findArtMatches({ ...options, nearby: true, onProgress: (p) => progress.push(p.attempted), routeProvider: async (coordinates) => walking(coordinates, ++calls === 1 ? 14 : 10) });
  assert.equal(calls, 3);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(result.matches[0].placement.id, 'north');
  assert.equal(result.matches.at(-1).placement.id, 'original');
});

test('missing credentials, quotas, and unexpected failures stop search immediately', async () => {
  for (const code of ['ROUTING_NOT_CONFIGURED', 'ROUTING_LIMIT', 'ROUTING_CREDENTIALS', undefined]) {
    let calls = 0;
    const result = await findArtMatches({ ...options, nearby: true, routeProvider: async () => { calls++; throw Object.assign(new Error('Unavailable'), { code }); } });
    assert.equal(calls, 1);
    assert.equal(result.matches.length, 0);
    assert.equal(result.failures.length, 1);
  }
});

test('no-path responses allow another placement without fabricating a route', async () => {
  let calls = 0;
  const result = await findArtMatches({ ...options, nearby: true, routeProvider: async (coordinates) => {
    if (++calls === 1) throw Object.assign(new Error('No path'), { code: 'NO_WALKING_PATH' });
    return walking(coordinates);
  } });
  assert.equal(result.matches.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.attempted, 3);
});

test('partial results survive quota failure and no further requests start', async () => {
  let calls = 0;
  const result = await findArtMatches({ ...options, nearby: true, routeProvider: async (coordinates) => {
    if (++calls > 1) throw Object.assign(new Error('Quota reached'), { code: 'ROUTING_LIMIT' });
    return walking(coordinates);
  } });
  assert.equal(calls, 2);
  assert.equal(result.matches.length, 1);
  assert.equal(result.failures[0].message, 'Quota reached');
});

test('cancellation discards a late response and prevents subsequent placements', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(findArtMatches({ ...options, nearby: true, signal: controller.signal, routeProvider: async (coordinates) => { calls++; controller.abort(); return walking(coordinates); } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('already-cancelled search consumes no requests', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(findArtMatches({ ...options, signal: controller.signal, routeProvider: () => calls++ }), { name: 'AbortError' });
  assert.equal(calls, 0);
});
