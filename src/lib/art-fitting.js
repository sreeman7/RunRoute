import { buildArtDesign, geoDistance, shapeDeviationMeters } from './route-art.js';

export const MAX_ART_ATTEMPTS = 3;

export function artPlacements({ strokes, center, targetKm, rotation, nearby = false }) {
  const offsetKm = Math.min(0.4, Math.max(0.08, targetKm * 0.025));
  const latOffset = offsetKm / 111.195;
  const lngOffset = latOffset / Math.cos(center.lat * Math.PI / 180);
  const options = [
    { id: 'original', label: 'Original placement', center, rotation },
    ...(nearby ? [
      { id: 'north', label: 'North / rotated left', center: { lat: center.lat + latOffset, lng: center.lng }, rotation: rotation - 15 },
      { id: 'east', label: 'East / rotated right', center: { lat: center.lat, lng: center.lng + lngOffset }, rotation: rotation + 15 }
    ] : [])
  ];
  return options.slice(0, MAX_ART_ATTEMPTS).flatMap((placement, index) => {
    try { return [{ ...placement, design: buildArtDesign(strokes, placement.center, targetKm, placement.rotation) }]; }
    catch (error) { if (index === 0) throw error; return []; }
  });
}

export function repeatedSegmentRatio(coordinates) {
  const seen = new Set();
  let total = 0, repeated = 0;
  const key = (point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
  for (let i = 1; i < coordinates.length; i++) {
    const a = key(coordinates[i - 1]), b = key(coordinates[i]);
    const length = geoDistance(coordinates[i - 1], coordinates[i]);
    total += length;
    if (a === b) continue;
    const segment = [a, b].sort().join('|');
    if (seen.has(segment)) repeated += length;
    seen.add(segment);
  }
  return total ? repeated / total : 0;
}

export function evaluateArtFit(design, route, targetKm) {
  const pathDeviationM = shapeDeviationMeters(design.coordinates, route.coordinates);
  const outlineDeviationM = shapeDeviationMeters(route.coordinates, design.coordinates);
  const distanceErrorRatio = Math.abs(route.distanceKm - targetKm) / targetKm;
  const repeatedRatio = repeatedSegmentRatio(route.coordinates);
  // Compare both directions: a shortcut must not score well merely because it
  // lies on one small part of the intended outline. This is not a safety score.
  const shapeError = (pathDeviationM + outlineDeviationM) / 2;
  const cost = shapeError / Math.max(50, targetKm * 15) + distanceErrorRatio + repeatedRatio * 0.5;
  return {
    pathDeviationM, outlineDeviationM, distanceErrorRatio, repeatedRatio, cost,
    withinDistance: distanceErrorRatio <= 0.025,
    needsReview: shapeError > 100 || distanceErrorRatio > 0.15 || repeatedRatio > 0.25
  };
}

export async function findArtMatches({ routeProvider, signal, onProgress = () => {}, ...options }) {
  const placements = artPlacements(options);
  const matches = [], failures = [];
  let attempted = 0;
  for (const placement of placements) {
    signal?.throwIfAborted();
    attempted++;
    onProgress({ attempted, total: placements.length, label: placement.label });
    try {
      const route = await routeProvider(placement.design.coordinates, signal);
      signal?.throwIfAborted();
      matches.push({ placement, route, metrics: evaluateArtFit(placement.design, route, options.targetKm) });
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      failures.push({ placementId: placement.id, message: error.message });
      // Only a genuine no-path result is worth another paid/quota-bearing call.
      if (error.code !== 'NO_WALKING_PATH') break;
    }
  }
  return { matches: matches.sort((a, b) => a.metrics.cost - b.metrics.cost), failures, attempted, total: placements.length };
}
