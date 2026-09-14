import { contours } from 'd3-contour';
import simplify from 'simplify-js';

const EARTH_KM = 6371;
const radians = (value) => value * Math.PI / 180;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lineLength = (points) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);

export function geoDistance(a, b) {
  const lat = radians(b.lat - a.lat);
  const lng = radians(b.lng - a.lng);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function geoLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + geoDistance(points[index], point), 0);
}

export function normalizeStrokes(strokes) {
  const points = strokes.flat();
  if (points.length < 3 || points.some((p) => p.length !== 2 || !p.every(Number.isFinite))) {
    throw new Error('No usable outline found. Try a simple, high-contrast silhouette.');
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const size = Math.max(maxX - minX, maxY - minY);
  if (size < 0.001) throw new Error('The outline is too small.');
  return strokes.map((stroke) => stroke.map(([x, y]) => [(x - (minX + maxX) / 2) / size, (y - (minY + maxY) / 2) / size]));
}

export function templateStrokes(name) {
  if (name === 'heart') {
    return normalizeStrokes([Array.from({ length: 65 }, (_, i) => {
      const t = i * Math.PI * 2 / 64;
      return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
    })]);
  }
  if (name === 'star') {
    return normalizeStrokes([Array.from({ length: 11 }, (_, i) => {
      const a = i * Math.PI / 5 - Math.PI / 2;
      const radius = i % 2 ? 0.43 : 1;
      return [Math.cos(a) * radius, Math.sin(a) * radius];
    })]);
  }
  return normalizeStrokes([[[0.2, -0.5], [-0.3, 0.08], [0.02, 0.08], [-0.15, 0.5], [0.35, -0.12], [0.03, -0.12], [0.2, -0.5]]]);
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, [x, y], i) => {
    const next = points[(i + 1) % points.length];
    return sum + x * next[1] - next[0] * y;
  }, 0) / 2);
}

export function traceRaster({ data, width, height }, threshold = 150, invert = false) {
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const alpha = data[i * 4 + 3] / 255;
    const light = (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) * alpha + 255 * (1 - alpha);
    const x = i % width, y = Math.floor(i / width);
    values[i] = x > 1 && x < width - 2 && y > 1 && y < height - 2 && (invert ? light > threshold && alpha > 0.1 : light < threshold) ? 1 : 0;
  }
  const geometry = contours().size([width, height]).thresholds([0.5])(values)[0];
  const rings = geometry.coordinates.flat().map((points) => ({ points, area: polygonArea(points) }));
  const largest = Math.max(0, ...rings.map((ring) => ring.area));
  const useful = rings.filter((ring) => ring.area >= Math.max(12, largest * 0.005)).sort((a, b) => b.area - a.area);
  if (!useful.length) throw new Error('No outline found. Adjust contrast or choose a dark shape on a light background.');
  if (useful.length > 8) throw new Error('This image has too many separate details. Use a simpler silhouette or a shorter word.');
  return normalizeStrokes(useful.map(({ points }) => simplify(points.map(([x, y]) => ({ x, y })), 1.2, true).map(({ x, y }) => [x, y])));
}

