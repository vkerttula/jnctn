# Onboarding spec — house setup flow

**Status:** accepted · **Date:** 2026-10-03 · **Owners:** frontend (extends
`2026-10-03-frontend-design.md`)

The flow that takes a new user from registration to a configured,
sensor-covered home — ending on the dashboard described in the frontend
spec. It exists because the demo is a **recorded video**: the flow must
work end-to-end, deterministically, and look good on camera in a single
take. See `docs/VISION.md` for tone ("calm, no scary numbers").

## Locked decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Demo role | **Recorded video** | Flow must actually run; pacing deterministic, no waits, "Start over" enables re-takes |
| Sensor placement | **Auto-suggested, user confirms + can drag** | Sells "installation is easy, VILPE knows where sensors belong"; dragging is the interactive demo moment |
| Address lookup | **Canned list** | 3–5 hand-written Finnish addresses incl. the real Vantaa site; offline-safe, zero risk during recording |
| Auth | **Light mock-auth** | Email + password → localStorage session; logged-in state in header. No backend — spec's "auth out of scope" holds |
| History after setup | **Instant 30 days** | Dashboard arrives fully populated — "as if you'd been a customer for a month" |

## User flow

`/welcome` → `/onboarding` (one route, internal stepper, 4 steps) → `/` dashboard.

1. **Welcome/auth** — sign up / sign in form. Email + password persisted
   to localStorage as a session; narrative registration, no backend call.
2. **Address** — autocomplete over the canned list. On select, a
   "we found your home" card reveals detected facts (house type, year
   built, m², roof type) — the prefill moment.
3. **Your home** — user confirms/adjusts: house type, floors (stepper),
   living area m² (slider), year built; attic (`cold | warm | none`),
   crawl space (bool), basement (bool), roof type
   (`pitched | flat | green`). **A persistent 3D preview builds live on
   the right** — massing, roof, plinth appear as answers change.
4. **Sensors** — `recommendSensors(profile)` computes the package; dots
   appear on the model sequentially, each with a one-line rationale
   ("moisture collects on the north slope"). User may drag dots along
   house surfaces, then confirms.
5. **Done** — "Your sensors connect automatically" transition →
   dashboard, mock serves a full 30-day history immediately.

## Sensor recommendation rules

`recommendSensors(profile): SensorPlacement[]` — a pure, testable
function; no AI. Suggested rules (target ~5–8 sensors):

- always: 1 outdoor reference on the north wall
- `crawl_space` → 1 crawl-space sensor **and** 1 ventilation fan
  (`kind: fan` — VILPE's drying fan product)
- `basement` → 1 basement sensor
- `attic: cold` → ridge + eave (2 sensors)
- `attic: warm` → 1 attic sensor
- `roof_type: pitched` → 1 sensor per slope (2)
- `roof_type: flat` → 1 roof sensor
- `roof_type: green` → 2 green-roof sensors
- `floors ≥ 2` → 1 wall sensor per additional floor

## Drag mechanics

Sensor dots are draggable on the 3D model. During a drag the pointer
raycasts **only against house meshes**; the dot slides along the hit
surface — a sensor attaches to the structure, it never floats. Each
house mesh knows its zone (north slope, south wall, plinth, …); on drop
the dot's `zone` updates to the surface it landed on.

**Interior spaces have no visible surface**, so interior sensors snap to
their structural element instead: crawl-space sensors to the plinth
band, attic sensors to the roof volume, basement sensors below grade.
No cutaway view — keeps the model simple and the drag unambiguous.

## Data model

Stored client-side: session under `jnctn.session`, profile under
`jnctn.profile` (localStorage).

```ts
interface HouseProfile {
  address: string;
  location: string;            // weather chip label, e.g. "Vaasa"
  house_type: "detached" | "semi" | "row";
  floors: number;
  living_m2: number;
  year_built: number;
  roof_type: "pitched" | "flat" | "green";
  attic: "cold" | "warm" | "none";
  crawl_space: boolean;
  basement: boolean;
  sensors: SensorPlacement[];  // from recommendSensors, then user-edited
}

interface SensorPlacement {
  id: string;
  name: string;                // plain-language, e.g. "North slope"
  kind: "leak_sensor" | "fan";
  zone: string;                // stable zone string per the frontend contract
  anchor: [number, number, number];  // model-space position
}
```

`api/mock.ts` reads the stored profile: sensors, zones and anchors come
from it, and 30-day series are synthesized deterministically (seeded
RNG — every recording take looks identical). `/api/house`'s `sensors[]`
list is therefore profile-driven; the canned "no profile" fixture is the
fallback for a session that skips onboarding (shouldn't happen — the
guard redirects).

## Architecture additions

```
frontend/src/
  auth/session.ts       # signUp/signIn/signOut + session state (localStorage)
  house/profile.ts      # HouseProfile type + canned address list
  house/generator.ts    # profile → { meshes, zoneAnchors } for R3F
  sensors/recommend.ts  # profile → SensorPlacement[] (pure)
  pages/WelcomePage.tsx
  pages/OnboardingPage.tsx    # stepper shell + persistent HousePreview
  components/onboarding/{AddressStep,HomeFactsStep,SensorsStep}.tsx
```

**One generator, two consumers:** `generator.ts` builds both the
onboarding preview and the dashboard `HouseScene`. This replaces the
frontend spec's hand-placed zone anchors — anchors are *computed* from
the profile.

**Routes** (extends the frontend spec): `/welcome`, `/onboarding`, `/`
(guarded — no session or no profile → redirect `/welcome`),
`/sensors/:id` (guarded), `/data` (unguarded dev page). Header gains
"Sign out" and "Start over" (clears localStorage — the video re-take
button).

## Video choreography

- Everything deterministic and instant — no loading spinners on the
  happy path; seeded mock means identical runs.
- The house builds with a subtle staggered scale-in per step; sensor
  dots pop in sequentially in step 4.
- The transition from step 5 to the dashboard should land on an already
  populated house — the "wow, it's alive" reveal.

## Out of scope

- Real auth, backend persistence, real geocoding, multiple homes,
  interior cutaway view, mobile layout — all post-hackathon.
- Backend unchanged: auth and profiles stay client-side; the only
  contract touch is the `profile` shape above, which the real backend
  can adopt later.

## Verification

- `npm run lint` + `npm run build` clean.
- Manual recordable run: `/welcome` → onboarding → dashboard populated;
  drag a sensor — it sticks to surfaces, zone updates; no-session visit
  to `/` redirects to `/welcome`; "Start over" returns a clean wizard.
