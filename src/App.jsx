import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Compass,
  Flame,
  Moon,
  Pause,
  Play,
  Route,
  Save,
  Shapes,
  Square,
  Sun,
  Timer,
  Trophy,
  Volume2,
  VolumeX
} from 'lucide-react';
import { RouteArtStudio } from './components/RouteArtStudio';
import { PlannerWorkspace } from './components/PlannerWorkspace';
import { StudioMap } from './components/StudioMap';
import { requestWalkingRoute } from './lib/routing-api';
import { recordedIncrement, projectRouteProgress } from './lib/run-metrics';

const DEFAULT_START = {
  lat: 53.5232,
  lng: -113.5263,
  label: 'University of Alberta, Edmonton'
};

const ROUTE_COLORS = ['#1f7a5a', '#e76f51', '#2f65d7'];
const MIN_DISTANCE_KM = 1;
const MAX_DISTANCE_KM = 60;

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
  return route?.source === 'walking' && Array.isArray(route.navigationSteps) ? route.navigationSteps : [];
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

function createRoute(form, index, desiredDistanceKm, coordinates) {
  const distance = routeDistanceKm(coordinates) || desiredDistanceKm;
  return {
    id: `draft-${form.start.lat}-${form.start.lng}-${form.routeType}-${form.distanceKm}-${index}`,
    name: ['North circuit', 'East circuit', 'West circuit'][index],
    label: 'Unrouted draft',
    description: 'Geometric draft. Not fitted to walking paths.',
    distanceKm: distance,
    targetDistanceKm: Number(form.distanceKm),
    estimatedTime: formatDuration(distance, Number(form.paceMinPerKm)),
    pace: formatPace(Number(form.paceMinPerKm)),
    stops: [],
    routeType: form.routeType,
    source: 'estimated',
    style: form.style,
    coordinates,
    finish: coordinates.at(-1),
    color: ROUTE_COLORS[index]
  };
}

function generateEstimatedRoutes(form) {
  const target = Number(form.distanceKm);
  const start = form.start || DEFAULT_START;

  return [0, 1, 2].map((index) => {
    const variance = [-0.012, 0.009, 0.018][index] * target;
    const desiredDistance = clamp(target + variance, target * 0.975, target * 1.025);
    const coordinates = buildDistanceMatchedCoordinates(start, desiredDistance, form.routeType, form.style, index);
    return createRoute(form, index, desiredDistance, coordinates);
  });
}

