const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function requestWalkingRoute(coordinates, signal) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 25000);
  let response;
  try {
    response = await fetch(`${API_BASE}/api/routes/walking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: coordinates.map(({ lng, lat }) => [lng, lat]) }),
      signal: controller.signal
    });
    let data;
    try { data = await response.json(); } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error('The routing server returned an unreadable response.');
    }
    if (!response.ok) {
      const error = new Error(data.error || 'A walking route could not be found.');
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    if (!data.route?.coordinates?.length || !Number.isFinite(data.route.distanceKm)) throw new Error('The routing server returned an incomplete route.');
    return data.route;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Route request cancelled', 'AbortError');
    if (controller.signal.aborted) throw new Error('The routing request timed out. Your design is still available locally.');
    if (response) throw error;
    throw new Error('The routing server is unavailable. Your design is still available locally.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function readRoutingConfiguration(signal) {
  const response = await fetch(`${API_BASE}/api/health`, { signal });
  if (!response.ok) throw new Error('Routing server unavailable');
  const data = await response.json();
  return data.walkingConfigured === true;
}
