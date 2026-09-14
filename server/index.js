const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MongoClient } = require('mongodb');
const { createWalkingHandler } = require('./walking');
const path = require('node:path');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173';
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || 'runroute_ai';
let mongoClientPromise = null;

const memoryStore = {
  generatedRoutes: [],
  savedRoutes: [],
  preferences: []
};

app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');
app.post('/api/routes/walking', createWalkingHandler());

// Old demo endpoints stay opt-in; publishing the studio must not enable AI spending
// or expose shared demo-runner memory just because credentials already exist.
app.use('/api/analyze-routes', (_request, response, next) => {
  if (process.env.ENABLE_AI !== 'true') return response.status(403).json({ error: 'AI analysis is disabled.' });
  next();
});
app.use(['/api/memory', '/api/routes/generated', '/api/routes/save', '/api/agent'], (_request, response, next) => {
  if (process.env.ENABLE_LEGACY_MEMORY !== 'true') return response.status(403).json({ error: 'Shared demo memory is disabled. Routes are saved on this device.' });
  next();
});

function routeName(route, index) {
  return route?.name || route?.label || `Route ${index + 1}`;
}

function hasMongoConfig() {
  return Boolean(mongoUri && mongoUri !== 'your_mongodb_uri_here');
}

async function getMongoDb() {
  if (!hasMongoConfig()) return null;

  if (!mongoClientPromise) {
    const client = new MongoClient(mongoUri);
    mongoClientPromise = client.connect();
  }

  const client = await mongoClientPromise;
  return client.db(mongoDbName);
}

function getUserId(payload = {}) {
  return payload.userId || payload.user_id || 'demo-runner';
}

function previousPaceDistance(payload = {}) {
  return (
    payload.previousPaceDistance || {
      pace: payload.preferences?.pace || payload.pace || '',
      distance: payload.preferences?.distance || payload.distance || null
    }
  );
}

function preferenceDocument(payload = {}) {
  return {
    userId: getUserId(payload),
    routeStyle: payload.preferences?.routeStyle || payload.routeStyle || '',
    routeType: payload.preferences?.routeType || payload.routeType || '',
    trainingGoal: payload.preferences?.trainingGoal || payload.trainingGoal || '',
    previousPaceDistance: previousPaceDistance(payload),
    updatedAt: new Date()
  };
}

function trimMemoryStore() {
  memoryStore.generatedRoutes = memoryStore.generatedRoutes.slice(0, 30);
  memoryStore.savedRoutes = memoryStore.savedRoutes.slice(0, 50);
}

function saveGeneratedRoutesInMemory(payload) {
  const document = {
    userId: getUserId(payload),
    routes: Array.isArray(payload.routes) ? payload.routes : [],
    preferences: payload.preferences || {},
    trainingGoal: payload.trainingGoal || payload.preferences?.trainingGoal || '',
    previousPaceDistance: previousPaceDistance(payload),
    source: payload.source || 'frontend',
    createdAt: new Date()
  };
  const preferences = preferenceDocument(payload);

  memoryStore.generatedRoutes.unshift(document);
  memoryStore.preferences = [
    preferences,
    ...memoryStore.preferences.filter((item) => item.userId !== preferences.userId)
  ];
  trimMemoryStore();

  return { source: 'memory', saved: true, generatedRouteCount: document.routes.length };
}

function saveRouteInMemory(payload) {
  const route = payload.route || {};
  const document = {
    userId: getUserId(payload),
    route,
    preferences: payload.preferences || {},
    trainingGoal: payload.trainingGoal || payload.preferences?.trainingGoal || '',
    previousPaceDistance: previousPaceDistance(payload),
    createdAt: new Date()
  };
  const preferences = preferenceDocument(payload);

  memoryStore.savedRoutes.unshift(document);
  memoryStore.preferences = [
    preferences,
    ...memoryStore.preferences.filter((item) => item.userId !== preferences.userId)
  ];
  trimMemoryStore();

  return { source: 'memory', saved: true, routeId: route.id || '' };
}

