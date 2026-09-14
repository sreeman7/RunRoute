const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function requestWalkingRoute(coordinates, signal) {
  let response;
  try {
    response = await fetch(`${API_BASE}/api/routes/walking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: coordinates.map(({ lng, lat }) => [lng, lat]) }),
      signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('The routing server is unavailable. Your design is still available locally.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('The routing server is unavailable or not configured.'); }
  if (!response.ok) throw new Error(data.error || 'A walking route could not be found.');
  if (!data.route?.coordinates?.length || !Number.isFinite(data.route.distanceKm)) throw new Error('The routing server returned an incomplete route.');
  return data.route;
}
