import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Bike,
  CalendarClock,
  Check,
  ChevronRight,
  CloudSun,
  Coffee,
  Compass,
  Droplets,
  Footprints,
  LocateFixed,
  MapPin,
  Moon,
  Mountain,
  Navigation,
  RefreshCcw,
  Route,
  Save,
  Share2,
  ShieldCheck,
  Sparkles,
  Timer,
  Toilet,
  Train,
  Trees,
  Waves
} from 'lucide-react';
import './styles.css';

const DEFAULT_START = {
  lat: 53.5232,
  lng: -113.5263,
  label: 'University of Alberta, Edmonton'
};

const ROUTE_COLORS = ['#1f7a5a', '#e76f51', '#2f65d7'];
const MIN_DISTANCE_KM = 1;
const MAX_DISTANCE_KM = 60;
const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/foot';

const ROUTE_TYPES = [
  { id: 'loop', label: 'Loop' },
  { id: 'one-way', label: 'One-way' },
  { id: 'out-and-back', label: 'Out-back' },
  { id: 'scenic', label: 'Scenic' }
];

const STYLE_OPTIONS = [
  { id: 'flat', label: 'Flat route', icon: Waves },
  { id: 'hills', label: 'Hill training', icon: Mountain },
  { id: 'scenic', label: 'Scenic', icon: Sparkles },
  { id: 'parks', label: 'Park/trail', icon: Trees },
  { id: 'road', label: 'Road', icon: Bike },
  { id: 'night', label: 'Safe night', icon: Moon },
  { id: 'beginner', label: 'Beginner', icon: Footprints }
];

const TRAINING_GOALS = [
  'Easy long run',
  'Marathon prep',
  'Half-marathon prep',
  'Hill training',
  'Recovery run',
  'Tempo route',
  'Trail endurance'
];

const STOP_TYPES = {
  water: { icon: Droplets, label: 'Water' },
  cafe: { icon: Coffee, label: 'Cafe' },
  bathroom: { icon: Toilet, label: 'Bathroom' },
  transit: { icon: Train, label: 'Transit' },
  store: { icon: MapPin, label: 'Store' }
};

const STOP_SYMBOLS = {
  water: 'W',
  cafe: 'C',
  bathroom: 'B',
  transit: 'T',
  store: 'S'
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, places = 1) {
  return Number(value.toFixed(places));
}

function distancePrecision(distanceKm) {
  return distanceKm < 10 ? 2 : 1;
}

function formatDistance(distanceKm) {
  return `${round(distanceKm, distancePrecision(distanceKm))} km`;
}

