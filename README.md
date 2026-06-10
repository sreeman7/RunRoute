# RunRoute AI

A React MVP for an AI-powered long-distance running agent. Runners can enter a start location, target distance, route type, pace, style preference, and training goal, then compare three generated route options on an interactive Leaflet/OpenStreetMap street map with OSRM street/path-snapped route lines, route reasoning, distance, estimated time, safety, difficulty, elevation, stops, nutrition guidance, sharing, export, saved routes, live run guidance, voice directions, and local activity recording.

This first version uses deterministic local waypoint generation, then requests OSRM walking routes to snap the displayed lines to real streets and paths. The AI agent panel is currently a local rules-based analysis layer with Gemini-ready and MongoDB-ready surfaces for route comparison, preference memory, and adaptive recommendations. If the routing service is unavailable, the app falls back to an estimated preview instead of breaking.

## Run Locally

```bash
npm install
npm run dev
```

## MVP Scope

- Route input form with current-location support
- Three route options within the target distance tolerance
- Interactive street map with OSRM-snapped route overlays, stop markers, scale control, and automatic route fitting
- AI route recommendation, route comparison, and reasoning panel
- Conversational route adaptation prompts
- Local adaptive memory with MongoDB Atlas/MCP-ready data shape
- Dark mode
- Safety, difficulty, elevation, weather, stops, transit, and nutrition summaries
- Local saved routes
- Live run mode with route-following directions, voice prompts, progress, GPS recording controls, and saved activity history
- GPX and KML export
