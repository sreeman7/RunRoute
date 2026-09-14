import { geoDistance } from './route-art.js';

export function recordedIncrement(previous, point) {
  if (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 50 || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return { accepted: false, distanceKm: 0 };
  if (!previous || previous.segment !== point.segment) return { accepted: true, distanceKm: 0 };
  const seconds = (Date.parse(point.timestamp) - Date.parse(previous.timestamp)) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return { accepted: false, distanceKm: 0 };
  const distanceKm = geoDistance(previous, point);
  return { accepted: true, distanceKm: seconds < 30 && distanceKm / seconds < 0.012 ? distanceKm : 0 };
}

export function projectRouteProgress(coordinates, position, previousProgressKm = 0) {
  if (coordinates.length < 2) return { nearestDistanceM: null, progressKm: 0, progressPercent: 0 };
  const longitudeScale = Math.cos(position.lat * Math.PI / 180) * 111195;
  const project = (p) => [(p.lng - position.lng) * longitudeScale, (p.lat - position.lat) * 111195];
  let cumulative = 0;
  let best = { distance: Infinity, progress: 0 };
  for (let index = 1; index < coordinates.length; index++) {
    const a = project(coordinates[index - 1]), b = project(coordinates[index]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(a[0] + t * dx, a[1] + t * dy);
    const length = geoDistance(coordinates[index - 1], coordinates[index]);
    const progress = cumulative + length * t;
    const tied = Math.abs(distance - best.distance) < 3;
    if ((!tied && distance < best.distance) || (tied && Math.abs(progress - previousProgressKm) < Math.abs(best.progress - previousProgressKm))) best = { distance, progress };
    cumulative += length;
  }
  return { nearestDistanceM: Math.round(best.distance), progressKm: best.progress, progressPercent: Math.min(100, best.progress / Math.max(cumulative, 0.001) * 100) };
}