export function textStrokes(text) {
  const word = text.trim().toUpperCase();
  if (!/^[A-Z0-9 ]{1,6}$/.test(word)) throw new Error('Enter 1-6 letters or numbers.');
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 180;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '900 140px Arial, sans-serif';
  const size = Math.min(140, 140 * 464 / context.measureText(word).width);
  context.font = `900 ${size}px Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#000';
  context.fillText(word, 256, 90);
  return traceRaster(context.getImageData(0, 0, 512, 180));
}

export async function readImageRaster(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('The image must be smaller than 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 16000000) throw new Error('Use an image smaller than 16 megapixels.');
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(bitmap.width * scale) + 16;
    canvas.height = Math.ceil(bitmap.height * scale) + 16;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 8, 8, canvas.width - 16, canvas.height - 16);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
}

function orderStrokes(strokes) {
  const remaining = strokes.map((stroke) => stroke.slice(0, -1));
  const result = [];
  let cursor = [-1, 0];
  while (remaining.length) {
    let closest = { stroke: 0, point: 0, gap: Infinity };
    remaining.forEach((stroke, s) => stroke.forEach((point, p) => {
      const gap = distance(cursor, point);
      if (gap < closest.gap) closest = { stroke: s, point: p, gap };
    }));
    const ring = remaining.splice(closest.stroke, 1)[0];
    const ordered = [...ring.slice(closest.point), ...ring.slice(0, closest.point), ring[closest.point]];
    result.push(ordered);
    cursor = ordered[ordered.length - 1];
  }
  return result;
}

export function buildArtDesign(strokes, center, targetKm, rotation = 0) {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) || Math.abs(center.lat) > 80 || Math.abs(center.lng) > 180) {
    throw new Error('Choose a map center between 80 S and 80 N.');
  }
  if (!Number.isFinite(targetKm) || targetKm < 1 || targetKm > 60) throw new Error('Choose a distance between 1 and 60 km.');
  const ordered = orderStrokes(normalizeStrokes(strokes));
  let sampled = ordered;
  let tolerance = 0.002;
  // Bound the routing request while preserving each ring and its connecting leg.
  while (sampled.flat().length > 48 && tolerance < 0.3) {
    sampled = ordered.map((ring) => {
      const reduced = simplify(ring.map(([x, y]) => ({ x, y })), tolerance, true);
      return reduced.length >= 4 ? reduced.map(({ x, y }) => [x, y]) : ring;
    });
    tolerance *= 1.4;
  }
  if (sampled.flat().length > 48) throw new Error('The design is too detailed for a single route. Try fewer letters or a simpler outline.');
  const planarLength = lineLength(sampled.flat());
  if (planarLength <= 0) throw new Error('The outline has no length.');
  const angle = radians(rotation);
  const project = (scale) => sampled.map((stroke) => stroke.map(([x, y]) => {
    const east = (x * Math.cos(angle) - y * Math.sin(angle)) * scale;
    const north = -(x * Math.sin(angle) + y * Math.cos(angle)) * scale;
    return { lat: center.lat + north / EARTH_KM * 180 / Math.PI, lng: center.lng + east / (EARTH_KM * Math.cos(radians(center.lat))) * 180 / Math.PI };
  }));
  let projected = project(targetKm / planarLength);
  projected = project(targetKm / planarLength * targetKm / geoLength(projected.flat()));
  const coordinates = projected.flat();
  if (coordinates.some((p) => Math.abs(p.lng) > 180 || Math.abs(p.lat) > 85)) throw new Error('Move the design away from the map boundary.');
  const connectors = projected.slice(1).map((stroke, i) => [projected[i].at(-1), stroke[0]]);
  return { strokes: projected, coordinates, connectors, lengthKm: geoLength(coordinates), connectorKm: connectors.reduce((sum, points) => sum + geoLength(points), 0) };
}

export function shapeDeviationMeters(design, route) {
  if (!design.length || !route.length) return null;
  const origin = design[0];
  const project = (point) => [(point.lng - origin.lng) * Math.cos(radians(origin.lat)) * 111195, (point.lat - origin.lat) * 111195];
  const target = design.map(project);
  const nearest = (point, line) => {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
    }
    return best;
  };
  // Distance-weighted samples avoid overstating fit on routes with dense vertices.
  const samples = [];
  const line = route.map(project);
  for (let i = 1; i < line.length; i++) {
    const length = distance(line[i - 1], line[i]);
    const count = Math.max(1, Math.ceil(length / 50));
    for (let j = 0; j < count; j++) samples.push({ point: [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * (j + 0.5) / count, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * (j + 0.5) / count], weight: length / count });
  }
  const weight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  return weight ? Math.round(samples.reduce((sum, sample) => sum + nearest(sample.point, target) * sample.weight, 0) / weight) : 0;
}
