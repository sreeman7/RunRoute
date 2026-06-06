# LongRun Route Planner

A React MVP for planning long-distance running routes without repeated loops. Runners can enter a start location, target distance, route type, pace, style preference, and training goal, then compare three generated route options on an interactive Leaflet/OpenStreetMap street map with OSRM street/path-snapped route lines, distance, estimated time, safety, difficulty, elevation, stops, nutrition guidance, sharing, export, and saved routes.

This first version uses deterministic local waypoint generation, then requests OSRM walking routes to snap the displayed lines to real streets and paths. If the routing service is unavailable, the app falls back to an estimated preview instead of breaking. The route generator is isolated in the UI code and can be replaced later with OpenRouteService, Mapbox Directions, or Google Maps Platform responses.

## Run Locally

```bash
npm install
npm run dev
```

## MVP Scope

- Route input form with current-location support
- Three route options within the target distance tolerance
- Interactive street map with OSRM-snapped route overlays, stop markers, scale control, and automatic route fitting
- Safety, difficulty, elevation, weather, stops, transit, and nutrition summaries
- Local saved routes
- GPX and KML export