function createGpx(route) {
  const points = route.coordinates
    .map((point) => `      <trkpt lat="${point.lat}" lon="${point.lng}"></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RunRoute" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(route.name)}</name>
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
      <name>${escapeXml(route.name)}</name>
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

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));
}

function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      const parsed = stored ? JSON.parse(stored) : initialValue;
      return Array.isArray(initialValue) ? (Array.isArray(parsed) ? parsed : initialValue) : typeof parsed === typeof initialValue ? parsed : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { window.dispatchEvent(new CustomEvent('runroute-storage-error')); }
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

function RouteMap({ routes, selectedRouteId, track = [] }) {
  const selected = routes.find((route) => route.id === selectedRouteId) || routes[0];
  const lines = useMemo(() => routes.map((route) => ({
    coordinates: route.coordinates, color: route.color, dashed: route.source !== 'walking',
    weight: route.id === selectedRouteId ? 5 : 3
  })), [routes, selectedRouteId]);
  return <StudioMap lines={lines} center={selected.coordinates[0]} fitKey={selected.id} markerLabel="Route start" track={track} />;
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
          <option value="art">Route art</option>
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
          <span>No routes saved on this device.</span>
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
              <p>{route.source === 'walking' ? 'Walking route / saved on this device' : 'Legacy draft / must be rerouted before running'}</p>
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
          <p>Keep this page open and your screen awake. Background GPS recording is not guaranteed.</p>
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
              <button className="primaryButton" onClick={onStartRun} disabled={route.source !== 'walking'} type="button">
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
    savedActivityId: null,
    segment: 0
  };
}

export default function App() {
  const initialForm = {
    start: DEFAULT_START,
    startLabel: DEFAULT_START.label,
    distanceKm: 20,
    paceMinPerKm: 7,
    routeType: 'loop',
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
  const [activeTab, setActiveTab] = useState('art');
  const [routingStatus, setRoutingStatus] = useState('');

  const [runSession, setRunSession] = useState(createInitialRunSession);
  
  const [routing, setRouting] = useState(false);

  const [toast, setToast] = useState('');
  const routeRequestRef = useRef(0);

  const watchIdRef = useRef(null);
  const routeAbortRef = useRef(null);
  const lastSpokenStepRef = useRef('');
  const lastSpokenWarningRef = useRef('');

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) || routes[0],
    [routes, selectedRouteId]
  );

  const savedIds = useMemo(() => new Set(savedRoutes.map((route) => route.id)), [savedRoutes]);

  const runSteps = useMemo(() => buildNavigationSteps(selectedRoute), [selectedRoute]);
  const currentVoiceStep = useMemo(
    () => getNextRunStep(runSteps, runSession.routeProgressKm || 0),
    [runSession.routeProgressKm, runSteps]
  );
  const voiceAvailable = canUseVoiceDirections();

  useEffect(() => {
    document.title = 'RunRoute | Route Studio';
  }, []);

  useEffect(() => {
    const report = () => setToast('Device storage is unavailable. Changes could not be saved.');
    window.addEventListener('runroute-storage-error', report);
    return () => window.removeEventListener('runroute-storage-error', report);
  }, []);

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
      routeAbortRef.current?.abort();
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
        setRunSession((current) => {
          if (current.status !== 'recording') return current;
          const measurement = recordedIncrement(current.track.at(-1), { ...point, segment: current.segment });
          if (!measurement.accepted) return current;
          const progress = projectRouteProgress(routeForRun.coordinates, point, current.routeProgressKm);
          const isOffRoute = progress.nearestDistanceM !== null && progress.nearestDistanceM > 90;

          return {
            ...current,
            distanceKm: current.distanceKm + measurement.distanceKm,
            routeProgressKm: round(progress.progressKm, 2),
            routeProgressPercent: progress.progressPercent,
            offRouteM: progress.nearestDistanceM,
            track: [...current.track, { ...point, segment: current.segment }],
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
    routeAbortRef.current?.abort();
    routeRequestRef.current += 1;
    setRouting(false);
    setForm(updater);
    setRoutingStatus('Settings changed. Find walking routes to apply them.');
  };

  const generateAndApplyRoutes = async (sourceForm) => {
    const normalizedForm = normalizeRouteForm(sourceForm);
    const requestId = ++routeRequestRef.current;
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setForm(normalizedForm);
    setRouting(true);
    setRoutingStatus('Requesting walking routes...');
    try {
      const candidates = generateEstimatedRoutes(normalizedForm);
      const outcomes = [];
      for (let index = 0; index < candidates.length; index++) {
        if (controller.signal.aborted) return;
        try {
          const result = await requestWalkingRoute(candidates[index].coordinates, controller.signal);
          const route = {
            ...candidates[index], ...result,
            id: `walking-${crypto.randomUUID()}`,
            label: 'Walking route', description: 'Walking route from openrouteservice.',
            stops: [], elevationGain: null, safetyScore: null,
            targetDistanceKm: normalizedForm.distanceKm,
            estimatedTime: formatDuration(result.distanceKm, normalizedForm.paceMinPerKm),
            finish: result.coordinates.at(-1)
          };
          outcomes.push(route);
        } catch (error) {
          if (controller.signal.aborted) return;
          if (!outcomes.length) throw error;
          break;
        }
      }
      if (routeRequestRef.current !== requestId) return;
      const ordered = outcomes.sort((a, b) => Math.abs(a.distanceKm - normalizedForm.distanceKm) - Math.abs(b.distanceKm - normalizedForm.distanceKm));
      setRoutes(ordered);
      setSelectedRouteId(ordered[0].id);
      const matched = ordered.filter((route) => Math.abs(route.distanceKm - normalizedForm.distanceKm) <= normalizedForm.distanceKm * 0.025).length;
      setRoutingStatus(`${ordered.length} walking route${ordered.length === 1 ? '' : 's'} found. ${matched ? `${matched} within the target range.` : 'None within ±2.5% of your target. Actual distances are shown; try a different start or distance.'}`);
    } catch (error) {
      if (routeRequestRef.current === requestId) setRoutingStatus(error.message);
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false);
    }
  };

  const handleGenerate = () => { void generateAndApplyRoutes(form); };

  const saveRoute = (route) => {
    if (route.source !== 'walking') { showToast('Only fitted walking routes can be saved.'); return; }
    if (savedIds.has(route.id)) { showToast('Route already saved'); return; }
    setSavedRoutes((current) => [{ ...route, savedId: `${route.id}-${Date.now()}`, savedAt: new Date().toISOString() }, ...current]);
    showToast('Route saved on this device');
  };

  const deleteSavedRoute = (savedId) => {
    setSavedRoutes((current) => current.filter((route) => route.savedId !== savedId));
    showToast('Saved route deleted');
  };

  const openSavedRoute = (route) => {
    setRoutes([route, ...routes.filter((candidate) => candidate.id !== route.id)].slice(0, 3));
    setSelectedRouteId(route.id);
    setForm((current) => ({ ...current, start: route.coordinates[0], distanceKm: route.targetDistanceKm || route.distanceKm, routeType: route.routeType === 'art' ? 'loop' : route.routeType }));
    setRoutingStatus(route.source === 'walking' ? 'Saved walking route. Check current local access before running.' : 'This older route is an unrouted draft. Find a walking route before starting.');
    setActiveTab('planner');
  };

  const exportSelected = (format) => {
    if (selectedRoute.source !== 'walking') { showToast('Fit a walking route before exporting.'); return; }
    const safeName = selectedRoute.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (format === 'gpx') {
      downloadFile(`${safeName}.gpx`, createGpx(selectedRoute), 'application/gpx+xml');
      showToast('GPX exported');
    } else {
      downloadFile(`${safeName}.kml`, createKml(selectedRoute), 'application/vnd.google-earth.kml+xml');
      showToast('KML exported');
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
    if (selectedRoute.source !== 'walking') { showToast('Fit a walking route before recording.'); return; }
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
      segment: current.segment + 1,
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

    const activityDistance = round(runSession.distanceKm, 2);
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

  const useArtRoute = (route) => {
    routeAbortRef.current?.abort();
    routeRequestRef.current++;
    setRouting(false);
    setRoutes([route]);
    setSelectedRouteId(route.id);
    setForm((current) => ({ ...current, start: route.coordinates[0], distanceKm: route.targetDistanceKm, startLabel: route.name }));
    setRoutingStatus('Walking route fitted to your design. Review the map before starting.');
    setActiveTab('planner');
  };

  const exportArt = (route) => {
    if (route.source !== 'walking') return;
    const name = route.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadFile(`${name || 'route-art'}.gpx`, createGpx(route), 'application/gpx+xml');
  };
  const sessionActive = ['recording', 'paused'].includes(runSession.status);
  const navigate = (tab) => {
    if (sessionActive && tab !== 'run') return;
    if (tab !== 'planner') {
      routeAbortRef.current?.abort();
      routeRequestRef.current++;
      setRouting(false);
    }
    setActiveTab(tab);
  };

  return (
    <main className={`appShell studioShell ${darkMode ? 'darkMode' : ''}`}>
      <header className="studioHeader">
        <a className="studioBrand" href="#art" onClick={(event) => { event.preventDefault(); navigate('art'); }}>
          <span className="brandSymbol"><Route size={23} strokeWidth={2} /></span><strong>RunRoute<span>ROUTE STUDIO</span></strong>
        </a>
        <nav className="studioNav" aria-label="Primary">
          {[['art', Shapes, 'Route art'], ['planner', Compass, 'Plan a run'], ['saved', Save, 'Saved'], ['run', Activity, 'Run']].map(([id, Icon, label]) => (
            <button key={id} type="button" aria-current={activeTab === id ? 'page' : undefined} className={activeTab === id ? 'active' : ''} disabled={sessionActive && id !== 'run'} onClick={() => navigate(id)}><Icon size={17} /><span>{label}</span></button>
          ))}
        </nav>
        <div className="headerUtility"><span>LOCAL WORKSPACE</span><button className="iconOnly" type="button" title={darkMode ? 'Light theme' : 'Dark theme'} aria-label={darkMode ? 'Use light theme' : 'Use dark theme'} onClick={() => setDarkMode((current) => !current)}>{darkMode ? <Sun size={19} /> : <Moon size={19} />}</button></div>
      </header>
      <div hidden={activeTab !== 'art'} className="artWorkspaceContainer"><RouteArtStudio initialCenter={DEFAULT_START} onUseRoute={useArtRoute} onSaveRoute={saveRoute} onExport={exportArt} /></div>
      {activeTab === 'planner' && <PlannerWorkspace form={form} onChange={handleFormChange} routes={routes} selected={selectedRoute} onSelect={setSelectedRouteId} onGenerate={handleGenerate} routing={routing} status={routingStatus} onSave={saveRoute} saved={savedIds.has(selectedRoute.id)} onStart={startRun} onExport={() => exportSelected('gpx')} />}
      {activeTab === 'run' && <RunMode route={selectedRoute} runSession={runSession} savedActivities={savedActivities} voiceAvailable={voiceAvailable} voiceDirections={voiceDirections} onBackToPlanner={() => { if (!sessionActive) setActiveTab('planner'); }} onFinishRun={finishRun} onPauseRun={pauseRun} onResetRun={resetRun} onResumeRun={resumeRun} onSaveActivity={saveActivity} onStartRun={startRun} onToggleVoice={toggleVoiceDirections} />}
      {activeTab === 'saved' && <SavedRoutes routes={savedRoutes} onSelect={openSavedRoute} onDelete={deleteSavedRoute} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
