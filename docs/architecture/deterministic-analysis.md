# Deterministic analysis — from sensor readings to a score

**Status:** living reference (describes the code on `main`; update it with
`backend/app/analysis/`) · **Last verified:** 2026-10-04 · **Owners:** backend

How jnctn turns raw VILPE Sense readings into the numbers and verdicts the UI
shows: the 0–100 house score, its tone, the findings behind it, per-sensor
statuses, the attention feed, chart "normal" bands and the moisture report.
None of this involves an LLM. The language layer that sits on top is covered
in `llm-narration.md`. The design rule that connects the two:
**code decides, the LLM only describes.** Score, tone and findings are fixed
before any model is called, so the number stays stable and auditable, and
the template fallback can render the same conclusions with no model at all.

Code lives in `backend/app/analysis/` (`digest.py`, `score.py`,
`service.py`, `simulate.py`, `weather.py`), `backend/app/routers/house.py`
(the frontend contract) and `backend/app/ingest.py`.

## Pipeline at a glance

```
VILPE Sense API ─┐                     ┌─ /api/analysis?window=
sensors.csv ─────┤                     │
                 ▼                     │
ingest ──► sense_* collections ──► digest(window) ──► events ──► score ──► narrate*
                 │                 stats, baseline,   detected    0–100,    (LLM or
                 │                 buckets, grid      episodes    tone,     template)
                 │                                                findings     │
                 │                                                   ▼         ▼
                 │                                        analyses cache (window, period)
                 │                                                   │
                 └──► house router: logical catalog, statuses, feed, series,
                      normal bands, report aggregates ──► /api/house, /api/sensors/*,
                                                          /api/report
```
\* narration is covered in `llm-narration.md`.

## 1. Input data

### Sources and collections

| Collection | Source | Content |
| --- | --- | --- |
| `sense_site` | Sense API `/roofs/public/{link}` | Site metadata (1 doc) |
| `sense_devices` | same | 7 MCU-2 ventilation fans: slug, `is_online`, `is_alert`, layout coordinates |
| `sense_sensors` | same | 51 RHT-2 roof grid sensors: serial, `is_online`, layout `coordinates` |
| `sense_fan_readings` | `/public-measurements/{device_link}` | Per-fan merged series, unique on `(device_id, ts)` |
| `sense_sensor_readings` | `data/readings/sensors.csv` | Hourly grid readings, unique on `(sensor_id, ts)` |

`app/ingest.py` upserts everything idempotently, so re-running it is safe.

### Fan reading shape

The API returns each value type as its own series, each with its own
timestamps. Ingest merges them by timestamp into one document per instant:

```
{ device_id, device: "<slug>", ts,
  rpm, mold_index,
  indoor:  { temp_c, rh_pct, abs_humidity_g_m3 },   # structure-side RHT-1 transmitter
  outdoor: { temp_c, rh_pct, abs_humidity_g_m3 } }  # outdoor reference transmitter
```

The documents are sparse: a given `ts` may carry only some of these fields.
That is why the analysis code always filters `field: {$ne: null}` when it
looks up a value.

**Absolute humidity** is not exposed by the API. Ingest derives it from T and
RH with the Magnus formula (`ingest.abs_humidity`):

```
es  = 6.112 · exp(17.67·T / (T + 243.5))        # saturation vapour pressure, hPa
AH  = 2.1674 · es · RH / (273.15 + T)           # g/m³
```

AH is the key physical quantity in this system. RH only says how close air is
to saturation at its own temperature, while AH lets indoor (structure) and
outdoor air be compared directly. If the structure holds more water per m³
than the outdoor air, it cannot dry by ventilation.

### Device slugs and labels

Slugs come from device names (`"VILPE Vantaa, Katto 1"` → `katto-1`).
`digest.DEVICE_LABELS` maps each slug to a human label that later appears in
findings and narration:

| Slug | Label | Location |
| --- | --- | --- |
| `katto-1` … `katto-4` | roof section 1–4 | roof |
| `viherkatto-1`, `viherkatto-2` | green roof 1–2 | green roof |
| `hallin-alapohja` | the crawl space | crawl space / base floor |

### Cadence and time

- Fan indoor/outdoor RH and T arrive about every 2 h. `rpm` and
  `mold_index` arrive about hourly. `mold_index` only exists from
  2026-03-27 onward.
- Grid sensors report **every 12 h** (all 51 sensors on the same two
  timestamps a day, about 731 rows each), not hourly as `data/README.md` and
  the ingest docstring say. They come from a **one-year CSV snapshot
  (2025-09-11 → 2026-09-11)**. Fans are live up to "now", while the grid
  ends about three weeks before the demo date.
- All Mongo timestamps are UTC. The CSV's naive Europe/Helsinki times are
  converted during ingest.

## 2. Physical → logical model