function routeRangeLabel(targetKm) {
  const acceptable = targetKm * 0.025;
  const places = distancePrecision(targetKm);
  return `${round(targetKm - acceptable, places)}-${round(targetKm + acceptable, places)} km`;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceKm(first, second) {
  const earthRadiusKm = 6371;
  const latDelta = toRadians(second.lat - first.lat);
  const lngDelta = toRadians(second.lng - first.lng);
  const lat1 = toRadians(first.lat);
  const lat2 = toRadians(second.lat);
  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeDistanceKm(coordinates) {
  return coordinates.reduce((distance, point, index) => {
    if (index === 0) return distance;
    return distance + haversineDistanceKm(coordinates[index - 1], point);
  }, 0);
}

function destinationPoint(start, distanceKm, bearingDegrees) {
  const earthRadiusKm = 6371;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(start.lat);
  const lon1 = toRadians(start.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: round((lat2 * 180) / Math.PI, 5),
    lng: round((lon2 * 180) / Math.PI, 5)
  };
}

function formatDuration(distanceKm, paceMinPerKm) {
  const totalMinutes = Math.round(distanceKm * paceMinPerKm);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;
}

function formatPace(decimalPace) {
  const minutes = Math.floor(decimalPace);
  const seconds = Math.round((decimalPace - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`;
}

function routeSeed(routeType, style, index) {
  const base =
    routeType.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) +
    style.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return base + index * 37;
}

function buildCoordinates(start, targetKm, routeType, style, index, scale = 1) {
  const seed = routeSeed(routeType, style, index);
  const bearing = (seed * 19) % 360;
  const loopDivisor = routeType === 'scenic' || style === 'parks' ? 7.2 : 6.4;
  const oneWayDivisor = 1.75;
  const spread = clamp(
    (targetKm / (routeType === 'one-way' ? oneWayDivisor : loopDivisor)) * scale,
    0.06,
    15
  );
  const scenicBias = style === 'scenic' || routeType === 'scenic' ? 1.25 : 1;
  const hillBias = style === 'hills' ? 0.8 : 1;

  if (routeType === 'out-and-back') {
    const turn = destinationPoint(start, clamp((targetKm / 2.6) * scale, 0.08, 20), bearing);
    const wiggle = destinationPoint(turn, Math.min(0.45, targetKm / 18) * scale, bearing + 75);
    return [start, destinationPoint(start, Math.min(0.35, targetKm / 5) * scale, bearing + 25), wiggle, turn, wiggle, start];
  }

  if (routeType === 'one-way') {
    return [
      start,
      destinationPoint(start, spread * 0.45, bearing - 22),
      destinationPoint(start, spread * 0.85, bearing + 8),
      destinationPoint(start, spread * 1.25, bearing + 18),
      destinationPoint(start, spread * 1.58, bearing + 4)
    ];
  }

  const points = [start];
  const pointCount = routeType === 'scenic' || style === 'parks' ? 7 : 6;
  for (let step = 1; step < pointCount; step += 1) {
    const angle = bearing + (360 / pointCount) * step + (step % 2 === 0 ? 20 : -16);
    const distance = spread * scenicBias * (step % 2 === 0 ? 0.92 : 1.18) * hillBias;
    points.push(destinationPoint(start, distance, angle));
  }
  points.push(start);
  return points;
}

function buildStops(distanceKm, style, routeIndex) {
  if (distanceKm < 4) return [];

  const base = [
    { type: 'water', name: 'River path fountain', km: 5.8 },
    { type: 'bathroom', name: 'Public washroom', km: 8.4 },
    { type: 'cafe', name: 'Corner cafe refill', km: 12.6 },
    { type: 'store', name: 'Convenience stop', km: 16.9 },
    { type: 'transit', name: 'Transit stop', km: distanceKm - 1.2 }
  ];

  const interval = style === 'beginner' ? 0.78 : style === 'night' ? 0.86 : 1;
  return base
    .map((stop, index) => ({
      ...stop,
      km: round(clamp(stop.km * interval + routeIndex * 0.4, 1.5, distanceKm - 0.8), 1),
      id: `${stop.type}-${routeIndex}-${index}`
    }))
    .filter((stop) => stop.km < distanceKm - 0.4)
    .slice(0, distanceKm < 15 ? 3 : 5);
}

function calculateNutrition(distanceKm) {
  if (distanceKm < 16) return 'Water bottle, optional electrolytes';
  if (distanceKm < 25) return 'Water plus 1 gel';
  if (distanceKm < 35) return 'Water plus 2 gels';
  return 'Water plus 3-4 gels';
}

function trainingRecommendation(goal, style, distanceKm) {
  if (goal === 'Marathon prep') return 'Mostly steady roads, low traffic, refill points every 6-8 km';
  if (goal === 'Hill training') return 'Rolling climbs with recovery sections after each sustained effort';
  if (goal === 'Recovery run') return 'Shorter, flatter segments with extra exit points';
  if (goal === 'Trail endurance') return 'Park and trail priority with slower terrain factored into difficulty';
  if (goal === 'Tempo route') return 'Clear middle section with few crossings for sustained pace work';
  if (distanceKm >= 28) return 'Conservative route shape with reliable stops and transit access';
  return `${style.charAt(0).toUpperCase() + style.slice(1)} preference balanced with safety`;
}

function createRoute(form, index, desiredDistanceKm, coordinates, source = 'estimated', sourceDistanceKm) {
  const target = Number(form.distanceKm);
  const start = form.start || DEFAULT_START;
  const routeNames = ['Safest Corridor', 'Scenic Flow', 'Flat Finish'];
  const name = routeNames[index];
  const actualDistance = sourceDistanceKm || routeDistanceKm(coordinates) || desiredDistanceKm;
  const distance = round(actualDistance, distancePrecision(actualDistance));
  const style = form.style;
  const routeType = form.routeType;
  const elevationBase = style === 'hills' ? 16 : style === 'flat' || style === 'beginner' ? 5 : 9;
  const elevationGain = Math.round(distance * (elevationBase + index * 1.7));
  const stops = buildStops(distance, style, index);
  const nightBoost = style === 'night' ? 8 : 0;
  const scenicBoost = style === 'parks' || style === 'scenic' ? 4 : 0;
  const safetyScore = clamp(91 - index * 7 + nightBoost + scenicBoost - Math.max(0, distance - 30) * 0.6, 58, 98);
  const difficultyScore = clamp(
    Math.round(distance * 1.7 + elevationGain / 18 + (style === 'hills' ? 16 : 0) - stops.length * 2),
    22,
    96
  );
  const finish = coordinates[coordinates.length - 1];

  return {
    id: `${routeType}-${style}-${target}-${index}-${source}`,
    name,
    label: index === 0 ? 'Safest' : index === 1 ? 'Most scenic' : 'Flattest',
    description: trainingRecommendation(form.trainingGoal, style, distance),
    distanceKm: distance,
    targetRange: routeRangeLabel(target),
    estimatedTime: formatDuration(distance, Number(form.paceMinPerKm)),
    pace: formatPace(Number(form.paceMinPerKm)),
    safetyScore: Math.round(safetyScore),
    difficultyScore,
    elevationGain,
    hardestClimb: `${round(distance * 0.48, distancePrecision(distance))}-${round(distance * 0.57, distancePrecision(distance))} km`,
    stops,
    nutrition: calculateNutrition(distance),
    routeType,
    source,
    style,
    coordinates,
    finish,
    color: ROUTE_COLORS[index]
  };
}

function generateEstimatedRoutes(form) {
  const target = Number(form.distanceKm);

  return ['Safest Corridor', 'Scenic Flow', 'Flat Finish'].map((_, index) => {
    const variance = [-0.012, 0.009, 0.018][index] * target;
    const desiredDistance = clamp(target + variance, target * 0.975, target * 1.025);
    const coordinates = buildCoordinates(form.start || DEFAULT_START, desiredDistance, form.routeType, form.style, index);
    return createRoute(form, index, desiredDistance, coordinates);
  });
}

function routeScaleCandidates(form, desiredDistance) {
  if (form.routeType === 'one-way') return [0.7, 0.85, 1, 1.2, 1.45, 1.7];
  if (desiredDistance < 3) return [0.35, 0.45, 0.55, 0.65, 0.78, 0.92, 1.08, 1.28, 1.52, 1.82, 2.2];
  return [0.25, 0.32, 0.35, 0.42, 0.5, 0.62, 0.78, 0.95];
}

function routeShapeCandidates(index) {
  return [index, index + 16, index + 17, index + 1, index + 2, index + 6, index + 12];
}

async function fetchRoadRoute(coordinates) {
  const coordinateString = coordinates.map((point) => `${point.lng},${point.lat}`).join(';');
  const url = `${OSRM_ROUTE_URL}/${coordinateString}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('Routing service did not respond');
    const data = await response.json();
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
      throw new Error('Routing service could not find a route');
    }

    return {
      coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceKm: route.distance / 1000
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function snapRouteToRoads(form, index) {
  const target = Number(form.distanceKm);
  const desiredDistance = clamp(target + [-0.012, 0.009, 0.018][index] * target, target * 0.975, target * 1.025);
  let bestRoute = null;
  let bestGap = Number.POSITIVE_INFINITY;
  const scaleCandidates = routeScaleCandidates(form, desiredDistance);

  for (const shapeIndex of routeShapeCandidates(index)) {
    let foundCloseMatch = false;
    for (const scale of scaleCandidates) {
      const waypointCoordinates = buildCoordinates(
        form.start || DEFAULT_START,
        desiredDistance,
        form.routeType,
        form.style,
        shapeIndex,
        scale
      );
      const roadRoute = await fetchRoadRoute(waypointCoordinates);
      const gap = Math.abs(roadRoute.distanceKm - desiredDistance);

      if (gap < bestGap) {
        bestGap = gap;
        bestRoute = roadRoute;
      }

      if (gap <= Math.max(0.03, desiredDistance * 0.025)) {
        foundCloseMatch = true;
        break;
      }
    }

    if (foundCloseMatch) break;
  }

  return createRoute(form, index, desiredDistance, bestRoute.coordinates, 'road', bestRoute.distanceKm);
}

async function generateRoadSnappedRoutes(form) {
  const snappedRoutes = await Promise.all([0, 1, 2].map((index) => snapRouteToRoads(form, index)));
  return snappedRoutes.sort((first, second) => second.safetyScore - first.safetyScore);
}

function interpolateRoutePoint(route, distanceKm) {
  const fraction = clamp(distanceKm / route.distanceKm, 0, 1);
  const segmentPosition = fraction * (route.coordinates.length - 1);
  const index = Math.floor(segmentPosition);
  const nextIndex = Math.min(index + 1, route.coordinates.length - 1);
  const localFraction = segmentPosition - index;
  const current = route.coordinates[index];
  const next = route.coordinates[nextIndex];

  return {
    lat: current.lat + (next.lat - current.lat) * localFraction,
    lng: current.lng + (next.lng - current.lng) * localFraction
  };
}

function createGpx(route) {
  const points = route.coordinates
    .map((point) => `      <trkpt lat="${point.lat}" lon="${point.lng}"></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="LongRun Route Planner">
  <trk>
    <name>${route.name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

function createKml(route) {
  const coordinates = route.coordinates.map((point) => `${point.lng},${point.lat},0`).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>${route.name}</name>
      <LineString>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

function normalizeRouteForm(form) {
  return {
    ...form,
    distanceKm: clamp(Number(form.distanceKm) || 20, MIN_DISTANCE_KM, MAX_DISTANCE_KM),
    paceMinPerKm: clamp(Number(form.paceMinPerKm) || 7, 3, 12)
  };
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat">
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreMeter({ label, value, tone = 'green' }) {
  return (
    <div className="meter">
      <div className="meterHeader">
        <span>{label}</span>
        <strong>{value}/100</strong>
      </div>
      <div className="meterTrack" aria-hidden="true">
        <span className={`meterFill ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function RouteMap({ routes, selectedRouteId, onSelectRoute, routing }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) || routes[0];

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return undefined;

    const map = L.map(mapElementRef.current, {
      attributionControl: true,
      scrollWheelZoom: true,
      zoomControl: true
    }).setView([DEFAULT_START.lat, DEFAULT_START.lng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    L.control.scale({ imperial: false, metric: true }).addTo(map);

    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const bounds = L.latLngBounds([]);

    routes.forEach((route) => {
      const latLngs = route.coordinates.map((point) => [point.lat, point.lng]);
      latLngs.forEach((point) => bounds.extend(point));

      L.polyline(latLngs, {
        color: route.color,
        interactive: true,
        lineCap: 'round',
        lineJoin: 'round',
        opacity: selectedRouteId === route.id ? 0.96 : 0.42,
        weight: selectedRouteId === route.id ? 8 : 5
      })
        .bindTooltip(`${route.name} · ${route.distanceKm} km`, { sticky: true })
        .on('click', () => onSelectRoute(route.id))
        .addTo(layer);
    });

    const start = selectedRoute.coordinates[0];
    L.circleMarker([start.lat, start.lng], {
      color: '#155f47',
      fillColor: '#ffffff',
      fillOpacity: 1,
      radius: 9,
      weight: 4
    })
      .bindPopup('Start')
      .addTo(layer);

    if (selectedRoute.routeType === 'one-way') {
      const finish = selectedRoute.finish;
      L.circleMarker([finish.lat, finish.lng], {
        color: selectedRoute.color,
        fillColor: '#ffffff',
        fillOpacity: 1,
        radius: 8,
        weight: 4
      })
        .bindPopup('Finish near transit access')
        .addTo(layer);
    }

    selectedRoute.stops.forEach((stop) => {
      const point = interpolateRoutePoint(selectedRoute, stop.km);
      L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: `stopMarker ${stop.type}`,
          html: `<span>${STOP_SYMBOLS[stop.type]}</span>`,
          iconAnchor: [15, 15],
          iconSize: [30, 30],
          popupAnchor: [0, -14]
        })
      })
        .bindPopup(`${stop.name}<br>${stop.km} km`)
        .addTo(layer);
    });

    if (bounds.isValid()) {
      const maxZoom = selectedRoute.distanceKm < 3 ? 16 : selectedRoute.distanceKm < 8 ? 15 : 14;
      map.fitBounds(bounds, {
        animate: false,
        maxZoom,
        padding: [28, 28]
      });
    }
  }, [onSelectRoute, routes, selectedRoute, selectedRouteId]);

  return (
    <section className="mapPanel" aria-label="Route map">
      <div className="mapToolbar">
        <div>
          <span className="eyebrow">Map preview</span>
          <h2>Generated nearby routes</h2>
        </div>
        <div className="mapLegend">
          {routes.map((route) => (
            <button
              className={`legendButton ${selectedRouteId === route.id ? 'active' : ''}`}
              key={route.id}
              onClick={() => onSelectRoute(route.id)}
              type="button"
            >
              <span style={{ background: route.color }} />
              {route.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mapCanvas">
        <div ref={mapElementRef} className="leafletMap" role="img" aria-label="Interactive street map with routes" />
        <div className={`mapHint ${routing ? 'loading' : ''}`}>
          <MapPin aria-hidden="true" size={16} />
          {routing
            ? 'Snapping routes to streets and paths'
            : selectedRoute.source === 'road'
              ? 'Street/path-snapped route lines'
              : 'Estimated route preview'}
        </div>
      </div>
    </section>
  );
}

function RouteCard({ route, selected, onSelect, onSave, isSaved }) {
  return (
    <article className={`routeCard ${selected ? 'selected' : ''}`}>
      <button className="routeCardButton" onClick={onSelect} type="button">
        <span className="routeColor" style={{ background: route.color }} />
        <span>
          <strong>{route.name}</strong>
          <small>{route.description}</small>
        </span>
        <ChevronRight aria-hidden="true" size={20} />
      </button>
      <div className="routeMetrics">
        <Stat icon={Route} label="Distance" value={formatDistance(route.distanceKm)} />
        <Stat icon={Timer} label="Time" value={route.estimatedTime} />
        <Stat icon={Mountain} label="Gain" value={`${route.elevationGain} m`} />
      </div>
      <ScoreMeter label="Safety" value={route.safetyScore} />
      <ScoreMeter label="Difficulty" value={route.difficultyScore} tone="orange" />
      <button className="secondaryButton fullWidth" onClick={onSave} type="button">
        {isSaved ? <Check aria-hidden="true" size={17} /> : <Save aria-hidden="true" size={17} />}
        {isSaved ? 'Saved' : 'Save route'}
      </button>
    </article>
  );
}

function PlannerForm({ form, setForm, onGenerate, onUseLocation, locating, routing }) {
  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="plannerPanel" aria-label="Route input">
      <div className="brandBlock">
        <span className="logoMark">
          <Navigation aria-hidden="true" size={22} />
        </span>
        <div>
          <p className="eyebrow">LongRun Route Planner</p>
          <h1>Plan your long run</h1>
        </div>
      </div>

      <div className="fieldGroup">
        <label htmlFor="startLocation">Starting location</label>
        <div className="inputWithButton">
          <input
            id="startLocation"
            value={form.startLabel}
            onChange={(event) => update('startLabel', event.target.value)}
            placeholder="Address, landmark, or trailhead"
          />
          <button className="iconButton" onClick={onUseLocation} type="button" title="Use current location">
            <LocateFixed aria-hidden="true" size={19} />
            <span className="srOnly">Use current location</span>
          </button>
        </div>
        <span className="fieldNote">{locating ? 'Finding location...' : `${form.start.lat}, ${form.start.lng}`}</span>
      </div>

      <div className="twoColumn">
        <div className="fieldGroup">
          <label htmlFor="distanceKm">Distance</label>
          <div className="numberInput">
            <input
              id="distanceKm"
              min={MIN_DISTANCE_KM}
              max="60"
              step="0.1"
              type="number"
              value={form.distanceKm}
              onChange={(event) => update('distanceKm', event.target.value)}
            />
            <span>km</span>
          </div>
        </div>
        <div className="fieldGroup">
          <label htmlFor="pace">Pace</label>
          <div className="numberInput">
            <input
              id="pace"
              min="3"
              max="12"
              step="0.1"
              type="number"
              value={form.paceMinPerKm}
              onChange={(event) => update('paceMinPerKm', event.target.value)}
            />
            <span>min/km</span>
          </div>
        </div>
      </div>

      <div className="fieldGroup">
        <label>Route type</label>
        <div className="segmentedControl" role="group" aria-label="Route type">
          {ROUTE_TYPES.map((type) => (
            <button
              className={form.routeType === type.id ? 'active' : ''}
              key={type.id}
              onClick={() => update('routeType', type.id)}
              type="button"
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fieldGroup">
        <label>Route style</label>
        <div className="styleGrid">
          {STYLE_OPTIONS.map((style) => {
            const Icon = style.icon;
            return (
              <button
                className={form.style === style.id ? 'styleOption active' : 'styleOption'}
                key={style.id}
                onClick={() => update('style', style.id)}
                type="button"
                title={style.label}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{style.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="fieldGroup">
        <label htmlFor="trainingGoal">Training mode</label>
        <select
          id="trainingGoal"
          value={form.trainingGoal}
          onChange={(event) => update('trainingGoal', event.target.value)}
        >
          {TRAINING_GOALS.map((goal) => (
            <option key={goal}>{goal}</option>
          ))}
        </select>
      </div>

      <button className="primaryButton" disabled={routing} onClick={onGenerate} type="button">
        <RefreshCcw aria-hidden="true" size={18} />
        {routing ? 'Snapping routes...' : 'Generate 3 routes'}
      </button>
    </section>
  );
}

function RouteDetails({ route, onExportGpx, onExportKml, onShare }) {
  if (!route) return null;

  const weatherTone = route.distanceKm >= 30 ? 'Long-run hydration window' : 'Comfortable training window';
  const stopsByKm = route.stops.map((stop) => `${stop.name} at ${stop.km} km`).join(', ');
  const directions = [
    'Leave start point on the quiet connector path',
    route.routeType === 'one-way'
      ? 'Hold the broad outbound line toward the transit finish'
      : 'Build the outer arc without repeating the same road',
    route.style === 'parks' || route.style === 'scenic'
      ? 'Use the park corridor through the middle kilometers'
      : 'Stay on lower-traffic streets through the middle kilometers',
    `Plan the main climb near ${route.hardestClimb}`,
    route.routeType === 'one-way' ? 'Finish near transit access' : 'Return to the start from the opposite approach'
  ];

  return (
    <aside className="detailsPanel" aria-label="Route details">
      <div className="detailsHeader">
        <div>
          <span className="eyebrow">Selected route</span>
          <h2>{route.name}</h2>
        </div>
        <span className="routeBadge" style={{ borderColor: route.color }}>
          {route.label}
        </span>
      </div>

      <div className="detailsStats">
        <Stat icon={ShieldCheck} label="Safety" value={`${route.safetyScore}/100`} />
        <Stat icon={Activity} label="Difficulty" value={`${route.difficultyScore}/100`} />
        <Stat icon={Timer} label="Pace" value={route.pace} />
      </div>

      <section className="weatherStrip">
        <CloudSun aria-hidden="true" size={22} />
        <div>
          <strong>{weatherTone}</strong>
          <span>12 C, light wind, no precipitation flag, bring electrolytes for routes over 25 km.</span>
        </div>
      </section>

      <section className="detailSection">
        <h3>Elevation profile</h3>
        <div className="elevationChart" aria-label="Elevation profile">
          <svg viewBox="0 0 420 120" role="img" aria-label="Route elevation graph">
            <path
              d="M 8 96 C 54 88, 70 56, 112 72 S 180 98, 218 54 S 278 30, 318 68 S 370 86, 412 34"
              fill="none"
              stroke={route.color}
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path d="M 8 104 L 412 104" stroke="#cbd6c6" strokeWidth="2" />
          </svg>
        </div>
        <p className="compactCopy">
          {route.elevationGain} m gain. Hardest climb: {route.hardestClimb}.
        </p>
      </section>

      <section className="detailSection">
        <h3>Stops</h3>
        {route.stops.length > 0 ? (
          <div className="stopList">
            {route.stops.map((stop) => {
              const StopIcon = STOP_TYPES[stop.type].icon;
              return (
                <div className="stopItem" key={stop.id}>
                  <StopIcon aria-hidden="true" size={18} />
                  <span>{stop.name}</span>
                  <strong>{stop.km} km</strong>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="compactCopy">No planned stops needed for this short route.</p>
        )}
      </section>

      <section className="detailSection">
        <h3>Run plan</h3>
        <div className="runPlan">
          <div>
            <Droplets aria-hidden="true" size={18} />
            <span>{route.nutrition}</span>
          </div>
          <div>
            <Train aria-hidden="true" size={18} />
            <span>{route.routeType === 'one-way' ? 'Finish near transit' : 'Transit access within final 2 km'}</span>
          </div>
          <div>
            <AlertTriangle aria-hidden="true" size={18} />
            <span>{stopsByKm || 'No stop detours added for this distance'}</span>
          </div>
        </div>
      </section>

      <section className="detailSection">
        <h3>Directions</h3>
        <ol className="directionsList">
          {directions.map((direction) => (
            <li key={direction}>{direction}</li>
          ))}
        </ol>
      </section>

      <div className="actionRow">
        <button className="secondaryButton" onClick={onExportGpx} type="button">
          <ArrowDownToLine aria-hidden="true" size={17} />
          GPX
        </button>
        <button className="secondaryButton" onClick={onExportKml} type="button">
          <ArrowDownToLine aria-hidden="true" size={17} />
          KML
        </button>
        <button className="secondaryButton" onClick={onShare} type="button">
          <Share2 aria-hidden="true" size={17} />
          Share
        </button>
      </div>
    </aside>
  );
}

function SavedRoutes({ routes, onSelect, onDelete }) {
  const [filter, setFilter] = useState('all');
  const filteredRoutes =
    filter === 'all' ? routes : routes.filter((route) => route.routeType === filter || route.style === filter);

  return (
    <section className="savedPanel" aria-label="Saved routes">
      <div className="savedHeader">
        <div>
          <span className="eyebrow">Saved routes</span>
          <h2>Favourite and planned runs</h2>
        </div>
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Saved route filter">
          <option value="all">All routes</option>
          <option value="loop">Loop</option>
          <option value="one-way">One-way</option>
          <option value="scenic">Scenic</option>
          <option value="flat">Flat</option>
          <option value="parks">Park/trail</option>
        </select>
      </div>

      {filteredRoutes.length === 0 ? (
        <div className="emptyState">
          <CalendarClock aria-hidden="true" size={30} />
          <strong>No saved routes yet</strong>
          <span>Saved routes will appear here with filters and export actions.</span>
        </div>
      ) : (
        <div className="savedGrid">
          {filteredRoutes.map((route) => (
            <article className="savedCard" key={route.savedId}>
              <div className="savedCardTop">
                <span className="routeColor" style={{ background: route.color }} />
                <div>
                  <strong>{route.name}</strong>
                  <small>
                    {formatDistance(route.distanceKm)} · {route.estimatedTime} · {route.routeType}
                  </small>
                </div>
              </div>
              <p>{route.description}</p>
              <div className="savedActions">
                <button className="secondaryButton" onClick={() => onSelect(route)} type="button">
                  Open
                </button>
                <button className="textButton" onClick={() => onDelete(route.savedId)} type="button">
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function App() {
  const initialForm = {
    start: DEFAULT_START,
    startLabel: DEFAULT_START.label,
    distanceKm: 20,
    paceMinPerKm: 7,
    routeType: 'scenic',
    style: 'parks',
    trainingGoal: 'Marathon prep'
  };
  const [form, setForm] = useState(initialForm);
  const [routes, setRoutes] = useState(() => generateEstimatedRoutes(initialForm));
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0].id);
  const [savedRoutes, setSavedRoutes] = useLocalStorageState('longrun.savedRoutes', []);
  const [activeTab, setActiveTab] = useState('planner');
  const [locating, setLocating] = useState(false);
  const [routing, setRouting] = useState(false);
  const [toast, setToast] = useState('');
  const routeRequestRef = useRef(0);
  const initialRoutingRef = useRef(false);

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) || routes[0],
    [routes, selectedRouteId]
  );

  const savedIds = useMemo(() => new Set(savedRoutes.map((route) => route.id)), [savedRoutes]);

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  const handleFormChange = (updater) => {
    routeRequestRef.current += 1;
    setRouting(false);
    setForm(updater);
  };

  const generateAndApplyRoutes = async (sourceForm, options = {}) => {
    const normalizedForm = normalizeRouteForm(sourceForm);
    const requestId = routeRequestRef.current + 1;
    routeRequestRef.current = requestId;

    setForm(normalizedForm);
    setActiveTab('planner');
    setRouting(true);

    const estimatedRoutes = generateEstimatedRoutes(normalizedForm);
    setRoutes(estimatedRoutes);
    setSelectedRouteId(estimatedRoutes[0].id);

    if (!options.silent) showToast('Snapping routes to streets and paths');

    try {
      const roadRoutes = await generateRoadSnappedRoutes(normalizedForm);
      if (routeRequestRef.current !== requestId) return;
      setRoutes(roadRoutes);
      setSelectedRouteId(roadRoutes[0].id);
      if (!options.silent) showToast('Routes now follow streets and paths');
    } catch {
      if (routeRequestRef.current !== requestId) return;
      if (!options.silent) showToast('Routing service unavailable; showing estimated preview');
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false);
    }
  };

  useEffect(() => {
    if (initialRoutingRef.current) return;
    initialRoutingRef.current = true;
    void generateAndApplyRoutes(initialForm, { silent: true });
  }, []);

  const handleGenerate = () => {
    void generateAndApplyRoutes(form);
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is unavailable in this browser');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextStart = {
          lat: round(position.coords.latitude, 5),
          lng: round(position.coords.longitude, 5),
          label: 'Current location'
        };
        routeRequestRef.current += 1;
        setRouting(false);
        setForm((current) => ({
          ...current,
          start: nextStart,
          startLabel: 'Current location'
        }));
        setLocating(false);
        showToast('Start location updated');
      },
      () => {
        setLocating(false);
        showToast('Location permission was not granted');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const saveRoute = (route) => {
    if (savedIds.has(route.id)) {
      showToast('Route already saved');
      return;
    }

    setSavedRoutes((current) => [
      {
        ...route,
        savedId: `${route.id}-${Date.now()}`,
        savedAt: new Date().toISOString()
      },
      ...current
    ]);
    showToast('Route saved');
  };

  const deleteSavedRoute = (savedId) => {
    setSavedRoutes((current) => current.filter((route) => route.savedId !== savedId));
    showToast('Saved route deleted');
  };

  const openSavedRoute = (route) => {
    setRoutes([route, ...routes.filter((candidate) => candidate.id !== route.id)].slice(0, 3));
    setSelectedRouteId(route.id);
    setActiveTab('planner');
  };

  const exportSelected = (format) => {
    const safeName = selectedRoute.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (format === 'gpx') {
      downloadFile(`${safeName}.gpx`, createGpx(selectedRoute), 'application/gpx+xml');
      showToast('GPX exported');
    } else {
      downloadFile(`${safeName}.kml`, createKml(selectedRoute), 'application/vnd.google-earth.kml+xml');
      showToast('KML exported');
    }
  };

  const shareSelected = async () => {
    const shareText = `${selectedRoute.name}: ${selectedRoute.distanceKm} km, ${selectedRoute.estimatedTime}, safety ${selectedRoute.safetyScore}/100. Start: ${form.startLabel}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: selectedRoute.name, text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        showToast('Share summary copied');
      }
    } catch {
      showToast('Share was cancelled');
    }
  };

  return (
    <main className="appShell">
      <div className="topNav" aria-label="Primary">
        <button
          className={activeTab === 'planner' ? 'active' : ''}
          onClick={() => setActiveTab('planner')}
          type="button"
        >
          <Compass aria-hidden="true" size={18} />
          Planner
        </button>
        <button
          className={activeTab === 'saved' ? 'active' : ''}
          onClick={() => setActiveTab('saved')}
          type="button"
        >
          <Save aria-hidden="true" size={18} />
          Saved
        </button>
      </div>

      {activeTab === 'planner' ? (
        <div className="plannerLayout">
          <PlannerForm
            form={form}
            setForm={handleFormChange}
            onGenerate={handleGenerate}
            onUseLocation={handleUseLocation}
            locating={locating}
            routing={routing}
          />
          <div className="resultsColumn">
            <RouteMap
              routes={routes}
              selectedRouteId={selectedRouteId}
              onSelectRoute={setSelectedRouteId}
              routing={routing}
            />
            <div className="rangeNotice">
              <ShieldCheck aria-hidden="true" size={18} />
              <span>
                Target range: <strong>{selectedRoute.targetRange}</strong> · Lines:{' '}
                <strong>{selectedRoute.source === 'road' ? 'streets/paths' : 'estimated'}</strong>
              </span>
            </div>
            <div className="routeList">
              {routes.map((route) => (
                <RouteCard
                  key={route.id}
                  route={route}
                  selected={selectedRouteId === route.id}
                  onSelect={() => setSelectedRouteId(route.id)}
                  onSave={() => saveRoute(route)}
                  isSaved={savedIds.has(route.id)}
                />
              ))}
            </div>
          </div>
          <RouteDetails
            route={selectedRoute}
            onExportGpx={() => exportSelected('gpx')}
            onExportKml={() => exportSelected('kml')}
            onShare={shareSelected}
          />
        </div>
      ) : (
        <SavedRoutes routes={savedRoutes} onSelect={openSavedRoute} onDelete={deleteSavedRoute} />
      )}

      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