async function saveGeneratedRoutes(payload) {
  const db = await getMongoDb();
  if (!db) return saveGeneratedRoutesInMemory(payload);

  const document = {
    userId: getUserId(payload),
    routes: Array.isArray(payload.routes) ? payload.routes : [],
    preferences: payload.preferences || {},
    trainingGoal: payload.trainingGoal || payload.preferences?.trainingGoal || '',
    previousPaceDistance: previousPaceDistance(payload),
    source: payload.source || 'frontend',
    createdAt: new Date()
  };
  const preferences = preferenceDocument(payload);

  await db.collection('generated_routes').insertOne(document);
  await db
    .collection('user_preferences')
    .updateOne({ userId: preferences.userId }, { $set: preferences }, { upsert: true });

  return { source: 'mongodb', saved: true, generatedRouteCount: document.routes.length };
}

async function saveRouteMemory(payload) {
  const route = payload.route || {};
  const db = await getMongoDb();
  if (!db) return saveRouteInMemory(payload);

  const document = {
    userId: getUserId(payload),
    route,
    preferences: payload.preferences || {},
    trainingGoal: payload.trainingGoal || payload.preferences?.trainingGoal || '',
    previousPaceDistance: previousPaceDistance(payload),
    createdAt: new Date()
  };
  const preferences = preferenceDocument(payload);

  await db.collection('saved_routes').insertOne(document);
  await db
    .collection('user_preferences')
    .updateOne({ userId: preferences.userId }, { $set: preferences }, { upsert: true });

  return { source: 'mongodb', saved: true, routeId: route.id || '' };
}

