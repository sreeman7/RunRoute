const { createHash } = require('node:crypto');

function validCoordinates(coordinates) {
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.length <= 50 &&
    coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85);
}

function normalizeWalkingRoute(data) {
  const feature = data.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  const summary = feature?.properties?.summary;
  if (feature?.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 50000 ||
      coordinates.some((p) => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) ||
      !Number.isFinite(summary?.distance) || summary.distance <= 0) throw new Error('Invalid walking route');
  const rawSteps = feature.properties.segments?.flatMap((segment) => segment.steps || []) || [];
  let distance = 0;
  const steps = rawSteps.filter((step) => typeof step.instruction === 'string' && Number.isFinite(step.distance) && step.distance >= 0);
  const navigationSteps = steps.map((step, index) => {
    const result = { id: index === 0 ? 'start' : step.type === 10 && index === steps.length - 1 ? 'finish' : `turn-${index}`, distanceKm: distance / 1000, instruction: step.instruction, note: step.name && step.name !== '-' ? step.name : 'Openrouteservice walking directions' };
    distance += step.distance;
    return result;
  });
  return {
    coordinates: coordinates.map(([lng, lat]) => ({ lat, lng })),
    distanceKm: summary.distance / 1000,
    navigationSteps,
    source: 'walking',
    provider: 'openrouteservice',
    attribution: 'openrouteservice | OpenStreetMap contributors'
  };
}

function createWalkingHandler({ apiKey = process.env.ORS_API_KEY, fetchImpl = fetch, dailyLimit = Number(process.env.ROUTING_DAILY_LIMIT || 100), now = Date.now } = {}) {
  const cache = new Map();
  const clients = new Map();
  let day = '', spent = 0, active = 0;
  const limit = Number.isFinite(dailyLimit) && dailyLimit > 0 ? Math.floor(dailyLimit) : 100;
  return async (request, response) => {
    const coordinates = request.body?.coordinates;
    response.set('Cache-Control', 'no-store');
    if (!validCoordinates(coordinates)) return response.status(400).json({ error: 'Provide 2-50 valid longitude/latitude pairs.' });
    if (!apiKey || apiKey === 'your_ors_key_here') return response.status(503).json({ error: 'Street fitting is not connected yet. Add ORS_API_KEY to the server configuration. No AI key is needed.' });
    const time = now();
    const today = new Date(time).toISOString().slice(0, 10);
    if (today !== day) { day = today; spent = 0; clients.clear(); }
    const key = createHash('sha256').update(JSON.stringify(coordinates)).digest('hex');
    const cached = cache.get(key);
    if (cached && cached.expires > time) return response.json({ route: cached.route, cached: true });
    for (const [id, entry] of cache) if (entry.expires <= time) cache.delete(id);
    const ip = request.ip || 'local';
    for (const [id, entry] of clients) if (entry.expires <= time) clients.delete(id);
    const client = clients.get(ip) || { count: 0, expires: time + 3600000 };
    if (spent >= limit || client.count >= 12 || active >= 3 || (!clients.has(ip) && clients.size >= 1000)) {
      response.set('Retry-After', '3600');
      return response.status(429).json({ error: 'The routing request limit has been reached. Keep designing locally and try street fitting later.' });
    }
    spent++;
    client.count++;
    clients.set(ip, client);
    active++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const upstream = await fetchImpl('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates, instructions: true, instructions_format: 'text', language: 'en', radiuses: coordinates.map(() => 150), preference: 'shortest' }),
        signal: controller.signal
      });
      if (!upstream.ok) {
        const message = [401, 403].includes(upstream.status) ? 'The walking provider rejected the server credentials. Check the routing configuration.' : upstream.status === 429 ? 'The walking provider is at its request limit. Try again later.' : 'No walking route could fit these points. Move or enlarge the design and try again.';
        return response.status(upstream.status === 429 ? 429 : 502).json({ error: message });
      }
      const route = normalizeWalkingRoute(await upstream.json());
      if (route.distanceKm > 100) return response.status(422).json({ error: 'The walking detour is over 100 km. Move or simplify the design.' });
      if (cache.size >= 50) cache.delete(cache.keys().next().value);
      cache.set(key, { route, expires: time + 1800000 });
      return response.json({ route, cached: false });
    } catch {
      return response.status(502).json({ error: controller.signal.aborted ? 'Street fitting timed out. Your design has not changed.' : 'The walking provider could not return a usable route. Try a different placement.' });
    } finally {
      clearTimeout(timeout);
      active--;
    }
  };
}

module.exports = { createWalkingHandler, validCoordinates, normalizeWalkingRoute };
