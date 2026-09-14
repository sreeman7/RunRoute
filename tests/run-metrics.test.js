import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRouteProgress, recordedIncrement } from '../src/lib/run-metrics.js';

const point = { lat: 53.5, lng: -113.5, accuracy: 8, timestamp: '2026-01-01T00:00:00Z', segment: 0 };
test('GPS measurement excludes pauses, poor accuracy, stale timestamps and impossible jumps', () => {
  const next = { ...point, lat: 53.5001, timestamp: '2026-01-01T00:00:05Z' };
  assert.ok(recordedIncrement(point, next).distanceKm > 0.01);
  assert.equal(recordedIncrement(point, { ...next, segment: 1 }).distanceKm, 0);
  assert.equal(recordedIncrement(point, { ...next, accuracy: 100 }).accepted, false);
  assert.equal(recordedIncrement(point, point).accepted, false);
  assert.equal(recordedIncrement(point, { ...next, lat: 54 }).distanceKm, 0);
});

test('progress projects onto a segment, not just the nearest vertex', () => {
  const result = projectRouteProgress([{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }], { lat: 0.005, lng: 0 });
  assert.equal(result.nearestDistanceM, 0);
  assert.ok(Math.abs(result.progressPercent - 50) < 0.1);
});

test('loop start and finish use previous progress to resolve the same position', () => {
  const coordinates = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }, { lat: 0, lng: 0 }];
  assert.equal(projectRouteProgress(coordinates, coordinates[0], 0).progressPercent, 0);
  assert.ok(projectRouteProgress(coordinates, coordinates[0], 4).progressPercent > 99);
});
