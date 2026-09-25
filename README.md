# RunRoute

A map-first running route studio, with route art made from shapes, text, and image outlines.

**No AI model or AI credits are required for the current interface.** Outline processing happens in the browser. Turning an outline into a walking route requires a routing provider.

## What Works

- Heart, star, and lightning-bolt templates.
- Text outlines for 1-6 Latin letters or numbers.
- PNG, JPEG, and WebP outline extraction, with threshold and inversion controls.
- Design distance, rotation, coordinate entry, current location, and map placement.
- Explicit connecting legs between separate contours, including letter interiors.
- Local design saving and reopening.
- A server-side Openrouteservice walking integration.
- Side-by-side design and fitted-path overlays, actual walking distance, and mean path deviation.
- Basic run planning with up to three walking-route candidates.
- Device-local saved routes, GPX/KML export helpers, browser GPS recording, and voice prompts.
- Light and dark themes, responsive layouts, keyboard-accessible controls.

## Honest Limits

Route Art is a **beta fitting tool** with a bounded nearby-placement search, not a neighborhood-wide street-network optimizer.

Enable **Compare nearby placements** to test the original placement and two nearby alternatives, shifted by 80-400 m and rotated by 15 degrees. This uses at most three sequential routing requests. Matches are ranked by two-way shape deviation, distance error, and an estimate of repeated segments. The selected outline follows the tested placement, not the original drawing position. A review acknowledgement is required before using a result from the art workspace.

The outline preview is geometry, not a runnable route. Street fitting requests a walking route through at most 48 design points. The result can deviate substantially from the image, repeat streets, or exceed the requested distance. Complex photos and detailed artwork may not produce useful outlines. There is no guarantee that an arbitrary drawing is feasible in a given neighborhood.

Only routes returned by the walking provider can be saved as runnable routes, exported, or started. Drafts can be saved as designs. Old locally saved prototype routes remain visible but need rerouting before running.

Safety, lighting, live weather, elevation, and water-stop claims from the earlier prototype have been removed from the interface. A walking profile is not a guarantee of safe or legal access. Review crossings, closures, and local access before running.

Browser GPS is foreground-only in practice: keep the page open and the screen awake. This is not yet a reliable locked-screen replacement for a native run tracker. No live emergency sharing, automatic rerouting, cloud account sync, or Strava upload is included.

## Development

Use Node.js 22.12 or later.

```sh
npm ci
npm --prefix server ci
npm run dev:server
```

In another terminal:

```sh
npm run dev
```

Open [the local app](http://127.0.0.1:5173/). Vite proxies `/api` to the backend on port 8787. The design workspace works without a backend; street fitting shows an unavailable state instead of returning fictional paths.

### Routing Configuration

Add these variables to `server/.env` or the hosting environment. Do not overwrite existing credentials when updating a local configuration.

```dotenv
ORS_API_KEY=your_openrouteservice_key
ROUTING_DAILY_LIMIT=100
ENABLE_AI=false
ENABLE_LEGACY_MEMORY=false
PORT=8787
HOST=127.0.0.1
CLIENT_ORIGIN=http://127.0.0.1:5173
```

The ORS key stays on the server. Never give it a `VITE_` prefix. Text/image bytes are not uploaded: only the derived longitude/latitude waypoints are sent to the routing server, then to Openrouteservice.

For a separately hosted frontend, set `VITE_API_BASE_URL` at build time. The default is same-origin requests. Tile URL and attribution can be changed together using `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION`.

### Cost Controls

- No Gemini requests from the current frontend.
- The legacy Gemini endpoint is disabled unless `ENABLE_AI=true`.
- One provider call per standard Route Art fit; at most three when nearby comparison is selected, and up to three for a normal route search.
- Search stops on missing/invalid credentials, quota errors, timeouts, or service failures. Only no-path errors advance to another placement; partial successful matches remain available.
- Search cancellation prevents additional placements and asks the server to abort the active upstream request. A request already sent may still count against the provider quota.
- Identical successful requests are cached for 30 minutes, up to 50 entries.
- Default limit: 100 provider requests per UTC day per server process.
- Additional limits: 12 uncached requests per IP per hour and three concurrent upstream requests.
- Provider failures count toward the budget; cache hits do not.

These are in-process safeguards, **not a billing guarantee**. They reset when the process restarts and are not shared across replicas. Before opening a public service, enforce provider account quotas and use durable, shared rate limiting at the hosting layer. Configure proxy trust only for the actual deployment; the development server does not trust client-supplied forwarding headers.

Map tiles, routing, and hosting still have provider policies, quotas, and potential costs. Do not promise unlimited free use or bulk/offline-download OpenStreetMap tiles. The included OSM tile configuration is for low-volume development; review the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) before publishing.