A homeowner doesn't think in 51 sensors and 7 fans. `house.CATALOG` exposes
**7 logical devices**:

| Logical id | Kind | Built from | Aggregation |
| --- | --- | --- | --- |
| `roof-nw`, `roof-ne`, `roof-sw`, `roof-se` | `leak_sensor` | grid sensors split into quadrants | mean of member sensors |
| `roof-fan` | `fan` | the 6 `katto-*` / `viherkatto-*` fans | mean T / RH / rpm, **max** mould index |
| `crawl-space` | `climate_sensor` | `hallin-alapohja` indoor T / RH / mould | direct |
| `crawl-fan` | `fan` | `hallin-alapohja` rpm | direct |

**Quadrant split** (`_quadrant_members`): the median x and median y of all
sensor layout coordinates divide the roof plan into four parts. `y ≤
median_y` is treated as north (it assumes the layout image has north at the
top) and `x ≤ median_x` as west. Using medians gives each quadrant roughly a
quarter of the sensors.

**Latest values** (`_latest_for`):
- Quadrants: each member sensor's newest reading, averaged.
- Roof fan: each fan's newest value per field. T, RH and rpm are averaged;
  mould index takes the maximum, because the worst structure should not be
  averaged away.
- `last_reading_at` is the newest timestamp among the inputs.

**Fan state label**: `"Stopped"` if the latest rpm is falsy. Otherwise
`"Running"` for the roof fan and `"Drying"` for the crawl fan.

## 3. The digest

`digest.build(window, now)` produces the **context packet**, a compact,
statistics-only summary of the house over one window. Raw series never leave
this module. Scoring reads the digest, and so does the LLM. Its size scales
with device count × bucket count, not with history length.

### Windows

| Window | Span | Baseline (preceding) | Buckets | Min RH-run length | Cache period key |
| --- | --- | --- | --- | --- | --- |
| `day` | 24 h | 7 days | — | 6 h | hourly (`%Y-%m-%dT%H`) |
| `week` | 7 d | 7 days | per day | 24 h | daily |
| `month` | 30 d | 30 days | per week | 24 h | daily |
| `year` | 365 d | none | per month | 48 h | monthly |

The baseline is the stretch immediately **before** the span, e.g. for `day`
the 7 days ending 24 h ago.

### Per-device block

For every device in `sense_devices`:

- **`span` / `baseline` stats**: one Mongo `$group` over `sense_fan_readings`
  giving `n`, mean/max indoor RH, mean indoor/outdoor T, mean indoor/outdoor
  RH, mean indoor/outdoor AH, mean/max mould index, mean/min rpm. Values are
  rounded to 2 dp.
- **`buckets`**: the same stat group, truncated per day/week/month with
  `$dateTrunc` (omitted for `day`).
- **`latest`**: the newest non-null value of each field within a 400-day
  lookback, each with its own timestamp, so a value can be older than the
  span.
- **`trend`** (only when both span and baseline exist):
  - `indoor_rh_delta` = span mean RH − baseline mean RH
  - `mold_delta` = span mean mould − baseline mean mould
  - `ah_delta_delta` = (indoor − outdoor AH)<sub>span</sub> − (indoor −
    outdoor AH)<sub>baseline</sub>, i.e. whether the structure's moisture
    surplus over outdoor air is growing.
- `is_online`, `is_alert` copied from device metadata.

### Sensor-grid block

`_sensor_grid` summarises the 51 grid sensors:

1. **Anchoring.** `as_of` is the newest grid reading. If it falls before the
   span start (it does: the CSV snapshot ended 2026-09-11), the grid window
   becomes `[as_of − span_length, as_of]`. `data_lag_days` records how stale
   that is.
2. Per sensor: mean RH, max RH, mean T and `n` over that window.
3. A sensor is **offline** if its metadata says `is_online: false` **or** it
   has no readings in the window.
4. **Grid median** = upper-middle element of the sorted per-sensor RH means
   (`means[len // 2]`, not averaged for even counts).
5. `pct_sensors_mean_rh_ge_80` / `_ge_90`: share of live sensors whose mean RH
   is ≥ 80 / ≥ 90 %.
6. **Outliers**: live sensors whose mean RH is ≥ grid median + 10 pp. A
   sensor that is much wetter than its neighbours is the classic signature of
   a local leak.

The digest carries `outliers` and `pct_..._ge_80` to the narrator, but
**scoring doesn't use them**. Scoring only uses `pct_..._ge_90` and the
offline list.

### Weather block

`digest.weather` is the real outdoor weather at the sensor site (Vantaa),
from daily Open-Meteo history (§9). `build` fetches it once for baseline +
span and shares it with event detection. Rows use local (Helsinki) dates:

- `span` / `baseline`: `weather.summarize` over the span's local dates,
  and over the baseline's dates without the span's first day.
  Fields: `days`, `condition`, `precip_mm`, `rainy_days` (≥ 1 mm),
  `wettest_day`, `temp_mean` / `min` / `max`, `rh_mean`, `wind_max_ms`.
