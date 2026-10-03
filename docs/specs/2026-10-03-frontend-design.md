# Frontend spec — "Oura for a house"

**Status:** accepted · **Date:** 2026-10-03 · **Owners:** frontend (this spec) /
backend (separate dev, designed later from the same contract)

The consumer-facing view on top of VILPE Sense data. Backend (FastAPI +
MongoDB, built by a separate dev) is the interpretation layer; the frontend
renders meaning, never raw telemetry. See `docs/VISION.md` — it is the north
star for every choice not nailed down here. Onboarding (house setup flow)
lives in `2026-10-03-onboarding-design.md`.

**Mock-first:** the frontend runs entirely on local fixtures now. The API
contract below is our working hypothesis of the data shape — the backend is
designed from it once the mock has proven what we actually want.

**Demo goal:** a judge rotates a 3D house, clicks a pulsing sensor, and reads
one calm sentence telling them what's happening and why it matters — zero
explanation, zero scary numbers.

## Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| House view | **react-three-fiber 3D** | Tesla-style rotatable house per the vision |
| UI language | **English** | Junction judges are international |
| Live updates | **Polling, 60 s** | Real sensor data changes ~2×/day; score is smoothed anyway |
| Leak-moment polling | **15 s burst** after "Simulate leak" until reset | Keeps the demo moment alive; back to 60 s after |
| Data source | **Mock-first, API later** | Frontend ships on fixtures; the contract is the hypothesis the backend gets designed from |

## Architecture

```
frontend/src/
  api/
    client.ts      # typed fetch wrappers — the only place URLs live
    types.ts       # API contract types (mirror of the JSON below)
    index.ts       # exports getHouseState() etc; picks impl via VITE_API_MODE
    mock.ts        # fixture-backed impl, reads /mock/*.json
  components/
    HouseScene.tsx     # R3F canvas: house + hotspots + orbit controls
    Hotspot.tsx        # one sensor dot on the model
    ScoreCard.tsx      # score ring + number + word + one sentence
    AttentionFeed.tsx  # calm list of watch/alert items
    SensorChart.tsx    # smoothed recharts chart for detail pages
  pages/
    HomePage.tsx
    SensorDetailPage.tsx
  hooks/
    useHouseState.ts   # polling hook (60 s; 15 s while leak sim active)
```

Routing: `react-router-dom`. `/` → HomePage, `/sensors/:id` →
SensorDetailPage (deep-linkable for the demo). `/welcome` and `/onboarding`
come from the onboarding spec; `/` and `/sensors/:id` are guarded (no
session/profile → redirect `/welcome`). `/data` stays an unguarded dev page.
The old stats landing page is removed; `/api/stats` endpoints stay for the
backend dev if useful.

API mode switch: `VITE_API_MODE=mock|live` in `.env`, default `mock` (no
backend exists yet). Mock mode reads `frontend/public/mock/*.json` via the
same `client.ts` paths, so swapping later is a no-op.

## API contract

The working contract — fulfilled by fixtures today, designed into the
backend once the data shape has settled. All timestamps ISO 8601 UTC.
Frontend polls `GET /api/house`; everything else is on demand.

### `GET /api/house` — home snapshot

```json
{
  "home": { "address": "Yliopistonranta 1", "city": "Vaasa" },
  "score": 82,
  "score_word": "Good",
  "score_trend": "stable",
  "headline": "Your home is in good shape",
  "summary": "The roof is drying normally for early October.",
  "weather": {
    "temp_c": 8.6, "condition": "Overcast", "humidity_pct": 87,
    "wind_ms": 4.2, "location": "Vaasa"
  },
  "attention": [
    {
      "sensor_id": "roof-nw",
      "severity": "watch",
      "message": "Moisture in the north-west roof is rising slowly. We're watching it — no action needed yet.",
      "since": "2026-10-01T14:00:00Z",
      "actions": ["expert"]
    }
  ],
  "sensors": [
    {
      "id": "roof-nw",
      "name": "North-west roof",
      "kind": "leak_sensor",
      "zone": "roof_north",
      "status": "watch",
      "primary": true,
      "works_with": null,
      "latest": { "temp_c": 17.2, "rh_pct": 58.2, "mold_index": null, "fan_rpm": null },
      "last_reading_at": "2026-10-03T12:01:34Z"
    }
  ],
  "open_requests": [
    { "kind": "inspection", "sensor_id": "roof-nw",
      "requested_at": "2026-10-03T18:40:00Z",
      "status_text": "Inspector will call within 1 working day" }
  ],
  "simulating": false,
  "updated_at": "2026-10-03T12:00:00Z"
}
```