async function getSavedRouteMemory(userId, limit = 8) {
  const db = await getMongoDb();
  if (!db) {
    return memoryStore.savedRoutes.filter((item) => item.userId === userId).slice(0, limit);
  }

  return db.collection('saved_routes').find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

async function getMemory(userId) {
  const db = await getMongoDb();
  if (!db) {
    return {
      source: 'memory',
      generatedRouteCount: memoryStore.generatedRoutes.filter((item) => item.userId === userId).length,
      savedRoutes: memoryStore.savedRoutes.filter((item) => item.userId === userId).slice(0, 8),
      preferences: memoryStore.preferences.find((item) => item.userId === userId) || null
    };
  }

  const [generatedRouteCount, savedRoutes, preferences] = await Promise.all([
    db.collection('generated_routes').countDocuments({ userId }),
    db.collection('saved_routes').find({ userId }).sort({ createdAt: -1 }).limit(8).toArray(),
    db.collection('user_preferences').findOne({ userId })
  ]);

  return { source: 'mongodb', generatedRouteCount, savedRoutes, preferences };
}

function formatKm(value) {
  const distance = Number(value || 0);
  return `${Number(distance.toFixed(distance < 10 ? 2 : 1))} km`;
}

function nextRunPlanFromHistory(savedRoutes, payload = {}) {
  const latestDocument = savedRoutes[0] || {};
  const latestRoute = latestDocument.route || latestDocument;

  if (!latestRoute?.distanceKm) {
    return 'Save a completed or planned route first, then I can adapt the next long run from your history.';
  }

  const latestDistance = Number(latestRoute.distanceKm);
  const nextDistance = Math.min(60, Math.round((latestDistance + 2) * 10) / 10);
  const style = payload.routeStyle || latestDocument.preferences?.routeStyle || latestRoute.style || 'balanced';

  return `Based on your last ${formatKm(latestDistance)} run, your next long run should be ${formatKm(
    nextDistance
  )} with lower elevation, more hydration stops, and a ${style} route bias.`;
}

function chooseFallbackRoute(routes) {
  return [...routes].sort((first, second) => {
    const firstScore =
      Number(first.safetyScore || 0) * 0.38 +
      Number(first.modeFit || 0) * 0.28 +
      Number(first.hydrationScore || 0) * 0.18 +
      (100 - Number(first.difficultyScore || 50)) * 0.16;
    const secondScore =
      Number(second.safetyScore || 0) * 0.38 +
      Number(second.modeFit || 0) * 0.28 +
      Number(second.hydrationScore || 0) * 0.18 +
      (100 - Number(second.difficultyScore || 50)) * 0.16;
    return secondScore - firstScore;
  })[0];
}

function buildFallbackAnalysis(payload) {
  const routes = Array.isArray(payload.routes) ? payload.routes : [];
  const bestRoute = chooseFallbackRoute(routes) || routes[0] || {};
  const stops = Array.isArray(bestRoute.stops) ? bestRoute.stops.length : 0;

  return {
    bestRouteId: bestRoute.id || '',
    bestRouteName: bestRoute.name || 'Best route',
    confidence: Math.max(72, Math.min(96, Number(bestRoute.modeFit || bestRoute.safetyScore || 82))),
    whyThisRoute: `${bestRoute.name || 'This route'} balances ${bestRoute.distanceKm || payload.distance} km, safety ${bestRoute.safetyScore || 'strong'}/100, and ${stops} planned stop${stops === 1 ? '' : 's'}.`,
    safetyAnalysis:
      Number(bestRoute.safetyScore || 0) >= 88
        ? 'High safety score with practical exit points and lower-risk corridors.'
        : 'Moderate safety profile. Review crossings, lighting, and isolated stretches before running.',
    difficultyAnalysis: `Difficulty is ${bestRoute.difficultyScore || 'moderate'}/100 with ${bestRoute.elevationGain || 0} m estimated gain.`,
    hydrationAdvice:
      Number(payload.distance || bestRoute.distanceKm || 0) >= 18
        ? 'Carry fluids and plan a refill every 6-8 km. Add electrolytes for warm or windy conditions.'
        : 'A small bottle is enough for most runners, but keep a refill option nearby.',
    trainingRecommendation: `For ${payload.trainingGoal || 'endurance training'}, run this at ${payload.pace || 'easy'} pace and keep the final third controlled.`
  };
}

function compactRoutes(routes) {
  return routes.map((route, index) => ({
    id: route.id,
    name: routeName(route, index),
    label: route.label,
    distanceKm: route.distanceKm,
    routeType: route.routeType,
    style: route.style,
    safetyScore: route.safetyScore,
    difficultyScore: route.difficultyScore,
    hydrationScore: route.hydrationScore,
    scenicScore: route.scenicScore,
    modeFit: route.modeFit,
    elevationGain: route.elevationGain,
    stops: Array.isArray(route.stops)
      ? route.stops.map((stop) => ({
          type: stop.type,
          name: stop.name,
          km: stop.km
        }))
      : []
  }));
}

function parseJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini response did not contain JSON');
    return JSON.parse(match[0]);
  }
}

function normalizeAnalysis(analysis, fallback) {
  return {
    bestRouteId: analysis.bestRouteId || fallback.bestRouteId,
    bestRouteName: analysis.bestRouteName || analysis.bestRoute || fallback.bestRouteName,
    confidence: Math.max(1, Math.min(100, Number(analysis.confidence || fallback.confidence))),
    whyThisRoute: analysis.whyThisRoute || analysis.why_it_is_best || fallback.whyThisRoute,
    safetyAnalysis: analysis.safetyAnalysis || analysis.safety_analysis || fallback.safetyAnalysis,
    difficultyAnalysis: analysis.difficultyAnalysis || analysis.difficulty_analysis || fallback.difficultyAnalysis,
    hydrationAdvice: analysis.hydrationAdvice || analysis.hydration_advice || fallback.hydrationAdvice,
    trainingRecommendation:
      analysis.trainingRecommendation || analysis.training_recommendation || fallback.trainingRecommendation
  };
}

