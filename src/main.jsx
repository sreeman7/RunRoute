import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Bike,
  Bot,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  CloudSun,
  Coffee,
  Compass,
  Database,
  Droplets,
  Flame,
  Footprints,
  LocateFixed,
  MapPin,
  Moon,
  Mountain,
  Navigation,
  Pause,
  Play,
  RefreshCcw,
  Route,
  Save,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Timer,
  Toilet,
  Train,
  Trees,
  Trophy,
  Volume2,
  VolumeX,
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
const AI_API_BASE_URL = import.meta.env.VITE_AI_API_BASE_URL || 'http://127.0.0.1:8787';
const RUNROUTE_USER_ID = 'demo-runner';

const ROUTE_TYPES = [
  { id: 'loop', label: 'Loop' },
  { id: 'one-way', label: 'One-way' },
  { id: 'out-and-back', label: 'Out-back' },
  { id: 'scenic', label: 'Scenic' }
];

const AGENT_MODES = [
  { id: 'marathon', label: 'Marathon', trainingGoal: 'Marathon prep', style: 'flat', routeType: 'loop' },
  { id: 'recovery', label: 'Recovery', trainingGoal: 'Recovery run', style: 'beginner', routeType: 'loop' },
  { id: 'safe-night', label: 'Safe night', trainingGoal: 'Easy long run', style: 'night', routeType: 'loop' },
  { id: 'scenic', label: 'Scenic', trainingGoal: 'Trail endurance', style: 'parks', routeType: 'scenic' },
  { id: 'speedwork', label: 'Speedwork', trainingGoal: 'Tempo route', style: 'road', routeType: 'loop' },
  { id: 'adventure', label: 'Adventure', trainingGoal: 'Trail endurance', style: 'scenic', routeType: 'one-way' },
  { id: 'tourist', label: 'Tourist', trainingGoal: 'Easy long run', style: 'scenic', routeType: 'loop' }
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

function noop() {}

function round(value, places = 1) {
  return Number((value + Number.EPSILON).toFixed(places));
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

function cumulativeRouteDistances(coordinates) {
  const distances = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    distances.push(distances[index - 1] + haversineDistanceKm(coordinates[index - 1], coordinates[index]));
  }
  return distances;
}

function bearingBetween(first, second) {
  const lat1 = toRadians(first.lat);
  const lat2 = toRadians(second.lat);
  const deltaLng = toRadians(second.lng - first.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function normalizeBearingDelta(delta) {
  return ((delta + 540) % 360) - 180;
}

function turnInstruction(delta) {
  const absolute = Math.abs(delta);
  if (absolute < 25) return 'Continue straight';
  if (absolute < 55) return delta > 0 ? 'Slight right' : 'Slight left';
  if (absolute < 125) return delta > 0 ? 'Turn right' : 'Turn left';
  return 'Turn around';
}

function formatClock(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatRunPace(distanceKm, elapsedSeconds) {
  if (!distanceKm || distanceKm < 0.01 || !elapsedSeconds) return '-- /km';
  return formatPace(elapsedSeconds / 60 / distanceKm);
}

function canUseVoiceDirections() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function formatVoiceDistance(distanceKm) {
  if (distanceKm <= 0.04) return 'now';
  if (distanceKm < 1) {
    const meters = Math.max(20, Math.round((distanceKm * 1000) / 10) * 10);
    return `in ${meters} meters`;
  }
  return `in ${round(distanceKm, 1)} kilometers`;
}

function buildSpokenInstruction(step, distanceAheadKm) {
  if (!step) return '';
  if (step.id === 'start') return `${step.instruction}. Begin recording and follow the highlighted route.`;
  if (step.id === 'finish') return `Finish ${formatVoiceDistance(distanceAheadKm)}. Great work.`;
  return `${step.instruction} ${formatVoiceDistance(distanceAheadKm)}.`;
}

function speakDirections(text, options = {}) {
  if (!text || !canUseVoiceDirections()) return false;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;

  if (options.interrupt !== false) {
    window.speechSynthesis.cancel();
  }

  window.speechSynthesis.speak(utterance);
  return true;
}

function getNextRunStep(steps, routeProgressKm) {
  if (!steps.length) return null;
  if (routeProgressKm <= 0.04) return steps[0];
  return steps.find((step) => step.distanceKm > routeProgressKm + 0.04) || steps[steps.length - 1];
}

function buildNavigationSteps(route) {
  if (!route?.coordinates?.length) return [];

  const coordinates = route.coordinates;
  const cumulative = cumulativeRouteDistances(coordinates);
  const steps = [
    {
      id: 'start',
      distanceKm: 0,
      instruction: `Start ${route.name}`,
      note: 'Begin recording and follow the highlighted route.'
    }
  ];
  let lastStepDistance = 0;
  let previousBearing = null;

  for (let index = 1; index < coordinates.length; index += 1) {
    const currentBearing = bearingBetween(coordinates[index - 1], coordinates[index]);
    if (previousBearing !== null) {
      const delta = normalizeBearingDelta(currentBearing - previousBearing);
      const distanceSinceLastStep = cumulative[index] - lastStepDistance;
      if (Math.abs(delta) >= 34 && distanceSinceLastStep >= 0.18) {
        steps.push({
          id: `turn-${index}`,
          distanceKm: cumulative[index],
          instruction: turnInstruction(delta),
          note: `At ${formatDistance(cumulative[index])}, continue on the selected route.`
        });
        lastStepDistance = cumulative[index];
      }
    }
    previousBearing = currentBearing;
  }

  route.stops?.forEach((stop) => {
    steps.push({
      id: `stop-${stop.id}`,
      distanceKm: stop.km,
      instruction: `${STOP_TYPES[stop.type].label} stop nearby`,
      note: `${stop.name} around ${formatDistance(stop.km)}.`
    });
  });

  steps.push({
    id: 'finish',
    distanceKm: route.distanceKm,
    instruction: 'Finish route',
    note: route.routeType === 'one-way' ? 'Finish near the planned endpoint.' : 'Return to the start area.'
  });

  return steps
    .sort((first, second) => first.distanceKm - second.distanceKm)
    .filter((step, index, allSteps) => index === 0 || Math.abs(step.distanceKm - allSteps[index - 1].distanceKm) > 0.05);
}

function getRouteProgress(route, position) {
  if (!route?.coordinates?.length || !position) {
    return { nearestDistanceM: null, progressKm: 0, progressPercent: 0 };
  }

  const cumulative = cumulativeRouteDistances(route.coordinates);
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  route.coordinates.forEach((point, index) => {
    const distance = haversineDistanceKm(point, position);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  const progressKm = cumulative[nearestIndex] || 0;
  return {
    nearestDistanceM: Math.round(nearestDistance * 1000),
    progressKm,
    progressPercent: clamp((progressKm / Math.max(route.distanceKm, 0.1)) * 100, 0, 100)
  };
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
  const totalSeconds = Math.round(decimalPace * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
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

function estimatedScaleCandidates(targetKm, routeType) {
  if (targetKm < 3) return [0.05, 0.08, 0.12, 0.16, 0.2, 0.25, 0.32, 0.42, 0.55, 0.7, 0.9, 1.12, 1.25, 1.4, 1.6];
  if (routeType === 'one-way') return [0.55, 0.66, 0.78, 0.9, 1, 1.12, 1.28, 1.45, 1.65];
  if (routeType === 'out-and-back') return [0.45, 0.55, 0.66, 0.75, 0.84, 0.94, 1, 1.12, 1.28];
  return [0.45, 0.55, 0.62, 0.7, 0.78, 0.8, 0.82, 0.86, 0.94, 1, 1.08, 1.2, 1.35];
}

function buildDistanceMatchedCoordinates(start, desiredDistance, routeType, style, index) {
  let bestCoordinates = null;
  let bestGap = Number.POSITIVE_INFINITY;
  let bestScale = 1;
  const evaluateScale = (scale) => {
    const coordinates = buildCoordinates(start, desiredDistance, routeType, style, index, scale);
    const distance = routeDistanceKm(coordinates);
    const gap = Math.abs(distance - desiredDistance);

    if (gap < bestGap) {
      bestCoordinates = coordinates;
      bestGap = gap;
      bestScale = scale;
    }
    return distance;
  };

  evaluateScale(1);
  estimatedScaleCandidates(desiredDistance, routeType).forEach(evaluateScale);

  const bestDistance = routeDistanceKm(bestCoordinates);
  if (bestDistance > 0) {
    const correctionScale = clamp(bestScale * (desiredDistance / bestDistance), 0.04, 2.2);
    evaluateScale(correctionScale);
  }

  return bestCoordinates;
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

function modeLabel(modeId) {
  return AGENT_MODES.find((mode) => mode.id === modeId)?.label || 'Marathon';
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
  const routeNames = ['Alpha', 'Pulse', 'Horizon'];
  const name = routeNames[index];
  const actualDistance = sourceDistanceKm || routeDistanceKm(coordinates) || desiredDistanceKm;
  const distance = round(actualDistance, distancePrecision(actualDistance));
  const distanceGap = Math.abs(distance - target);
  const distanceTolerance = Math.max(target * 0.025, 0.03);
  const distanceStatus = distanceGap <= distanceTolerance ? 'Within target range' : 'Closest road match';
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
  const scenicScore = clamp(
    66 + (style === 'parks' || style === 'scenic' ? 20 : 0) + (routeType === 'scenic' ? 10 : 0) - index * 3,
    45,
    98
  );
  const hydrationScore = clamp(54 + stops.length * 9 + (distance > 24 ? 6 : 0), 38, 96);
  const interruptionScore = clamp(92 - index * 9 - (routeType === 'one-way' ? 3 : 0), 50, 95);
  const modeFit = clamp(
    Math.round(
      safetyScore * 0.34 +
        (100 - difficultyScore) * (form.agentMode === 'recovery' ? 0.3 : 0.18) +
        scenicScore * (form.agentMode === 'scenic' || form.agentMode === 'tourist' ? 0.28 : 0.12) +
        hydrationScore * (distance >= 16 ? 0.2 : 0.1) +
        interruptionScore * (form.agentMode === 'speedwork' ? 0.25 : 0.12)
    ),
    40,
    98
  );
  const finish = coordinates[coordinates.length - 1];

  return {
    id: `${routeType}-${style}-${target}-${index}-${source}`,
    name,
    label: index === 0 ? 'Safest' : index === 1 ? 'Most scenic' : 'Flattest',
    description: trainingRecommendation(form.trainingGoal, style, distance),
    distanceKm: distance,
    distanceGap: round(distanceGap, distancePrecision(distanceGap || target)),
    distanceStatus,
    targetRange: routeRangeLabel(target),
    estimatedTime: formatDuration(distance, Number(form.paceMinPerKm)),
    pace: formatPace(Number(form.paceMinPerKm)),
    safetyScore: Math.round(safetyScore),
    difficultyScore,
    hydrationScore: Math.round(hydrationScore),
    interruptionScore: Math.round(interruptionScore),
    modeFit,
    scenicScore: Math.round(scenicScore),
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
  const start = form.start || DEFAULT_START;

  return ['Safest Corridor', 'Scenic Flow', 'Flat Finish'].map((_, index) => {
    const variance = [-0.012, 0.009, 0.018][index] * target;
    const desiredDistance = clamp(target + variance, target * 0.975, target * 1.025);
    const coordinates = buildDistanceMatchedCoordinates(start, desiredDistance, form.routeType, form.style, index);
    return createRoute(form, index, desiredDistance, coordinates);
  });
}

function routeScaleCandidates(form, desiredDistance) {
  if (form.routeType === 'one-way') return [0.55, 0.66, 0.78, 0.9, 1, 1.12, 1.28, 1.45, 1.7];
  if (form.routeType === 'out-and-back') return [0.45, 0.55, 0.66, 0.75, 0.85, 1, 1.15, 1.3, 1.55];
  if (desiredDistance < 3) return [0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.42, 0.5, 0.62, 0.78, 0.95, 1.15, 1.4];
  return [0.45, 0.55, 0.62, 0.7, 0.78, 0.8, 0.82, 0.86, 0.95, 1.08];
}

function routeShapeCandidates(index, desiredDistance, routeType) {
  if (routeType === 'out-and-back') {
    return [index, index + 13, index + 14, index + 15, index + 16, index + 1, index + 2];
  }
  if (desiredDistance < 3) {
    return [index, index + 13, index + 4, index + 5, index + 16, index + 17, index + 1, index + 2, index + 6, index + 12];
  }
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

  for (const shapeIndex of routeShapeCandidates(index, desiredDistance, form.routeType)) {
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

  if (!bestRoute?.coordinates?.length) {
    throw new Error('No street/path route match found');
  }

  return createRoute(form, index, desiredDistance, bestRoute.coordinates, 'road', bestRoute.distanceKm);
}

async function generateRoadSnappedRoutes(form) {
  const snappedRoutes = await Promise.all([0, 1, 2].map((index) => snapRouteToRoads(form, index)));
  return snappedRoutes;
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
<gpx version="1.1" creator="RunRoute AI">
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

function buildRunnerMemory(savedRoutes) {
  if (savedRoutes.length === 0) {
    return {
      averageDistance: 0,
      favoriteStyle: 'parks',
      lastRoute: null,
      savedCount: 0,
      totalDistance: 0
    };
  }

  const totalDistance = savedRoutes.reduce((sum, route) => sum + Number(route.distanceKm || 0), 0);
  const styleCounts = savedRoutes.reduce((counts, route) => {
    counts[route.style] = (counts[route.style] || 0) + 1;
    return counts;
  }, {});
  const favoriteStyle = Object.entries(styleCounts).sort((first, second) => second[1] - first[1])[0]?.[0] || 'parks';

  return {
    averageDistance: round(totalDistance / savedRoutes.length, 1),
    favoriteStyle,
    lastRoute: savedRoutes[0],
    savedCount: savedRoutes.length,
    totalDistance: round(totalDistance, 1)
  };
}

function routeBestUse(route, form) {
  if (form.agentMode === 'recovery' || route.difficultyScore < 32) return 'Recovery run';
  if (form.agentMode === 'speedwork' || route.interruptionScore > 84) return 'Tempo work';
  if (form.agentMode === 'safe-night' || route.safetyScore >= 92) return 'Safe night run';
  if (route.scenicScore >= 88) return 'Scenic exploration';
  if (route.distanceKm >= 18) return 'Marathon endurance';
  return 'Easy long run';
}

function analyzeRoutes(routes, selectedRoute, form, memory) {
  const scoredRoutes = [...routes].sort((first, second) => second.modeFit - first.modeFit);
  const bestRoute = scoredRoutes[0] || selectedRoute;
  const savedMemory = memory.savedCount > 0;
  const mode = modeLabel(form.agentMode);
  const comparison = routes.map((route) => ({
    id: route.id,
    name: route.name,
    bestFor: routeBestUse(route, form),
    fit: route.modeFit
  }));
  const selected = selectedRoute || bestRoute;
  const fatigueNote =
    selected.difficultyScore < 38
      ? 'low fatigue load'
      : selected.difficultyScore < 62
        ? 'moderate endurance load'
        : 'high fatigue load';
  const hydrationNote =
    selected.stops.length > 0
      ? `${selected.stops.length} useful stops along the route`
      : 'no planned stop detours needed for this distance';

  return {
    bestRoute,
    headline: `${bestRoute.name} is the strongest ${mode.toLowerCase()} choice.`,
    recommendation: `${bestRoute.name} balances ${formatDistance(bestRoute.distanceKm)}, ${bestRoute.safetyScore}/100 safety, ${hydrationNote}, and ${fatigueNote}.`,
    comparison,
    reasoning: [
      `Best match score: ${bestRoute.modeFit}/100 for ${mode}.`,
      `Safety: ${bestRoute.safetyScore}/100 with route lines snapped to streets and paths.`,
      `Training load: ${bestRoute.difficultyScore}/100 with ${bestRoute.elevationGain} m gain.`,
      `Hydration: ${hydrationNote}.`
    ],
    safety: [
      form.agentMode === 'safe-night'
        ? 'Night mode prioritizes safer corridors, transit access, and lower isolation.'
        : 'Safety score favors lower traffic, parks/paths, and practical exit points.',
      selected.routeType === 'one-way'
        ? 'One-way route should finish near transit before committing to the full run.'
        : 'Loop route keeps the finish close to the start area.'
    ],
    weather: [
      selected.distanceKm >= 25
        ? 'Long-run hydration window: carry electrolytes and plan a refill.'
        : 'Comfortable training window: light wind and no precipitation flag in the demo model.',
      selected.distanceKm >= 30 ? 'Fuel early; avoid waiting until fatigue starts.' : 'Normal clothing and water planning should be enough.'
    ],
    memory: savedMemory
      ? `Memory sees ${memory.savedCount} saved route${memory.savedCount === 1 ? '' : 's'}, ${memory.totalDistance} km total, and a preference for ${memory.favoriteStyle}.`
      : 'Memory is ready; save a route and the agent will start adapting future suggestions.',
    adaptive: savedMemory
      ? `Next run can bias toward ${memory.favoriteStyle} and stay near your ${memory.averageDistance} km saved-route average.`
      : 'After one saved route, the agent can personalize distance, terrain, and difficulty.',
    mongodb: 'MongoDB Atlas/MCP-ready memory surface: profile, route history, preferences, and AI notes can map directly to collections.'
  };
}

function buildAiRequestPayload(routes, form) {
  return {
    routes: routes.map((route) => ({
      id: route.id,
      name: route.name,
      label: route.label,
      description: route.description,
      distanceKm: route.distanceKm,
      routeType: route.routeType,
      style: route.style,
      safetyScore: route.safetyScore,
      difficultyScore: route.difficultyScore,
      hydrationScore: route.hydrationScore,
      scenicScore: route.scenicScore,
      modeFit: route.modeFit,
      elevationGain: route.elevationGain,
      stops: route.stops
    })),
    distance: Number(form.distanceKm),
    pace: formatPace(Number(form.paceMinPerKm)),
    trainingGoal: form.trainingGoal,
    routeStyle: form.style
  };
}

function routeMemoryRecord(route) {
  return {
    id: route.id,
    name: route.name,
    label: route.label,
    description: route.description,
    distanceKm: route.distanceKm,
    routeType: route.routeType,
    style: route.style,
    safetyScore: route.safetyScore,
    difficultyScore: route.difficultyScore,
    hydrationScore: route.hydrationScore,
    scenicScore: route.scenicScore,
    modeFit: route.modeFit,
    elevationGain: route.elevationGain,
    stops: route.stops,
    nutrition: route.nutrition,
    source: route.source
  };
}

function preferencePayload(form) {
  return {
    routeStyle: form.style,
    routeType: form.routeType,
    trainingGoal: form.trainingGoal,
    pace: formatPace(Number(form.paceMinPerKm)),
    distance: Number(form.distanceKm)
  };
}

async function postAiBackend(path, payload) {
  try {
    const response = await fetch(`${AI_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function localGeminiShape(analysis) {
  const route = analysis.bestRoute || {};
  return {
    bestRouteId: route.id || '',
    bestRouteName: route.name || 'Best route',
    confidence: route.modeFit || route.safetyScore || 82,
    whyThisRoute: analysis.recommendation,
    safetyAnalysis: analysis.safety[0],
    difficultyAnalysis: analysis.reasoning.find((reason) => reason.startsWith('Training load')) || analysis.reasoning[0],
    hydrationAdvice: analysis.weather[0],
    trainingRecommendation: analysis.adaptive || analysis.recommendation
  };
}

function buildNextRunPlan(memory) {
  if (!memory.lastRoute) {
    return 'Save a completed or planned route first, then I can adapt the next long run from your history.';
  }

  const nextDistance = round(clamp(Number(memory.lastRoute.distanceKm || memory.averageDistance || 20) + 2, 1, 60), 1);
  return `Based on your last ${formatDistance(memory.lastRoute.distanceKm)} run, your next long run should be ${formatDistance(
    nextDistance
  )} with lower elevation and more hydration stops.`;
}

function applyAgentPromptToForm(prompt, form) {
  const text = prompt.toLowerCase();
  const next = { ...form };
  const changes = [];
  const greetingPattern = /^(hi|hello|hey|yo|sup|thanks|thank you)[!. ]*$/i;

  if (greetingPattern.test(prompt.trim())) {
    return {
      form: next,
      response:
        'Hey. Tell me what kind of run you want and I will adapt the route. Try "avoid hills", "make it safer at night", "more scenic trails", or "shorter recovery run".',
      shouldGenerate: false
    };
  }

  if (text.includes('avoid hill') || text.includes('flat') || text.includes('leg pain') || text.includes('knee')) {
    next.style = 'flat';
    next.routeType = 'out-and-back';
    next.trainingGoal = text.includes('leg pain') || text.includes('knee') ? 'Recovery run' : next.trainingGoal;
    next.agentMode = text.includes('leg pain') || text.includes('knee') ? 'recovery' : next.agentMode;
    next.distanceKm = text.includes('leg pain') || text.includes('knee') ? round(clamp(Number(form.distanceKm) * 0.8, 1, 60), 1) : form.distanceKm;
    changes.push('reduced hill exposure');
    changes.push('used out-and-back geometry for better distance accuracy');
  }

  if (text.includes('night') || text.includes('safer') || text.includes('safe')) {
    next.style = 'night';
    next.agentMode = 'safe-night';
    next.routeType = 'loop';
    changes.push('prioritized safer night routing');
  }

  if (text.includes('scenic') || text.includes('trail') || text.includes('park')) {
    next.style = 'parks';
    next.routeType = 'scenic';
    next.agentMode = 'scenic';
    changes.push('biased toward scenic parks and trails');
  }

  if (text.includes('water') || text.includes('bathroom') || text.includes('stop')) {
    next.style = 'beginner';
    changes.push('favored routes with practical stops');
  }

  if (text.includes('tempo') || text.includes('speed')) {
    next.style = 'road';
    next.trainingGoal = 'Tempo route';
    next.agentMode = 'speedwork';
    next.routeType = 'loop';
    changes.push('switched to cleaner tempo terrain');
  }

  if (text.includes('longer')) {
    next.distanceKm = round(clamp(Number(form.distanceKm) + 2, 1, 60), 1);
    changes.push('increased distance');
  }

  if (text.includes('shorter') || text.includes('recovery')) {
    next.distanceKm = round(clamp(Number(form.distanceKm) * 0.85, 1, 60), 1);
    next.trainingGoal = 'Recovery run';
    next.agentMode = 'recovery';
    changes.push('lowered training load');
  }

  if (changes.length === 0) {
    return {
      form: next,
      response:
        'I did not detect a route change yet. Try asking for terrain, safety, distance, water stops, pace work, or recovery adjustments.',
      shouldGenerate: false
    };
  }

  return {
    form: next,
    response: `Adjusted: ${changes.join(', ')}.`,
    shouldGenerate: true
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

function RouteMap({ routes, selectedRouteId, onSelectRoute, routing, track = [] }) {
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

    if (track.length > 0) {
      const trackLatLngs = track.map((point) => [point.lat, point.lng]);
      trackLatLngs.forEach((point) => bounds.extend(point));

      if (trackLatLngs.length > 1) {
        L.polyline(trackLatLngs, {
          color: '#111827',
          lineCap: 'round',
          lineJoin: 'round',
          opacity: 0.88,
          weight: 5
        }).addTo(layer);
      }

      const currentPoint = track[track.length - 1];
      L.circleMarker([currentPoint.lat, currentPoint.lng], {
        color: '#111827',
        fillColor: '#ffffff',
        fillOpacity: 1,
        radius: 7,
        weight: 3
      })
        .bindPopup('Current position')
        .addTo(layer);
    }

    if (bounds.isValid()) {
      const maxZoom = selectedRoute.distanceKm < 3 ? 16 : selectedRoute.distanceKm < 8 ? 15 : 14;
      map.fitBounds(bounds, {
        animate: false,
        maxZoom,
        padding: [28, 28]
      });
    }
  }, [routes, selectedRoute, selectedRouteId, track]);

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

function RouteCard({ route, selected, onSelect, onSave, isSaved, bestFor }) {
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
      <div className="aiCardStrip">
        <span>
          <Brain aria-hidden="true" size={15} />
          {bestFor}
        </span>
        <strong>{route.modeFit}/100 fit</strong>
      </div>
      <div className="miniScores">
        <span>Scenic {route.scenicScore}</span>
        <span>Hydration {route.hydrationScore}</span>
      </div>
      <div className={`distanceBadge ${route.distanceStatus === 'Within target range' ? 'good' : 'warning'}`}>
        {route.distanceStatus}
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
  const applyMode = (mode) => {
    setForm((current) => ({
      ...current,
      agentMode: mode.id,
      routeType: mode.routeType,
      style: mode.style,
      trainingGoal: mode.trainingGoal
    }));
  };

  return (
    <section className="plannerPanel" aria-label="Route input">
      <div className="brandBlock">
        <span className="logoMark">
          <Navigation aria-hidden="true" size={22} />
        </span>
        <div>
          <p className="eyebrow">RunRoute AI</p>
          <h1>RunRoute AI</h1>
          <p className="tagline">An adaptive AI navigation agent for endurance runners.</p>
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
        <label>AI mode</label>
        <div className="modeGrid" role="group" aria-label="AI route personality mode">
          {AGENT_MODES.map((mode) => (
            <button
              className={form.agentMode === mode.id ? 'modeOption active' : 'modeOption'}
              key={mode.id}
              onClick={() => applyMode(mode)}
              type="button"
            >
              {mode.label}
            </button>
          ))}
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

function GeminiRecommendationPanel({ analysis, loading, error, source, nextRunPlan, onPlanNextRun, onRefresh }) {
  return (
    <aside className="geminiPanel" aria-label="RunRoute AI recommendation">
      <div className="geminiHeader">
        <span className="geminiIcon">
          <Sparkles aria-hidden="true" size={21} />
        </span>
        <div>
          <span className="eyebrow">RunRoute AI Recommendation</span>
          <h2>{loading ? 'Analyzing route options' : analysis.bestRouteName}</h2>
        </div>
        <span className={`sourcePill ${source === 'gemini' ? 'live' : ''}`}>{source === 'gemini' ? 'Gemini' : 'Local'}</span>
      </div>

      <div className="confidenceRow">
        <span>AI confidence</span>
        <strong>{Math.round(analysis.confidence)}%</strong>
      </div>

      <div className="insightBadges">
        <span>
          <ShieldCheck aria-hidden="true" size={15} />
          Safety
        </span>
        <span>
          <Activity aria-hidden="true" size={15} />
          Training
        </span>
        <span>
          <Droplets aria-hidden="true" size={15} />
          Hydration
        </span>
      </div>

      <section className="geminiInsight">
        <h3>Why this route</h3>
        <p>{analysis.whyThisRoute}</p>
      </section>

      <section className="geminiInsight">
        <h3>Safety note</h3>
        <p>{analysis.safetyAnalysis}</p>
      </section>

      <section className="geminiInsight">
        <h3>Training note</h3>
        <p>{analysis.trainingRecommendation}</p>
      </section>

      <section className="geminiInsight">
        <h3>Hydration</h3>
        <p>{analysis.hydrationAdvice}</p>
      </section>

      {error ? <p className="aiWarning">{error}</p> : null}

      {nextRunPlan ? (
        <div className="nextRunPlan">
          <Trophy aria-hidden="true" size={18} />
          <span>{nextRunPlan}</span>
        </div>
      ) : null}

      <div className="geminiActions">
        <button className="secondaryButton" disabled={loading} onClick={onRefresh} type="button">
          <RefreshCcw aria-hidden="true" size={16} />
          Refresh AI
        </button>
        <button className="primaryButton" onClick={onPlanNextRun} type="button">
          <Brain aria-hidden="true" size={16} />
          Plan My Next Run
        </button>
      </div>
    </aside>
  );
}

function AIAssistantPanel({
  analysis,
  agentMessages,
  agentPrompt,
  darkMode,
  onPromptChange,
  onPromptSubmit,
  onSelectRoute,
  onToggleTheme,
  routing
}) {
  return (
    <aside className="aiPanel" aria-label="AI route assistant">
      <div className="aiHeader">
        <span className="aiIcon">
          <Bot aria-hidden="true" size={21} />
        </span>
        <div>
          <span className="eyebrow">Agent recommendation</span>
          <h2>{analysis.headline}</h2>
        </div>
        <button className="iconButton themeButton" onClick={onToggleTheme} type="button" title="Toggle dark mode">
          {darkMode ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
          <span className="srOnly">Toggle dark mode</span>
        </button>
      </div>

      <p className="aiRecommendation">{analysis.recommendation}</p>

      <section className="aiSection">
        <h3>Why this route?</h3>
        <div className="reasonList">
          {analysis.reasoning.map((reason) => (
            <div key={reason}>
              <Check aria-hidden="true" size={16} />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="aiSection">
        <h3>Route comparison</h3>
        <div className="comparisonTable">
          {analysis.comparison.map((row) => (
            <button key={row.id} onClick={() => onSelectRoute(row.id)} type="button">
              <span>{row.name}</span>
              <strong>{row.bestFor}</strong>
              <small>{row.fit}/100</small>
            </button>
          ))}
        </div>
      </section>

      <section className="aiInsightGrid">
        <div>
          <ShieldCheck aria-hidden="true" size={18} />
          <strong>Safety intelligence</strong>
          <span>{analysis.safety[0]}</span>
        </div>
        <div>
          <CloudSun aria-hidden="true" size={18} />
          <strong>Weather adaptation</strong>
          <span>{analysis.weather[0]}</span>
        </div>
      </section>

      <section className="memoryBox">
        <Database aria-hidden="true" size={18} />
        <div>
          <strong>Adaptive memory</strong>
          <span>{analysis.memory}</span>
          <small>{analysis.mongodb}</small>
        </div>
      </section>

      <form className="agentComposer" onSubmit={onPromptSubmit}>
        <label htmlFor="agentPrompt">Ask RunRoute AI</label>
        <div>
          <input
            id="agentPrompt"
            value={agentPrompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Avoid hills today"
          />
          <button disabled={routing} type="submit" title="Send prompt">
            <Send aria-hidden="true" size={17} />
            <span className="srOnly">Send prompt</span>
          </button>
        </div>
      </form>

      <div className="agentMessages" aria-live="polite">
        {agentMessages.slice(-3).map((message) => (
          <p className={message.role} key={message.id}>
            <span>{message.role === 'user' ? 'You' : 'AI'}</span>
            {message.text}
          </p>
        ))}
      </div>
    </aside>
  );
}

function RouteDetails({ route, onExportGpx, onExportKml, onShare, onStartNavigation }) {
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

      <button className="primaryButton" onClick={onStartNavigation} type="button">
        <Navigation aria-hidden="true" size={18} />
        Open live run mode
      </button>

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

function RunMode({
  route,
  runSession,
  savedActivities,
  voiceAvailable,
  voiceDirections,
  onBackToPlanner,
  onFinishRun,
  onPauseRun,
  onResetRun,
  onResumeRun,
  onSaveActivity,
  onStartRun,
  onToggleVoice
}) {
  const steps = useMemo(() => buildNavigationSteps(route), [route]);
  const runMapRoutes = useMemo(() => [route], [route]);
  const routeProgress = runSession.routeProgressKm || 0;
  const completedDistance = Math.max(routeProgress, runSession.distanceKm || 0);
  const progressPercent = clamp((completedDistance / Math.max(route.distanceKm, 0.1)) * 100, 0, 100);
  const nextStep = getNextRunStep(steps, routeProgress);
  const isRecording = runSession.status === 'recording';
  const isPaused = runSession.status === 'paused';
  const isFinished = runSession.status === 'finished';
  const isIdle = runSession.status === 'idle';

  return (
    <section className="runModeShell" aria-label="Run mode">
      <div className="runHero">
        <div>
          <span className="eyebrow">Live run mode</span>
          <h1>Follow and record {route.name}</h1>
          <p>Turn-by-turn route guidance, voice prompts, and Strava-style recording from browser GPS.</p>
        </div>
        <button className="secondaryButton" onClick={onBackToPlanner} type="button">
          <Compass aria-hidden="true" size={17} />
          Planner
        </button>
      </div>

      <div className="runLayout">
        <div className="runPrimary">
          <RouteMap routes={runMapRoutes} selectedRouteId={route.id} onSelectRoute={noop} routing={false} track={runSession.track} />

          <div className="runControls">
            {isIdle || isFinished ? (
              <button className="primaryButton" onClick={onStartRun} type="button">
                <Play aria-hidden="true" size={18} />
                Start recording
              </button>
            ) : null}
            <button
              className={`secondaryButton voiceButton ${voiceDirections ? 'active' : ''}`}
              disabled={!voiceAvailable}
              onClick={onToggleVoice}
              title={voiceAvailable ? 'Toggle voice directions' : 'Voice directions unavailable in this browser'}
              type="button"
            >
              {voiceDirections ? <Volume2 aria-hidden="true" size={18} /> : <VolumeX aria-hidden="true" size={18} />}
              Voice {voiceDirections ? 'on' : 'off'}
            </button>
            {isRecording ? (
              <button className="secondaryButton" onClick={onPauseRun} type="button">
                <Pause aria-hidden="true" size={18} />
                Pause
              </button>
            ) : null}
            {isPaused ? (
              <button className="primaryButton" onClick={onResumeRun} type="button">
                <Play aria-hidden="true" size={18} />
                Resume
              </button>
            ) : null}
            {!isIdle && !isFinished ? (
              <button className="secondaryButton" onClick={onFinishRun} type="button">
                <Square aria-hidden="true" size={17} />
                Finish
              </button>
            ) : null}
            {isFinished ? (
              <button className="secondaryButton" onClick={onSaveActivity} type="button">
                <Trophy aria-hidden="true" size={17} />
                Save activity
              </button>
            ) : null}
            {!isIdle ? (
              <button className="textButton" onClick={onResetRun} type="button">
                Reset
              </button>
            ) : null}
          </div>

          {runSession.error ? (
            <div className="runAlert">
              <AlertTriangle aria-hidden="true" size={18} />
              <span>{runSession.error}</span>
            </div>
          ) : null}
        </div>

        <aside className="runDashboard">
          <div className="recordingStatus">
            <span className={`recordingDot ${runSession.status}`} />
            <strong>{isRecording ? 'Recording' : isPaused ? 'Paused' : isFinished ? 'Finished' : 'Ready'}</strong>
            <small>
              {runSession.track.length} GPS point{runSession.track.length === 1 ? '' : 's'} · Voice{' '}
              {voiceDirections ? 'on' : 'off'}
            </small>
          </div>

          <div className="runStatsGrid">
            <Stat icon={Timer} label="Time" value={formatClock(runSession.elapsedSeconds)} />
            <Stat icon={Activity} label="Recorded" value={formatDistance(runSession.distanceKm)} />
            <Stat icon={Route} label="Route" value={formatDistance(route.distanceKm)} />
            <Stat icon={Flame} label="Avg pace" value={formatRunPace(runSession.distanceKm, runSession.elapsedSeconds)} />
          </div>

          <section className="nextInstruction">
            <span className="eyebrow">Next direction</span>
            <h2>{nextStep?.instruction || 'Start route'}</h2>
            <p>{nextStep?.note || 'Start recording near the route start.'}</p>
            <strong>{nextStep ? `${formatDistance(Math.max(nextStep.distanceKm - routeProgress, 0))} ahead` : ''}</strong>
          </section>

          <section className="routeProgress">
            <div>
              <span>Route progress</span>
              <strong>{Math.round(progressPercent)}%</strong>
            </div>
            <div className="progressTrack" aria-hidden="true">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <small>
              {formatDistance(routeProgress)} followed
              {runSession.offRouteM !== null ? ` · ${runSession.offRouteM} m from route` : ''}
            </small>
          </section>

          <section className="turnList">
            <h3>Directions</h3>
            {steps.slice(0, 10).map((step) => {
              const completed = step.distanceKm <= routeProgress;
              const current = step.id === nextStep?.id;
              return (
                <div className={`${completed ? 'completed' : ''} ${current ? 'current' : ''}`} key={step.id}>
                  <span>{formatDistance(step.distanceKm)}</span>
                  <strong>{step.instruction}</strong>
                  <small>{step.note}</small>
                </div>
              );
            })}
          </section>

          <section className="activityHistory">
            <h3>Recorded activities</h3>
            {savedActivities.length === 0 ? (
              <p className="compactCopy">Finished runs will appear here with distance, time, and pace.</p>
            ) : (
              savedActivities.slice(0, 4).map((activity) => (
                <div key={activity.id}>
                  <strong>{activity.name}</strong>
                  <span>
                    {formatDistance(activity.distanceKm)} · {formatClock(activity.elapsedSeconds)} ·{' '}
                    {formatRunPace(activity.distanceKm, activity.elapsedSeconds)}
                  </span>
                </div>
              ))
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function createInitialRunSession() {
  return {
    status: 'idle',
    elapsedSeconds: 0,
    distanceKm: 0,
    routeProgressKm: 0,
    routeProgressPercent: 0,
    offRouteM: null,
    track: [],
    startedAt: null,
    finishedAt: null,
    error: '',
    savedActivityId: null
  };
}

function App() {
  const initialForm = {
    start: DEFAULT_START,
    startLabel: DEFAULT_START.label,
    distanceKm: 20,
    paceMinPerKm: 7,
    routeType: 'scenic',
    style: 'parks',
    trainingGoal: 'Marathon prep',
    agentMode: 'marathon'
  };
  const [form, setForm] = useState(initialForm);
  const [routes, setRoutes] = useState(() => generateEstimatedRoutes(initialForm));
  const [selectedRouteId, setSelectedRouteId] = useState(routes[0].id);
  const [savedRoutes, setSavedRoutes] = useLocalStorageState('longrun.savedRoutes', []);
  const [savedActivities, setSavedActivities] = useLocalStorageState('runroute.activities', []);
  const [darkMode, setDarkMode] = useLocalStorageState('runroute.darkMode', false);
  const [voiceDirections, setVoiceDirections] = useLocalStorageState('runroute.voiceDirections', false);
  const [activeTab, setActiveTab] = useState('planner');
  const [aiRecommendation, setAiRecommendation] = useState(null);
  const [aiSource, setAiSource] = useState('local');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [nextRunPlan, setNextRunPlan] = useState('');
  const [runSession, setRunSession] = useState(createInitialRunSession);
  const [locating, setLocating] = useState(false);
  const [routing, setRouting] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentMessages, setAgentMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'I will compare the routes, explain the best choice, and adapt when you ask for changes.'
    }
  ]);
  const [toast, setToast] = useState('');
  const routeRequestRef = useRef(0);
  const aiRequestRef = useRef(0);
  const initialRoutingRef = useRef(false);
  const watchIdRef = useRef(null);
  const lastSpokenStepRef = useRef('');
  const lastSpokenWarningRef = useRef('');

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) || routes[0],
    [routes, selectedRouteId]
  );

  const savedIds = useMemo(() => new Set(savedRoutes.map((route) => route.id)), [savedRoutes]);
  const runnerMemory = useMemo(() => buildRunnerMemory(savedRoutes), [savedRoutes]);
  const agentAnalysis = useMemo(
    () => analyzeRoutes(routes, selectedRoute, form, runnerMemory),
    [form, routes, runnerMemory, selectedRoute]
  );
  const displayedAiRecommendation = useMemo(
    () => aiRecommendation || localGeminiShape(agentAnalysis),
    [agentAnalysis, aiRecommendation]
  );
  const runSteps = useMemo(() => buildNavigationSteps(selectedRoute), [selectedRoute]);
  const currentVoiceStep = useMemo(
    () => getNextRunStep(runSteps, runSession.routeProgressKm || 0),
    [runSession.routeProgressKm, runSteps]
  );
  const voiceAvailable = canUseVoiceDirections();

  const requestAiRecommendation = async (routesForAi = routes, formForAi = form) => {
    const requestId = aiRequestRef.current + 1;
    aiRequestRef.current = requestId;
    setAiLoading(true);
    setAiError('');
    setAiRecommendation(localGeminiShape(analyzeRoutes(routesForAi, routesForAi[0], formForAi, runnerMemory)));
    setAiSource('local');

    try {
      const response = await fetch(`${AI_API_BASE_URL}/api/analyze-routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAiRequestPayload(routesForAi, formForAi))
      });

      if (!response.ok) throw new Error('AI backend did not accept the route payload');

      const data = await response.json();
      if (aiRequestRef.current !== requestId) return;

      setAiRecommendation(data.analysis);
      setAiSource(data.source || 'gemini');
      setAiError(data.warning ? `Gemini fallback: ${data.warning}` : '');
    } catch {
      if (aiRequestRef.current !== requestId) return;
      setAiSource('local');
      setAiError('Gemini backend offline. Showing local recommendation until the server is running.');
    } finally {
      if (aiRequestRef.current === requestId) setAiLoading(false);
    }
  };

  useEffect(() => {
    document.title = 'RunRoute AI';
  }, []);

  useEffect(() => {
    if (routes.length === 0) return;
    void requestAiRecommendation(routes, form);
  }, [form.distanceKm, form.paceMinPerKm, form.routeType, form.style, form.trainingGoal, routes]);

  useEffect(() => {
    if (voiceDirections && !voiceAvailable) {
      setVoiceDirections(false);
    }
  }, [setVoiceDirections, voiceAvailable, voiceDirections]);

  useEffect(() => {
    lastSpokenStepRef.current = '';
    lastSpokenWarningRef.current = '';
  }, [runSession.startedAt, selectedRoute.id]);

  useEffect(() => {
    if (!voiceDirections || runSession.status !== 'recording' || !currentVoiceStep) return;

    const routeProgress = runSession.routeProgressKm || 0;
    const distanceAhead = Math.max(currentVoiceStep.distanceKm - routeProgress, 0);
    const shouldSpeak =
      currentVoiceStep.id === 'start' || currentVoiceStep.id === 'finish' || distanceAhead <= 0.45;

    if (!shouldSpeak) return;

    const stepKey = `${selectedRoute.id}-${currentVoiceStep.id}`;
    if (lastSpokenStepRef.current === stepKey) return;

    if (speakDirections(buildSpokenInstruction(currentVoiceStep, distanceAhead))) {
      lastSpokenStepRef.current = stepKey;
    }
  }, [currentVoiceStep, runSession.routeProgressKm, runSession.status, selectedRoute.id, voiceDirections]);

  useEffect(() => {
    if (!voiceDirections || runSession.status !== 'recording' || !runSession.error.includes('away from the selected route')) {
      return;
    }

    const warningKey = `${selectedRoute.id}-${Math.floor((runSession.routeProgressKm || 0) * 10)}`;
    if (lastSpokenWarningRef.current === warningKey) return;

    if (speakDirections('You seem to be off route. Rejoin the highlighted line when safe.')) {
      lastSpokenWarningRef.current = warningKey;
    }
  }, [runSession.error, runSession.routeProgressKm, runSession.status, selectedRoute.id, voiceDirections]);

  useEffect(() => {
    if (runSession.status !== 'recording') return undefined;

    const timerId = window.setInterval(() => {
      setRunSession((current) =>
        current.status === 'recording' ? { ...current, elapsedSeconds: current.elapsedSeconds + 1 } : current
      );
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [runSession.status]);

  useEffect(
    () => () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (canUseVoiceDirections()) {
        window.speechSynthesis.cancel();
      }
    },
    []
  );

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  const clearLocationWatch = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const persistGeneratedRoutes = (routesForMemory, formForMemory, source) => {
    void postAiBackend('/api/routes/generated', {
      userId: RUNROUTE_USER_ID,
      routes: routesForMemory.map(routeMemoryRecord),
      preferences: preferencePayload(formForMemory),
      trainingGoal: formForMemory.trainingGoal,
      previousPaceDistance: {
        pace: formatPace(Number(formForMemory.paceMinPerKm)),
        distance: Number(formForMemory.distanceKm)
      },
      source
    });
  };

  const beginLocationWatch = (routeForRun) => {
    if (!navigator.geolocation) {
      setRunSession((current) => ({
        ...current,
        status: current.track.length > 0 ? 'paused' : 'idle',
        error: 'Location tracking is unavailable in this browser.'
      }));
      showToast('Location tracking unavailable');
      return false;
    }

    clearLocationWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = {
          lat: round(position.coords.latitude, 6),
          lng: round(position.coords.longitude, 6),
          accuracy: Math.round(position.coords.accuracy || 0),
          timestamp: new Date(position.timestamp || Date.now()).toISOString()
        };
        const progress = getRouteProgress(routeForRun, point);

        setRunSession((current) => {
          if (current.status !== 'recording') return current;

          const previous = current.track[current.track.length - 1];
          const addedDistance =
            previous && (!point.accuracy || point.accuracy <= 80) ? haversineDistanceKm(previous, point) : 0;
          const isOffRoute = progress.nearestDistanceM !== null && progress.nearestDistanceM > 90;

          return {
            ...current,
            distanceKm: round(current.distanceKm + addedDistance, 3),
            routeProgressKm: round(progress.progressKm, 2),
            routeProgressPercent: progress.progressPercent,
            offRouteM: progress.nearestDistanceM,
            track: [...current.track, point],
            error: isOffRoute ? 'You appear to be away from the selected route. Rejoin the highlighted line when safe.' : ''
          };
        });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was not granted. Allow location access to record the run.'
            : error.code === error.TIMEOUT
              ? 'Location tracking timed out. Try again outdoors or near a window.'
              : 'Location is currently unavailable. Try again when GPS signal improves.';

        clearLocationWatch();
        setRunSession((current) => ({
          ...current,
          status: current.track.length > 0 ? 'paused' : 'idle',
          error: message
        }));
        showToast(message);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
    );

    return true;
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
      const accurateRoutes = roadRoutes.map((route, index) =>
        route.distanceStatus === 'Within target range' ? route : estimatedRoutes[index]
      );
      setRoutes(accurateRoutes);
      setSelectedRouteId(accurateRoutes[0].id);
      persistGeneratedRoutes(accurateRoutes, normalizedForm, 'road');
      if (!options.silent) showToast('Best accurate street/path matches applied');
    } catch {
      if (routeRequestRef.current !== requestId) return;
      persistGeneratedRoutes(estimatedRoutes, normalizedForm, 'estimated');
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

  const handleAgentSubmit = (event) => {
    event.preventDefault();
    const prompt = agentPrompt.trim();
    if (!prompt) return;

    const { form: nextForm, response, shouldGenerate } = applyAgentPromptToForm(prompt, form);
    setAgentMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', text: prompt },
      { id: `assistant-${Date.now()}`, role: 'assistant', text: response }
    ]);
    setAgentPrompt('');
    if (shouldGenerate) {
      void generateAndApplyRoutes(nextForm);
    }
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
        savedAt: new Date().toISOString(),
        aiNote: agentAnalysis.recommendation
      },
      ...current
    ]);
    setAgentMessages((current) => [
      ...current,
      {
        id: `memory-${Date.now()}`,
        role: 'assistant',
        text: `Saved ${route.name}. I will use this as memory for future ${modeLabel(form.agentMode).toLowerCase()} recommendations.`
      }
    ]);
    void postAiBackend('/api/routes/save', {
      userId: RUNROUTE_USER_ID,
      route: routeMemoryRecord(route),
      preferences: preferencePayload(form),
      trainingGoal: form.trainingGoal,
      previousPaceDistance: {
        pace: formatPace(Number(form.paceMinPerKm)),
        distance: Number(form.distanceKm)
      }
    });
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

  const toggleVoiceDirections = () => {
    if (voiceDirections) {
      setVoiceDirections(false);
      if (canUseVoiceDirections()) window.speechSynthesis.cancel();
      lastSpokenStepRef.current = '';
      lastSpokenWarningRef.current = '';
      showToast('Voice directions off');
      return;
    }

    if (!canUseVoiceDirections()) {
      showToast('Voice directions are unavailable in this browser');
      return;
    }

    setVoiceDirections(true);
    lastSpokenStepRef.current = '';
    lastSpokenWarningRef.current = '';

    if (runSession.status === 'recording' && currentVoiceStep) {
      const distanceAhead = Math.max(currentVoiceStep.distanceKm - (runSession.routeProgressKm || 0), 0);
      const stepKey = `${selectedRoute.id}-${currentVoiceStep.id}`;
      if (speakDirections(`Voice directions on. ${buildSpokenInstruction(currentVoiceStep, distanceAhead)}`)) {
        lastSpokenStepRef.current = stepKey;
      }
    } else {
      speakDirections('Voice directions on. Start recording to hear navigation prompts.');
    }

    showToast('Voice directions on');
  };

  const startRun = () => {
    setActiveTab('run');
    setRunSession({
      ...createInitialRunSession(),
      status: 'recording',
      startedAt: new Date().toISOString()
    });
    lastSpokenStepRef.current = '';
    lastSpokenWarningRef.current = '';
    beginLocationWatch(selectedRoute);
  };

  const pauseRun = () => {
    clearLocationWatch();
    setRunSession((current) => ({
      ...current,
      status: current.status === 'recording' ? 'paused' : current.status
    }));
    if (voiceDirections) speakDirections('Run paused.');
  };

  const resumeRun = () => {
    setRunSession((current) => ({
      ...current,
      status: 'recording',
      error: ''
    }));
    lastSpokenWarningRef.current = '';
    if (voiceDirections) speakDirections('Run resumed.');
    beginLocationWatch(selectedRoute);
  };

  const finishRun = () => {
    clearLocationWatch();
    setRunSession((current) => ({
      ...current,
      status: 'finished',
      finishedAt: new Date().toISOString()
    }));
    if (voiceDirections) speakDirections('Run finished. Nice work.');
    showToast('Run finished');
  };

  const resetRun = () => {
    clearLocationWatch();
    if (canUseVoiceDirections()) window.speechSynthesis.cancel();
    lastSpokenStepRef.current = '';
    lastSpokenWarningRef.current = '';
    setRunSession(createInitialRunSession());
  };

  const saveActivity = () => {
    if (runSession.status !== 'finished') {
      showToast('Finish the run before saving activity');
      return;
    }

    if (runSession.savedActivityId) {
      showToast('Activity already saved');
      return;
    }

    const activityDistance = round(Math.max(runSession.distanceKm, runSession.routeProgressKm || 0), 2);
    const activity = {
      id: `activity-${Date.now()}`,
      routeId: selectedRoute.id,
      routeName: selectedRoute.name,
      name: `${selectedRoute.name} activity`,
      distanceKm: activityDistance,
      elapsedSeconds: runSession.elapsedSeconds,
      pace: formatRunPace(activityDistance, runSession.elapsedSeconds),
      startedAt: runSession.startedAt,
      finishedAt: runSession.finishedAt,
      savedAt: new Date().toISOString(),
      track: runSession.track
    };

    setSavedActivities((current) => [activity, ...current]);
    setRunSession((current) => ({ ...current, savedActivityId: activity.id }));
    showToast('Activity saved locally');
  };

  const planNextRun = async () => {
    const localPlan = buildNextRunPlan(runnerMemory);
    setNextRunPlan(localPlan);
    showToast('Adaptive plan generated');

    const memoryPlan = await postAiBackend('/api/agent/next-run', {
      userId: RUNROUTE_USER_ID,
      routeStyle: form.style,
      trainingGoal: form.trainingGoal,
      distance: Number(form.distanceKm),
      pace: formatPace(Number(form.paceMinPerKm))
    });

    if (memoryPlan?.plan && (memoryPlan.savedRouteCount > 0 || !runnerMemory.lastRoute)) {
      setNextRunPlan(memoryPlan.plan);
      showToast(memoryPlan.source === 'mongodb' ? 'MongoDB memory plan generated' : 'Adaptive plan generated');
    }
  };

  return (
    <main className={`appShell ${darkMode ? 'darkMode' : ''}`}>
      <div className="topNav" aria-label="Primary">
        <button
          className={activeTab === 'planner' ? 'active' : ''}
          onClick={() => setActiveTab('planner')}
          type="button"
        >
          <Compass aria-hidden="true" size={18} />
          Planner
        </button>
        <button className={activeTab === 'run' ? 'active' : ''} onClick={() => setActiveTab('run')} type="button">
          <Activity aria-hidden="true" size={18} />
          Run
        </button>
        <button
          className={activeTab === 'saved' ? 'active' : ''}
          onClick={() => setActiveTab('saved')}
          type="button"
        >
          <Save aria-hidden="true" size={18} />
          Saved
        </button>
        <button onClick={() => setDarkMode((current) => !current)} type="button">
          {darkMode ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
          {darkMode ? 'Light' : 'Dark'}
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
                <strong>{selectedRoute.source === 'road' ? 'streets/paths' : 'estimated'}</strong> ·{' '}
                <strong>{selectedRoute.distanceStatus}</strong>
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
                  bestFor={routeBestUse(route, form)}
                />
              ))}
            </div>
          </div>
          <div className="rightColumn">
            <GeminiRecommendationPanel
              analysis={displayedAiRecommendation}
              loading={aiLoading}
              error={aiError}
              source={aiSource}
              nextRunPlan={nextRunPlan}
              onPlanNextRun={planNextRun}
              onRefresh={() => requestAiRecommendation(routes, form)}
            />
            <AIAssistantPanel
              analysis={agentAnalysis}
              agentMessages={agentMessages}
              agentPrompt={agentPrompt}
              darkMode={darkMode}
              onPromptChange={setAgentPrompt}
              onPromptSubmit={handleAgentSubmit}
              onSelectRoute={setSelectedRouteId}
              onToggleTheme={() => setDarkMode((current) => !current)}
              routing={routing}
            />
            <RouteDetails
              route={selectedRoute}
              onExportGpx={() => exportSelected('gpx')}
              onExportKml={() => exportSelected('kml')}
              onShare={shareSelected}
              onStartNavigation={startRun}
            />
          </div>
        </div>
      ) : activeTab === 'run' ? (
        <RunMode
          route={selectedRoute}
          runSession={runSession}
          savedActivities={savedActivities}
          voiceAvailable={voiceAvailable}
          voiceDirections={voiceDirections}
          onBackToPlanner={() => setActiveTab('planner')}
          onFinishRun={finishRun}
          onPauseRun={pauseRun}
          onResetRun={resetRun}
          onResumeRun={resumeRun}
          onSaveActivity={saveActivity}
          onStartRun={startRun}
          onToggleVoice={toggleVoiceDirections}
        />
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