- `buckets`: the same per day / week / month. Weeks start on Sunday to
  match `$dateTrunc`, so the labels line up with the device buckets.
- **`condition`** (`weather._condition`): `wet` if at least half the days are
  rainy or mean RH ≥ 90 %, `dry` if at most 20 % are rainy and mean RH
  < 80 %, otherwise `mixed`.
- `null` when no history is available (network failure with nothing
  cached). Everything downstream then behaves as it did before weather
  existed.

Also in the digest: `season` (meteorological, from the month: Dec–Feb
winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn), `site` (name plus a
hardcoded `"Vantaa, Finland"`) and `period`.

## 4. Event detection

`digest._events` scans the digest, plus targeted series reads, for discrete
**events**, i.e. conditions worth talking about.

### Sustained-run detector

`_sustained_runs(points, threshold, min_duration)` walks a time-ordered
series and returns episodes where the value stayed `≥ threshold`:

- A run starts at the first qualifying point and extends while points keep
  qualifying. It tracks `start`, `end` (last qualifying point) and `peak`.
- A point below threshold **closes** the run.
- A **gap > 12 h** (`MAX_GAP`) between consecutive points also closes the
  run. The point after the gap cannot start a new run itself; the run
  restarts from the next qualifying point after it.
- A run is kept only if `end − start ≥ min_duration`.

Duration is measured between the first and last qualifying samples, so a run
of N points about 2 h apart has a duration of about 2·(N−1) h.

### Event types

| Event | Trigger | Extra fields |
| --- | --- | --- |
| `RH_SUSTAINED_HIGH` | indoor RH ≥ **85 %** sustained ≥ window min-run (6 h / 24 h / 24 h / 48 h) | `peak_rh`, `duration_hours`, `ongoing` = run ended ≤ 6 h ago, `outdoor_weather` over the run's dates |
| `MOLD_INDEX_ELEVATED` | mould index ≥ **0.5**, any duration (min-run = 0, so a single sample counts) | `peak`, `ongoing` = run ended ≤ 24 h ago |
| `AH_INVERSION` | span mean indoor AH − outdoor AH ≥ **0.5 g/m³** | `indoor_ah`, `outdoor_ah` ("wetting, not drying"), `outdoor_weather` over the span |
| `FAN_STOPPED` | latest rpm (400-day lookback) < **100** | `rpm` |
| `FAN_NO_DATA` | no rpm reading at all in the lookback | — |
| `DEVICE_ALERT` | device metadata `is_alert` is true (VILPE's own flag) | — |
| `SENSOR_OFFLINE` | each grid serial in `sensor_grid.offline` | `serial` |
| `LEAK_SIMULATED` / `SENSOR_LEAK_SIMULATED` | injected only while the demo simulation is active (§10) | `peak_rh`, `simulated` |

RH and mould events can occur multiple times per device per window (one per
episode). The others occur at most once per device or sensor.
`outdoor_weather` holds `{condition, days, precip_mm, rainy_days, rh_mean}`,
or `null` without weather history.

## 5. Scoring

`score.score_digest(digest)` → `{score, tone, findings}`. The score starts at
100 and **only detected events remove points**. Raw values never subtract
directly.

### Step 1 — points per event

| Event | Base points | Modifiers | Finding severity |
| --- | --- | --- | --- |
| `MOLD_INDEX_ELEVATED` | `min(40, 15 + 30·peak)` | ×0.5 if not ongoing | `attention` if peak ≥ 0.8, else `watch` |
| `RH_SUSTAINED_HIGH` | `min(12, 3 + hours/12)` | +3 if ongoing; ×0.35 weather discount (below) | `watch` |
| `AH_INVERSION` | 6 | ×1.5 in dry weather (below) | `watch` |
| `LEAK_SIMULATED`, `SENSOR_LEAK_SIMULATED` | 30 | — | `attention` |
| `FAN_STOPPED` | 8 | — | `watch` |
| `DEVICE_ALERT` | 10 | — | `watch` |
| `FAN_NO_DATA` | 3 | — | `info` |
| `SENSOR_OFFLINE` | 1 | group total capped at 5 | `info` |

**Weather adjustments** (`score._weather_adjust`). These weigh an event
against the weather it happened in:

- **RH weather discount (×0.35).** High indoor RH that is really weather
  isn't a structural problem. An `RH_SUSTAINED_HIGH` episode is discounted
  in either of two cases:
  - the device's span mean `indoor_AH − outdoor_AH ≤ 0.2 g/m³` (it mirrors
    the outdoor air)
  - the episode's `outdoor_weather.condition` is `wet` and the AH delta is
    missing or `< 0.5` (it rode a wet spell without the structure clearly
    holding extra moisture)

  A structure that is clearly wetter than outdoor air (delta ≥ 0.5) is never
  excused by rain, since rain is exactly when a leak shows. The finding
  records `detail.weather_driven`.