- `score` 0–100; `score_word` one of `Good | Fair | Attention`; `score_trend`
  one of `improving | stable | declining`.
- `attention[]` ordered by severity (`alert` before `watch`), max ~5 items.
  `actions` lists one-tap next steps (`inspection` = book a local inspector,
  `expert` = remote VILPE expert review) — the vision's alert → fixed path.
- `open_requests[]` keeps a requested service visibly active (sidebar
  Services row and the attention item both show "Requested" + `status_text`)
  until it is resolved; one open request per `kind`.
- `home` is the address shown over the 3D view; `headline` is a short
  plain-language verdict (one line), `summary` one supporting sentence.
- `weather` is the outdoor context for the home's location (FMI later).
- `sensors[]`: every device the house scene renders. `kind`:
  `leak_sensor | fan | climate_sensor`. `status`: `ok | watch | alert`.
  `zone`: a stable string the frontend maps to a 3D anchor **computed from
  the house profile** (see the onboarding spec) — zones: `roof_south`,
  `roof_north`, `ridge`, `crawl_space`. `primary: true` marks devices shown
  on the model. `latest` (same shape as the detail endpoint) feeds the key
  values in each 3D callout. `last_reading_at` is when that device last
  reported. `state_label` is a one-word operating state for devices that
  act (fans: "Running", "Drying"; null for sensors) — fan callouts show it
  with the fan speed only. `works_with` links devices installed as one package — the
  crawl-space humidity sensor and the fan that dries the crawl space point
  at each other.
- **Demo home** (mock fixtures): a detached house at Yliopistonranta 1,
  Vaasa — four roof moisture sensors (two per slope), a roof fan on the
  ridge, and the crawl-space package (humidity sensor + drying fan). Seven
  devices.
- `simulating: true` while a leak simulation is running — the frontend uses
  this to keep the 15 s polling burst and can show a subtle "demo" badge.

### `GET /api/sensors/{id}` — detail

```json
{
  "id": "crawl-space",
  "name": "Crawl space",
  "kind": "climate_sensor",
  "zone": "crawl_space",
  "status": "ok",
  "status_text": "The crawl space is a little damp, which is normal for autumn. The crawl space fan is drying it.",
  "latest": { "temp_c": 15.5, "rh_pct": 73.0, "mold_index": 0.0, "fan_rpm": null },
  "works_with": "crawl-fan",
  "last_reading_at": "2026-10-03T11:45:46Z",
  "updated_at": "2026-10-03T12:01:34Z"
}
```

`status_text` is the interpreted, calm sentence — backend writes it, frontend
never composes interpretation. `latest` fields are nullable per device (the
crawl-space fan reports only `fan_rpm`; its humidity comes from the paired
sensor). The detail page shows `last_reading_at` and links the `works_with`
device.

### `GET /api/sensors/{id}/series?range=24h|7d|30d`

```json
{
  "id": "crawl-fan",
  "range": "7d",
  "points": [
    { "t": "2026-10-01T00:00:00Z", "temp_c": null, "rh_pct": null, "fan_rpm": 1680, "mold_index": null }
  ]
}
```

Backend downsamples to ≤ ~300 points. Fields are nullable per device; the
chart offers only the readings present in the series. `mold_index` present
only where the source data has it (fans, from 2026-03).

### `POST /api/help-requests`