async function analyzeWithGemini(payload) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    return { source: 'local-fallback', analysis: buildFallbackAnalysis(payload) };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });
  const fallback = buildFallbackAnalysis(payload);
  const prompt = `
You are RunRoute AI, an adaptive AI navigation agent for endurance runners.
Analyze these route options and return JSON only.

Runner request:
- Target distance: ${payload.distance} km
- Pace: ${payload.pace}
- Training goal: ${payload.trainingGoal}
- Route style: ${payload.routeStyle}

Routes:
${JSON.stringify(compactRoutes(payload.routes || []), null, 2)}

Return this exact JSON shape:
{
  "bestRouteId": "route id",
  "bestRouteName": "route name",
  "confidence": 1-100,
  "whyThisRoute": "short explanation",
  "safetyAnalysis": "short safety note",
  "difficultyAnalysis": "short difficulty note",
  "hydrationAdvice": "short hydration advice",
  "trainingRecommendation": "short training recommendation"
}
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return {
    source: 'gemini',
    analysis: normalizeAnalysis(parseJsonFromText(text), fallback)
  };
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'RunRoute routing backend',
    geminiConfigured: process.env.ENABLE_AI === 'true' && Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_key_here'),
    walkingConfigured: Boolean(process.env.ORS_API_KEY && process.env.ORS_API_KEY !== 'your_ors_key_here'),
    mongodbConfigured: hasMongoConfig()
  });
});

app.post('/api/analyze-routes', async (request, response) => {
  const payload = request.body || {};
  if (!Array.isArray(payload.routes) || payload.routes.length === 0) {
    response.status(400).json({ error: 'routes array is required' });
    return;
  }

  try {
    response.json(await analyzeWithGemini(payload));
  } catch (error) {
    response.status(200).json({
      source: 'local-fallback',
      warning: error.message,
      analysis: buildFallbackAnalysis(payload)
    });
  }
});

app.get('/api/memory/:userId', async (request, response) => {
  try {
    response.json(await getMemory(request.params.userId));
  } catch (error) {
    response.status(200).json({
      source: 'memory',
      warning: error.message,
      generatedRouteCount: 0,
      savedRoutes: memoryStore.savedRoutes.filter((item) => item.userId === request.params.userId).slice(0, 8),
      preferences: memoryStore.preferences.find((item) => item.userId === request.params.userId) || null
    });
  }
});

app.post('/api/routes/generated', async (request, response) => {
  const payload = request.body || {};
  if (!Array.isArray(payload.routes)) {
    response.status(400).json({ error: 'routes array is required' });
    return;
  }

  try {
    response.json(await saveGeneratedRoutes(payload));
  } catch (error) {
    response.status(200).json({
      ...saveGeneratedRoutesInMemory(payload),
      warning: error.message
    });
  }
});

app.post('/api/routes/save', async (request, response) => {
  const payload = request.body || {};
  if (!payload.route) {
    response.status(400).json({ error: 'route is required' });
    return;
  }

  try {
    response.json(await saveRouteMemory(payload));
  } catch (error) {
    response.status(200).json({
      ...saveRouteInMemory(payload),
      warning: error.message
    });
  }
});

app.post('/api/agent/next-run', async (request, response) => {
  const payload = request.body || {};
  const userId = getUserId(payload);

  try {
    const savedRoutes = await getSavedRouteMemory(userId);
    const db = await getMongoDb();
    response.json({
      source: db ? 'mongodb' : 'memory',
      plan: nextRunPlanFromHistory(savedRoutes, payload),
      savedRouteCount: savedRoutes.length
    });
  } catch (error) {
    const savedRoutes = memoryStore.savedRoutes.filter((item) => item.userId === userId).slice(0, 8);
    response.status(200).json({
      source: 'memory',
      warning: error.message,
      plan: nextRunPlanFromHistory(savedRoutes, payload),
      savedRouteCount: savedRoutes.length
    });
  }
});

app.use(express.static(path.join(__dirname, '../dist')));
app.use((error, _request, response, _next) => {
  response.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid request body.' });
});

if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`RunRoute backend listening on http://${host}:${port}`);
  });
}
module.exports = app;