- **Dry-weather penalty (×1.5).** An `AH_INVERSION` during a `dry` span
  means the structure stayed wetter than outdoor air even though it could
  have dried, so it weighs more. The finding records `detail.dry_weather`.

With no weather history, only the AH-delta discount applies.

### Step 2 — group recurrences

Events are grouped by `(type, device or serial)`. Within a group the
**worst** episode is the finding. Its points are scaled by the recurrence
multiplier `min(1.5, 1 + 0.05·(n − 1))`, so ten repeats add at most +45 %
and the cap is +50 %. The finding gets `occurrences = n` and `since` =
earliest episode start.

### Step 3 — harmonic discount across groups

Group penalties are sorted descending and divided by their rank:

```
penalty = Σ points_i / (rank_i + 1)          # rank 0 = worst
```

The worst problem counts fully, the second counts half, the third a third,
and so on. A long window with many minor findings therefore cannot drive the
score to zero by itself. `SENSOR_OFFLINE` groups go through the same divisor
but their total is capped at 5 points.

### Step 4 — grid humidity

If `pct_sensors_mean_rh_ge_90 > 0`, add `min(10, pct/5)` points, undiscounted
(50 % of the grid ≥ 90 % caps it at 10), and a `GRID_HUMID` finding
(`watch`, no location).

### Step 5 — score and tone

```
score = clamp(round(100 − penalty), 0, 100)
tone  = all_good  if score ≥ 80
        watch     if score ≥ 55
        attention otherwise
```

Findings are sorted by severity (`attention` > `watch` > `info`). Each
finding carries `code`, `severity`, `location` (the device label), `ref`
(slug or serial) and a small `detail` dict. The UI shows these as
`score_factors`.

### Score trend

`score.score_trend`: mean of all devices' `trend.indoor_rh_delta`. A mean
≤ −1.5 pp is `improving`, ≥ +1.5 pp is `declining`, and anything else is
`stable`. The `year` window has no baseline, so it is always `stable`.

### Worked example (illustrative numbers, `day` window)

| Group | Raw points | Rank | Counted |
| --- | --- | --- | --- |
| Mould in the crawl space, peak 0.83, ongoing | min(40, 15+24.9) = 39.9 | 0 | 39.90 |
| Fan stopped, green roof 2 | 8 | 1 | 4.00 |
| Crawl space RH ≥ 85 % for 20 h, ongoing, AH +1.5 (no discount) | min(12, 3+1.67) + 3 = 7.67 | 2 | 2.56 |
| AH inversion, crawl space | 6 | 3 | 1.50 |
| 2 grid sensors offline | 1 + 1 | 4, 5 | 0.37 |

Penalty ≈ 48.3 → **score 52, tone `attention`**. The same 20 h RH run on a
device whose AH tracks outdoor air would count 7.67 × 0.35 ≈ 2.7 before rank
discounting.

## 6. From findings to UI state

`routers/house.py` translates the `day` analysis into the frontend contract.

**Severity → sensor status:** `attention → alert`, `watch → watch`,
`info → ok`.

**Finding → logical sensor** (`_finding_sensor_id`):
- ref is a catalog id → itself (simulated events)
- ref `hallin-alapohja` → `crawl-fan` for fan findings (`FAN_STOPPED`,
  `FAN_NO_DATA`, `DEVICE_ALERT`), otherwise `crawl-space`
- ref in `katto-*` / `viherkatto-*` → `roof-fan`
- ref is a grid serial → its quadrant
- no ref (e.g. `GRID_HUMID`) → not attached to any sensor

**Sensor status** in `/api/house` = the most severe mapped finding (default
`ok`). **Area status** (`roof` = 4 quadrants + roof fan, `crawl_space` =
crawl-space + crawl-fan) = the worst member.

**Score word** (`/api/house`): `Good ≥ 75`, `Fair ≥ 60`, else `Attention`.
These are different cut-offs from the tone (see §14).

**Attention feed:**
1. While simulating, the simulated item comes first.
2. Every `watch` / `attention` finding that maps to a sensor becomes an
   item. Its message is the narrative's matching attention item (matched by
   location label, consumed once) or a template (`fallback.describe_finding`).
   `since` = the finding's earliest episode start.
3. Actions: `attention` → inspection + expert; `watch` → expert only.
4. Deduplicated to one item per sensor (most severe wins), capped at 5.

## 7. Chart analytics (`/api/sensors/{id}/series`)

- **Window end** = the newest reading for that source, not "now". Grid
  quadrants therefore end on the CSV snapshot date.
- **Bucketing**: hourly for ranges ≤ 30 d, daily for `1y`. Each bucket is the
  mean across every member feeding the logical sensor (e.g. all quadrant
  sensors, all six roof fans).
