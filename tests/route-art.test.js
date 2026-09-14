import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtDesign, geoLength, normalizeStrokes, shapeDeviationMeters, templateStrokes, traceRaster } from '../src/lib/route-art.js';

const center = { lat: 53.5232, lng: -113.5263 };

for (const shape of ['heart', 'star', 'bolt']) {
  test(`${shape} stays within waypoint limits and preserves design distance`, () => {
    for (const target of [1, 10, 60]) {
      for (const angle of [-180, 0, 75]) {
        const design = buildArtDesign(templateStrokes(shape), center, target, angle);
        assert.ok(design.coordinates.length <= 48);
        assert.ok(Math.abs(geoLength(design.coordinates) - target) < 0.005);
        assert.deepEqual(design.strokes[0][0], design.strokes[0].at(-1));
      }
    }
  });
}

test('multiple contours include connecting legs in the distance', () => {
  const shapes = normalizeStrokes([[[0, 0], [1, 0], [1, 1], [0, 0]], [[3, 0], [4, 0], [4, 1], [3, 0]]]);
  const design = buildArtDesign(shapes, center, 10);
  assert.equal(design.connectors.length, 1);
  assert.ok(design.connectorKm > 0);
  assert.ok(Math.abs(design.strokes.reduce((sum, stroke) => sum + geoLength(stroke), 0) + design.connectorKm - 10) < 0.005);
});

test('invalid center, distance and degenerate shape are rejected', () => {
  assert.throws(() => buildArtDesign(templateStrokes('heart'), { lat: NaN, lng: 0 }, 10));
  assert.throws(() => buildArtDesign(templateStrokes('heart'), { lat: 89, lng: 0 }, 10));
  for (const target of [0, 61, NaN]) assert.throws(() => buildArtDesign(templateStrokes('heart'), center, target));
  assert.throws(() => normalizeStrokes([[[1, 1], [1, 1], [1, 1]]]));
});

function raster(light = 255) {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) data.set([light, light, light, 255], i * 4);
  return { width: 32, height: 32, data };
}

test('contour extraction handles silhouettes, holes and blank images', () => {
  const image = raster();
  assert.throws(() => traceRaster(image), /No outline/);
  for (let y = 6; y < 26; y++) for (let x = 6; x < 26; x++) image.data.set([0, 0, 0, 255], (y * 32 + x) * 4);
  assert.equal(traceRaster(image).length, 1);
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) image.data.set([255, 255, 255, 255], (y * 32 + x) * 4);
  assert.equal(traceRaster(image).length, 2);
});

test('transparent pixels do not become a false outline', () => {
  const image = raster(0);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
  assert.throws(() => traceRaster(image), /No outline/);
  assert.throws(() => traceRaster(image, 150, true), /No outline/);
});

test('deviation is zero for the design and positive for a displaced route', () => {
  const design = buildArtDesign(templateStrokes('star'), center, 10).coordinates;
  assert.equal(shapeDeviationMeters(design, design), 0);
  assert.ok(shapeDeviationMeters(design, design.map((p) => ({ ...p, lat: p.lat + 0.005 }))) > 100);
});
