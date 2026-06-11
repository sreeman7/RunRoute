# RunRoute AI

An adaptive AI navigation agent for endurance runners.

RunRoute AI is a full-stack route-planning MVP. Runners enter a start location, target distance, route type, pace, style preference, and training goal, then compare three generated route options on an interactive Leaflet/OpenStreetMap street map with OSRM street/path-snapped route lines, Gemini route analysis, distance accuracy, safety, difficulty, elevation, stops, nutrition guidance, sharing, export, saved routes, live run guidance, voice directions, and local activity recording.

This first version uses deterministic local waypoint generation, then requests OSRM walking routes to snap the displayed lines to real streets and paths. The RunRoute AI Recommendation panel calls an Express backend for Gemini route analysis, with a local fallback if the API key or backend is unavailable. If the routing service is unavailable, the app falls back to an estimated preview instead of breaking.

## Hackathon Setup

- License: MIT
- Track: MongoDB
- Public GitHub repo: add your public repository URL here
- Hosted app URL: add your deployed frontend URL here
- Backend URL: add your deployed Express API URL here
- Demo video: keep under 3 minutes

## Run Locally

```bash
npm install
npm run dev
```

In a second terminal:

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Set `GEMINI_API_KEY` and `MONGODB_URI` in `server/.env`. Do not put Gemini keys or MongoDB credentials in the frontend.

The frontend calls the backend at `http://127.0.0.1:8787` by default. For deployment, set:

```bash
VITE_AI_API_BASE_URL=https://your-backend-url.example
```

## API

`POST /api/analyze-routes`

Request:

```json
{
  "routes": [],
  "distance": 20,
  "pace": "7:00 /km",
  "trainingGoal": "Marathon prep",
  "routeStyle": "parks"
}
```

Response:

```json
{
  "source": "gemini",
  "analysis": {
    "bestRouteId": "route-id",
    "bestRouteName": "Alpha",
    "confidence": 92,
    "whyThisRoute": "Short reason",
    "safetyAnalysis": "Safety note",
    "difficultyAnalysis": "Difficulty note",
    "hydrationAdvice": "Hydration advice",
    "trainingRecommendation": "Training recommendation"
  }
}
```

Memory endpoints:

- `POST /api/routes/generated` saves generated route batches, preferences, training goal, and previous pace/distance.
- `POST /api/routes/save` saves a selected route to route memory.
- `POST /api/agent/next-run` returns the adaptive “Plan My Next Run” recommendation from route history.
- `GET /api/memory/:user_id` returns saved route memory and preferences for debugging/demo checks.

## Demo Flow

1. Enter a 20 km marathon training run.
2. Generate three snapped routes: Alpha, Pulse, and Horizon.
3. Show Gemini recommending the best route in the RunRoute AI Recommendation panel.
4. Save a route to create route memory.
5. Click Plan My Next Run to show the adaptive agent recommendation.

## 3-Minute Demo Video Plan

- 0:00-0:25: Problem and RunRoute AI tagline.
- 0:25-1:05: Generate a 20 km marathon route.
- 1:05-1:45: Show Gemini choosing the best route and explaining safety/training/hydration.
- 1:45-2:25: Save the route and use Plan My Next Run.
- 2:25-3:00: Show live run mode, voice toggle, export, and submission checklist.

## MVP Scope

- Route input form with current-location support
- Three route options within the target distance tolerance
- Interactive street map with OSRM-snapped route overlays, stop markers, scale control, and automatic route fitting
- AI route recommendation, route comparison, and reasoning panel
- Express backend with Gemini route analysis and MongoDB route-memory endpoints
- Conversational route adaptation prompts
- Adaptive memory for generated routes, saved routes, preferences, training goal, and previous pace/distance
- Dark mode
- Safety, difficulty, elevation, weather, stops, transit, and nutrition summaries
- Local saved routes
- Live run mode with route-following directions, voice prompts, progress, GPS recording controls, and saved activity history
- GPX and KML export

## Submission Checklist

- App works online
- Repository is public
- MIT license is visible
- README has setup instructions
- Demo video is under 3 minutes
- Devpost form is complete
- MongoDB track is selected