- **Downsampling**: keeps every `stride`-th bucket, `stride = max(1,
  len // 300)`, which gives roughly 300–600 points.
- **Aliasing.** Downsampling picks buckets by position, regardless of which
  fields they contain. The crawl-space device reports mould every hour but
  RH only every 2 h, always on even UTC hours. Its 30 d window has about 721
  hourly buckets, so `stride = 2`. Depending on whether the first bucket
  falls on an odd or even hour, the chart keeps either every RH bucket or
  none. Replicated at `end = 2026-10-03 11:27`, it kept **0 of 358** RH
  buckets. The 30 d crawl-space chart then shows no humidity line and no
  normal band, and its chart summary gets no RH stats. This flips as the
  window end moves from hour to hour.

### Seasonal normal band

`_normal_band` (`routers/house.py`) produces the green "normal" ribbon
behind the humidity line. The aim, as stated in commits `cee3ea3` and
`001367c`: show the homeowner what humidity is *normal for this device at
this time of year*, so that a slow anomaly stands out instead of being
absorbed into its own baseline.

#### Algorithm

```
hourly = $dateTrunc(hour) mean of the RH field over the device's FULL stored
         history (all members averaged per bucket; no ts filter)
cur    = (end.year, end.month)                      # the still-running month

for each calendar-month span [x1, x2) covering [start, end):
    rows = sorted hourly values where
               t.month == x1.month                  # same month …
           and t.year  != x1.year                   # … in another year
           and (t.year, t.month) != cur             # never the running month
    if len(rows) < 48:                              # "no real prior-year coverage"
        rows = sorted hourly values in [x1, x2)     # fall back to the span itself
    if len(rows) < 10: skip this span
    lo, hi = rows[n // 5], rows[4n // 5]            # P20 / P80, index-based
    band   = [max(0, round(lo − 3)), min(100, round(hi + 3))]

1 band  → {label: "Normal for <end month>", rh_pct}
>1 band → {label: "Seasonal normal", rh_pct: last band, bands: [...]}
none    → null
```

Design choices worth knowing:
- **Device-relative, not physical.** "Normal" means *normal for this
  sensor*. There is no absolute humidity threshold and no outdoor reference.
- **P20–P80 ± 3 pp.** The middle 60 % of hours plus a margin, so about 75–90
  % of a typical month's hours fall inside. Being outside the band is common
  enough that it shouldn't alarm anyone.
- **Hourly means as the unit**, so a device that samples more often doesn't
  get more weight. For multi-member sensors (quadrants, the roof fan), each
  bucket is the mean of whichever members reported that hour.
- **Excluding the span's own instance** is what makes this climatology and
  not a rolling percentile. The commit `cee3ea3` message explains why: the
  previous trailing-30-day rule let a slow anomaly drift into its own
  baseline within a month, and its "Normal for <month>" label was wrong.

#### Where it's used

- Drawn by `SensorChart.tsx` as recharts `ReferenceArea`s (green, 10 %
  opacity), only when the humidity line is visible. The legend shows the
  label.
- Passed to the per-sensor LLM as `normal_band` context.
- **Not used anywhere else.** Sensor status, findings, score and the
  template chart sentence ignore it. The fallback's "Humidity stayed near
  its normal range" comes from `delta` within ±5 pp, not from the band, and
  `STATUS_TEXT`'s "within the normal range for the season" is fixed text.

#### How it behaves on the real data

The algorithm was re-run with a stdlib replica on `data/readings/`.
Windows end at the source's newest reading: fans 2026-10-03, grid
2026-09-11.

| Logical sensor | 24h | 7d | 30d | 1y (13 monthly bands) |
| --- | --- | --- | --- | --- |
| `crawl-space` | climatology (Oct 2025) | 2 bands, climatology | 2 bands, climatology | 7 own-span (Oct–Apr) + 6 climatology (May–Oct) |
| `roof-fan` | climatology | 2 bands, climatology | 2 bands, climatology | same split as crawl space |
| `roof-*` quadrants | **no band** (< 10 hourly rows) | 1 band, **own-span** | 2 bands, own-span | **all 13 own-span** |

What this shows:
1. **The climatology path rarely applies.** Fan history starts 2025-05-13,
   so only May–October have a second year. The grid has a single year, and
   its one overlapping month (September) has about 42 hourly rows, under the
   48-row cut-off. Every quadrant band, and 7 of 13 fan bands in a year
   view, are computed from **the span's own readings**: the self-referential
   baseline that `cee3ea3` set out to remove. The label still says
   "Normal for September" either way, and the API doesn't say which path
   was used.
2. **The fallback is the problem, not the climatology.** Own-span bands
   contain 71–100 % of their own plotted points by construction (P20–P80
   plus the margin). Climatology bands are where real deviation shows: May
   2026 against May 2025 put only 16/31 (crawl space) and 8/31 (roof fan)
   of daily points inside the band.