Body `{ "kind": "inspection" | "expert", "sensor_id": "roof-nw" | null }`
(`sensor_id` is null when requested from the sidebar's Services list) →
`{ "message": "Inspection requested. A local VILPE-certified inspector will call you within one working day." }`.
The frontend shows the message in place of the action buttons.

### `GET /api/report`

The Moisture History Report (see the mockup PDF in `docs/`): property
meta, `headline` + `summary`, `months[]` of `{ month, roof, crawl_space }`
peak mold index, `mold_threshold`, `structures[]` (avg RH, peak mold index
+ month, risk periods, coverage, status) and measurement facts. Mock
fixture: `public/mock/report.json`.

### `POST /api/simulate/leak` · `POST /api/simulate/reset`

`leak` body: `{ "sensor_id": "roof-nw" }` (optional; backend picks a plausible
target if omitted). Starts a backend-side leak injection into the simulated
stream; `reset` returns the site to normal. Frontend just renders what
`/api/house` returns — the moment unfolds over a few minutes: `watch` →
`alert`, attention item appears, score declines. No simulation logic in the
frontend.

## Views

### HomePage (`/`)

- **Overview overlay** — top of the 3D view: address (`home`), `headline` as
  a large title with `summary` underneath, and an outdoor weather panel
  (temperature, condition, humidity, wind). Callouts stay below it.
- **ScoreCard** (sidebar) — Oura-style SVG ring, big score number,
  `score_word`, trend hint. No raw sensor values.
- **HouseScene** — fills the content area; each device is a status-colored
  dot with a leader line to a callout card (status dot, name, 2–3 key
  values). Very slow auto-rotate that pauses while hovering any dot or
  callout; OrbitControls clamped (no under-floor camera, sensible zoom
  limits). Click dot or callout → `/sensors/:id`. Callouts on the far side
  of the house fade, and hide while they would cover a front callout. No on-screen usage hints
  ("drag to rotate" etc.) — the homeowner shouldn't need instructions.
- **AttentionFeed** (sidebar) — `attention[]` as calm sentence cards with a
  severity accent (amber/red) and action buttons. Hidden entirely when
  empty — the overview headline already says all is well.
- **Demo controls** — small, secondary: "Simulate leak" button and, while
  `simulating`, "Reset demo".

### Sidebar (AppShell)

VILPE logo + tagline ("Peace of mind for your home"), Overview | Sensors
switch, score ring, attention feed with action buttons, a **Services** list
(Moisture History Report → `/report`; Ask a VILPE expert and Book an
inspection, each with a confirm step before `POST /api/help-requests`), a
live clock, demo controls and small dev links. Subpages (sensors, sensor detail, report)
start with a "← Back to overview" link.

### ReportPage (`/report`)

On-screen version of the Moisture History Report; "Download PDF" prints it
(sidebar and controls hidden in print).

### SensorDetailPage (`/sensors/:id`)

- `status_text` as the headline — interpretation first.
- `SensorChart`: smoothed line(s) — `rh_pct` always, `temp_c` toggleable,
  `mold_index` for fans when present. Range switch 24 h / 7 d / 30 d.
  Recharts, no raw spikes — the series is already downsampled by the backend;
  frontend additionally renders a smoothed/monotone curve.
- `latest` values in a de-emphasized row (small, muted — raw numbers live
  here only, never on home).
- Back link to the house. A `status`-colored chip echoes home-state.

## 3D house

- `three` + `@react-three/fiber` + `@react-three/drei` (OrbitControls, Html
  for labels, ContactShadows).
- Procedural low-poly model generated from the house profile (`house_type`,
  `floors`, `roof_type`, `attic`, `crawl_space`, `basement`) — the same
  generator serves the onboarding preview and this scene (see the onboarding
  spec). Materials: light walls, navy roof edge — matches the VILPE palette,
  not a generic dark scene.
- Zone anchors are computed Vector3s in model space, derived by the
  generator from the profile; each `zone` string maps to an anchor,
  `primary` sensors get a dot at their zone anchor (small jitter for
  multiple sensors in one zone).
- Hotspot = small emissive sphere: `ok` → Sense green, `watch` → amber +
  gentle pulse, `alert` → red + faster pulse. Bloom is optional polish —
  emissive + CSS glow is enough if postprocessing costs time.
- Ground: soft disc + ContactShadows, light fog — calm, Oura-like space.

## Visual identity — VILPE brand

Extracted from `vilpe.com` and `sense.vilpe.com` production CSS (Oct 2026).
The app is **light** — VILPE is a light brand; the previous dark/fuchsia
hackathon landing is replaced.

**Palette**

| Token | Hex | Use |
| --- | --- | --- |
| `navy` | `#01273e` | Primary brand color — headings, dark surfaces, text emphasis |
| `orange` | `#e3530f` | VILPE accent — primary CTAs, score ring accent |
| `sense-blue` | `#004f9f` | Interactive elements, links, info |
| `ok` | `#50c92f` | Status ok (Sense app green) |
| `watch` | `#f5be23` | Status watch (Sense app amber) |
| `alert` | `#df0a15` | Status alert (Sense app red) |
| `bg` | `#f5f5f5` | Page background |
| `surface` | `#fefefe` | Cards |
| `muted` | `#797979` | Secondary text |
| `line` | `#e6e6e6` | Borders, dividers |

Map these as Tailwind v4 `@theme` tokens in `index.css`; status colors are
semantic and identical to the real Sense app.

**Type**

- Display/headings: **Titillium Web** (Google Fonts) — closest free
  approximation of Klavika, the Typekit font the Sense app uses for headers.
- Body: `Inter`, falling back to `Helvetica Neue, Arial, sans-serif` —
  matches the Neue Haas Grotesk look of vilpe.com without a license.

**Tone of voice:** calm, plain English, no jargon, no exclamation marks.
Attention items read like "Your structures are drying normally for October;
keep an eye on the north slope" — never "RH 78.4% +2.1pp".

## Frontend rules (from the vision)

- **Few numbers on home.** Score, word, sentences, colored dots, plus only
  the 2–3 key readings per device in the 3D callouts. Charts and full
  readings live on sensor detail.
- **Interpretation comes from the API.** Frontend renders `summary`,
  `status_text`, `attention[].message` verbatim; it never invents text.
- **Slow and smoothed.** 60 s polling, smoothed charts, gentle animations.
  Nothing flickers or live-gauges.
- **Responsive enough.** Desktop-first for the demo; must not break at
  laptop/tablet widths. Mobile is post-hackathon.

## Dependencies

New: `react-router-dom`, `three`, `@react-three/fiber`, `@react-three/drei`,
`recharts`. All established; pin versions ≥ 1 week old at install. Google
Fonts via `<link>` in `index.html` (no font dep).

## Mock layer

The initial data source — everything runs on this until the backend exists.
Fixture timestamps are shifted at read time so the newest reading is ~12
minutes old, keeping a recorded demo "live" whenever it runs.

- `VITE_API_MODE=mock` (default) → `client.ts` reads `public/mock/*.json`
  with the same paths (`/mock/house.json`, `/mock/sensors/roof-nw.json`, …).
- Fixtures are hand-written to the contract, with realistic curves — generate
  `series` JSONs from `data/readings/fans/*.csv` where useful (a small
  one-off script is fine, or handcraft).
- Mock leak: `mock.ts` keeps a tiny in-memory state so "Simulate leak" flips
  `simulating`/`status`/`attention` in mock responses — enough to rehearse
  the demo flow end-to-end without the backend.

## Verification

- `npm run lint` + `npm run build` clean.
- Manual demo-flow smoke (mock mode; live mode once backend lands): score renders, house
  rotates and is orbitable, hotspot click → detail page with chart,
  "Simulate leak" → within ~15 s a watch/alert state + attention item +
  score decline, reset returns to normal.

## Out of scope

- Auth, multiple sites, admin views, mobile layout, PDF reports, marketplace
  — all post-hackathon per `docs/VISION.md`.
- Backend entirely — deferred until the mock has settled the data shape; the
  contract is then the boundary the API gets designed from.