## Build and Hosting

```sh
npm test
npm run build
npm start
```

The Express server serves the production `dist/` directory and API from one origin. Set `HOST=0.0.0.0`, the host's assigned `PORT`, and `CLIENT_ORIGIN` to your HTTPS app URL. Do not expose the Vite development server publicly.

No deployment has been created by this change. Before launch:

- Connect a walking provider and test real routes in the intended launch city.
- Set provider-side spending/usage limits and durable public rate limiting.
- Choose a production tile provider with appropriate attribution and usage terms.
- Configure HTTPS; browser location permissions require a secure context outside localhost.
- Keep `ENABLE_AI=false` and `ENABLE_LEGACY_MEMORY=false`.
- Add a privacy notice explaining local storage, GPS, map tiles, and transmitted route waypoints.
- Validate navigation outdoors and on target phones.
- Add authentication before enabling any shared cloud memory.
- Add account deletion/data export before storing personal route history in the cloud.

## API

### POST /api/routes/walking

```json
{
  "coordinates": [[-113.5263, 53.5232], [-113.5200, 53.5300]]
}
```

Returns a `route` with latitude/longitude coordinates, actual `distanceKm`, provider navigation steps, `source: "walking"`, and attribution. Invalid input returns 400, missing configuration 503, request limits 429, and provider failures 502. No geometric fallback is returned.

`GET /api/health` reports configuration presence, not verified provider connectivity.

The earlier Gemini and MongoDB endpoints remain in the backend for optional future work. They are disabled by default. The old demo memory implementation has no account authentication and is **not suitable for public multi-user deployment**.

## Project Layout

```text
src/
  main.jsx                       Application entry
  App.jsx                        Planner, saved routes, run session
  studio.css                     Shared responsive design system
  components/
    RouteArtStudio.jsx           Text/image/design workflow
    StudioMap.jsx                Leaflet map and controls
    PlannerWorkspace.jsx         Standard route planning
  lib/
    route-art.js                 Contour extraction and map projection
    art-fitting.js               Bounded placement search and match ranking
    routing-api.js               Walking API client
    run-metrics.js               GPS distance and route progress
server/
  index.js                       Express, static hosting, legacy integrations
  walking.js                     Validated, bounded walking provider adapter
tests/
  route-art.test.js               Geometry and contour regression tests
  art-fitting.test.js             Ranking, request budgets and cancellation
  walking.test.js                 Provider, validation, budget and cache tests
  run-metrics.test.js             GPS and loop-progress regression tests
```

## Implementation Notes

Image outlines use [D3 contour polygons](https://d3js.org/d3-contour/contour); waypoint reduction uses Simplify.js. Street fitting uses [Openrouteservice walking directions](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/), within its [waypoint restrictions](https://openrouteservice.org/restrictions/).

The mean-deviation metric is a distance-weighted average from the fitted walking path to the design segments, including connecting legs. Outline coverage gap measures the reverse direction, so shortcuts that skip part of the drawing are penalized. Repeated segments count identical coordinate edges (rounded to five decimal places) in either direction; differently segmented versions of the same road can be missed. These are approximate geometry metrics, not safety scores or AI confidence. Smaller deviations are closer to the drawing, but visual review is still necessary.

Future work should prioritize neighborhood-wide shape placement, graph-based shape matching, reliable native recording, and durable abuse protection over adding an AI chat panel.

## License

[MIT](LICENSE).