3. **"Normal" isn't "healthy".** The crawl space's summer climatology bands
   are **[95, 100]** and **[97, 100]** % RH, pinned at the sensor's ceiling.
   A persistently saturated crawl space gets a green "normal" ribbon around
   100 %, while the score treats the same device as the main moisture
   finding.
4. **Summer roof bands are wide.** Individual roof fans swing roughly 25 →
   80 % RH day to night in June (P20 ≈ 22–44 %, P80 ≈ 71–79 %), so June's
   roof-fan band is [51, 100] and May's is [50, 100]. It flags little in
   summer. Averaging a changing set of 1–5 reporting fans per hour adds some
   noise on top.
5. **12-hourly grid data starves the row thresholds.** Thresholds of "48
   hourly rows" and "10 rows" assume hourly data. A quadrant gets about 2
   buckets a day, so 24 h windows never get a band.

#### Rendering defects

- **The newest band is never drawn on multi-band charts.** recharts 3.10.1
  `ReferenceArea` defaults to `ifOverflow: 'discard'` and drops an area if
  either x-corner is outside the axis domain. The chart's domain is
  `dataMin..dataMax` of the plotted points. The last band's `to` is the raw
  newest reading timestamp (e.g. 11:27), while the last plotted point is an
  hour- or day-truncated bucket (11:00, or earlier after downsampling), so
  `to > dataMax`. In the replica, the last band was dropped on **every
  `1y` chart** (daily buckets truncate to midnight) and on every fan-backed
  `7d`/`30d` chart (`crawl-space`, `roof-fan`). Grid quadrants only escape on
  `7d`/`30d` because their 12-hourly timestamps fall exactly on the hour,
  so `to == dataMax`. The dropped band covers the current month, which is
  the one an anomaly should be judged against. A few days after the 1st,
  most of a 7 d chart has no ribbon. Mock fixtures hit the same problem on
  every `1y` chart and on the fan-backed `30d` charts. Fixes are either
  `ifOverflow="hidden"` on the band, or clamping `from`/`to` to the plotted
  range in the backend.
- **Month boundaries are drawn at the window start's time of day.**
  `_month_spans` advances with `cur.replace(day=1) + 32 days`, which keeps
  `start`'s hour and minute. Steps land at e.g. `2026-06-01 11:27Z` instead
  of midnight. The climatology match uses `t.month` (UTC), so the hours
  before that offset on the 1st are judged against the new month's band but
  drawn under the old one. All month logic is in UTC, not Helsinki time.
- **Short windows can straddle months.** A 24 h or 7 d window that crosses
  the 1st returns two bands, labelled "Seasonal normal".

#### Cost

`_hourly_rh` aggregates the full history with no time filter on every
`/series` request, for every range. Nothing is cached. That is about 36 k RH
docs for the roof fan, and less for the other sensors.

#### Mock-mode differences (`scripts/gen_mock_data.py`)

The mock generator documents itself as mirroring the backend, but it
differs:
- It takes percentiles over **raw points**, not hourly means.
- RHT timestamps stay in Helsinki time, so its month boundaries are local.
- RHT series are **time-shifted** (about 22 days) to end "now", so mock
  "Normal for October" for the roof sensors is built mostly from September
  2025 readings relabelled as October.
- The mock `crawl-space` is backed by `katto-2` (a roof fan), so mock
  crawl-space bands look nothing like the live ones.

## 8. Moisture History Report (`/api/report`)

Aggregates over the full fan history (`first → last` fan reading):

- **Monthly peak mould index**, split into roof (any `katto-*` /
  `viherkatto-*`) vs crawl space (everything else).
- **Structures** (roof north slope, roof south slope, crawl space):
  - `avg_rh_pct`: mean grid RH for the slope's quadrant sensors. For the
    crawl space, the fan's indoor RH mean.
  - `peak_mold_index` / `peak_month`: the month with the highest mould peak.
    **Both roof slopes use the same six roof fans**, so their mould figures
    are identical.
  - `risk_periods`: number of calendar months with any mould reading ≥ 0.5.
  - `coverage_pct`: readings ÷ (span days × 24 × member count). This assumes
    hourly data, but grid sensors report every 12 h, so roof coverage comes
    out around 6 % even with no gaps.
  - `status`: `"Dry"` if peak mould < 0.6, else `"Moisture risk"`.
- Headline, summary and recommendations come from the cached `year`
  analysis.
- Hardcoded values: `mold_threshold: 1`, `data_gaps: "none detected"`,
  `weather_context: "FMI · Vaasa"`, property/building lines and the report
  id.

## 9. Weather context (`analysis/weather.py`)

There are two separate feeds:

**Sidebar pill (`current()`, Vaasa, display-only).** The current conditions
for the demo home come from Open-Meteo (temperature, RH, wind, WMO weather
code → condition word, today's max precipitation probability) and are cached
for 30 min in the `weather` collection. On failure it falls back to the last
cached document, then to the fans' outdoor transmitters: the mean of each
fan's latest outdoor T/RH, condition `"Overcast"` if RH ≥ 80 else
`"Partly cloudy"`, wind 0.

**Analysis history (`history()`, Vantaa).** Daily weather for the sensor
site, so rain and humidity line up with what the readings saw:
- **Source:** Open-Meteo's archive API, which reaches up to today, so one
  endpoint serves every window.
- **Fields:** precipitation, mean/min/max T, mean RH and max wind.
- **Caching:** in `weather` under `_id: vantaa:<start>:<end>` for 3 h.
  On failure it serves a stale cached document, then `None`.
- **Consumers:** the digest's weather block (§3), the events'
  `outdoor_weather` (§4), the score's weather adjustments (§5) and the
  narrator.

The fans' outdoor transmitters still provide the AH comparison.

## 10. Demo leak simulation

`POST /api/simulate/leak {sensor_id}` (default `roof-nw`) writes a single
`simulation` doc. It auto-expires after 15 min. **Raw readings are never
modified.** While it is active:

- **Analysis**: `simulate.inject` appends a `LEAK_SIMULATED` event for fans
  or `SENSOR_LEAK_SIMULATED` for sensors (30 points, `attention`). The cache
  is bypassed and nothing is written to it.
- **Status**: the target is `watch` for the first 45 s, then `alert`.
- **Score**: glides linearly from the analysis score to 52 over 150 s
  (`max(52, …)`, so if the real score is already below 52 it shows 52).
  `score_trend` is forced to `declining`.
- **Latest RH**: ramps from the real value to 92 % over 240 s. On the `24h`
  chart, the last 24 points bend toward 92 % proportionally.
- **Copy**: headline, summary, recommendations and the feed message for the
  target come from fixed strings in `house.py`. `narrative_source` is
  `"demo"`.

`POST /api/simulate/reset` deletes the doc and all help requests.

## 11. Caching

| Cache | Key | Freshness | Not cached |
| --- | --- | --- | --- |
| `analyses` | `(window, period_key)` | hourly (`day`), daily (`week`/`month`), monthly (`year`) | simulated runs, `no-data` results, `?refresh=true` recomputes |
| `sensor_summaries` | `(sensor_id, range, period_key)` | hourly (`24h`), daily (`7d`/`30d`), monthly (`1y`) | simulated `24h` series |
| `weather` | `_id: vaasa` (pill), `vantaa:<start>:<end>` (history) | 30 min / 3 h | — |

Consumers: `/api/house` and `/api/sensors/{id}` use the `day` analysis, and
`/api/report` uses `year`. `week` and `month` are only reachable through
`/api/analysis?window=`.

## 12. Tuning constants

| Constant | Value | Where |
| --- | --- | --- |
| RH "high" threshold | 85 % | `digest.RH_HIGH_PCT` |
| Mould "elevated" | 0.5 | `digest.MOLD_ELEVATED` (also report risk months) |
| Mould → `attention` severity | 0.8 | `score._score_event` |
| Report "Moisture risk" | 0.6 | `house._report_structures` |
| AH inversion | ≥ 0.5 g/m³ | `digest.AH_INVERSION_DELTA` |
| RH weather discount | AH delta ≤ 0.2, or wet spell and AH delta < 0.5 → ×0.35 | `score._weather_adjust` |
| Dry-weather AH inversion | ×1.5 | `score.DRY_WEATHER_MULTIPLIER` |
| Rainy day | ≥ 1 mm | `weather.RAINY_DAY_MM` |
| Weather `wet` / `dry` | ≥ 50 % rainy days or RH ≥ 90 / ≤ 20 % rainy and RH < 80 | `weather._condition` |
| Run gap break | 12 h | `digest.MAX_GAP` |
| Min RH run | 6 / 24 / 24 / 48 h | `digest.MIN_RUN` |
| Fan stopped | rpm < 100 | `digest._events` |
| Grid outlier | ≥ median + 10 pp | `digest._sensor_grid` |
| Tone cut-offs | 80 / 55 | `score.score_digest` |
| Score-word cut-offs | 75 / 60 | `house.house_state` |
| Trend cut-off | ±1.5 pp | `score.score_trend` |
| Normal band | P20–P80 ± 3 pp | `house._normal_band` |

## 13. What the real dataset looks like

From `data/readings/fans/*.csv` (full history, the same data ingest loads):

| Device | Median indoor RH | Share of readings ≥ 85 % | Median AH in − out | Max mould index | Median rpm |
| --- | --- | --- | --- | --- | --- |
| crawl space (`hallin-alapohja`) | 95.9 % | 74 % | +1.54 g/m³ | 0.83 | 1695 |
| roof section 1 | 76.2 % | 33 % | +0.17 | 0.008 | 1485 |
| roof section 2 | 65.3 % | 11 % | −0.46 | 0.004 | 930 |
| roof section 3 | 75.3 % | 34 % | −0.02 | 0.17 | 1155 |
| roof section 4 | 76.0 % | 33 % | −0.05 | 0.010 | 1215 |
| green roof 1 | 69.2 % | 26 % | −0.60 | 0.006 | 930 |
| green roof 2 | 72.0 % | 19 % | −0.30 | 0.09 | **0** (98 % of samples < 100) |

What this means for the analysis:
- The roof structures track outdoor air (AH delta ≈ 0), so their RH events
  mostly get the weather discount.
- The crawl space is persistently wetter than outdoor air. It is the only
  device that can trigger `MOLD_INDEX_ELEVATED` (26 % of its mould samples
  are ≥ 0.5), and its RH events count at full weight.
- Green roof 2's fan is effectively always stopped, so `FAN_STOPPED` →
  `roof-fan` = `watch` is the normal live state.

## 14. Known gaps and inconsistencies

Open as of the last-verified date. Remove an entry when its fix lands.

1. **Roof quadrants can't go non-`ok` from real data.** The grid only
   produces `SENSOR_OFFLINE` (`info → ok`) and the ref-less `GRID_HUMID`, and
   grid outliers aren't turned into events. Outside the simulation, the four
   `leak_sensor` dots are always green.
2. **`/api/sensors/{id}` status takes the least severe finding.**
   `sensor_detail` assigns `status[sid]` in a loop without the severity rank
   check that `house_state` uses. Findings are sorted most severe first, so
   the *last* (least severe) one wins. A crawl space showing `alert` on
   `/api/house` can show `watch` on its detail page.
3. **Tone and score word use different cut-offs** (80/55 vs 75/60). A score
   of 77 narrates as `watch` ("one area needs watching") under a "Good"
   label. A score of 57 narrates as `watch` under "Attention".
4. **Mould thresholds are on different footings.** The backend uses
   0.5 / 0.6 / 0.8, which fits the observed 0–0.83 range. The UI's mould
   chart and the report use 1 as the risk line, and the score page explains
   VILPE's 0–6 scale with an automatic alert at 2.5. The crawl space can be
   an `attention` finding while sitting below the chart's risk line.
5. **Weather adjustments rarely fire on this dataset.** Roof RH episodes
   are already discounted by the AH check. The crawl space is clearly wetter
   than outdoor air (so it is never excused by rain), and none of its spans
   are `dry`. On 2026-10-04, `day`, `week`, `month` and `year` scored the
   same with and without weather. Today weather mainly adds narration
   context.
6. **Location mismatch.** The analysis (site label and weather history)
   uses Vantaa, where the data comes from. The UI, the sidebar weather pill
   and the report present the demo home as Vaasa.
7. **Stale grid in short windows.** For `day`, the grid stats describe the
   24 h before 2026-09-11, not today. `data_lag_days` reports this, but
   nothing downstream acts on it.
8. **`FAN_STOPPED` can fire on very old data.** It reads the latest rpm
   within a 400-day lookback, not within the window.
9. **Report details.** Roof coverage assumes hourly readings and divides
    by the full fan-history span (from 2025-05). The grid is 12-hourly and
    only covers 2025-09 → 2026-09, so coverage is understated more than
    tenfold. Both slopes share one mould figure. `data_gaps` and
    `weather_context` are not computed (`"FMI · Vaasa"` even though the
    `year` analysis uses Open-Meteo history for Vantaa).
10. **Seasonal normal band** (details in §7):
    - mostly self-referential on this dataset, with no flag saying which
      path was used
    - device-relative, so a saturated crawl space looks "normal"
    - the newest band isn't drawn on `1y` or fan-backed multi-band charts
    - month steps are offset by the window start's time of day
    - recomputed over the full history on every request
11. **Downsampling aliasing** can drop every humidity point from the 30 d
    crawl-space chart (§7).

## Tests

`backend/tests/test_analysis.py` covers:
- the run detector (long episode, short spike, gap split)
- healthy vs mould scoring
- the weather discount (AH-tracking, wet spell, no excuse for a wet
  structure) and the dry-weather AH penalty
- weather summaries, `wet` / `mixed` / `dry` classification, the weather
  block's baseline split and bucket alignment, and the digest with and
  without weather (`tests/conftest.py` stubs the history fetch so the suite
  stays offline)
- fallback wording, including the weather variants
- endpoint and cache behaviour, the `/api/house` and series contracts,
  normal-band shape, the report shape and the simulation flow

Point values, rank discounting, recurrence caps, grid penalties and the
inconsistencies above are untested.
