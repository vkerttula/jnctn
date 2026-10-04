# LLM narration — how Gemini turns findings into words

**Status:** living reference (describes the code on `main`; update it with
`backend/app/analysis/`) · **Last verified:** 2026-10-04 · **Owners:** backend

How jnctn uses an LLM to explain the house's condition in plain language, and
what happens when it can't. Read `deterministic-analysis.md` first.
Everything the model sees is produced there.

## Role of the LLM

**The model writes words. It doesn't decide anything.**

| Decided by code (never the LLM) | Written by the LLM |
| --- | --- |
| The 0–100 score, tone (`all_good` / `watch` / `attention`), score trend | `headline` — one verdict line |
| Which findings exist, their severity, location, `since` | `summary` — one sentence |
| Sensor statuses, area statuses, feed ordering and actions | `attention_items[]` — titled explanations of findings |
| Chart data, normal bands, report aggregates | `recommendations[]` — next steps |
| | per-sensor chart `summary` |

This split exists for three reasons:

1. **Stability and honesty.** The number can't drift with sampling
   temperature or prompt phrasing.
2. **Guaranteed availability.** A template renderer (`fallback.py`) produces
   the same output shape from the same inputs, so every endpoint works with
   no key, no network or no quota.
3. **Tone control.** The model is told the tone instead of choosing it, so it
   can't panic the homeowner or falsely reassure them.

Code: `backend/app/analysis/llm.py` (prompts and calls), `models.py` (output
schemas), `fallback.py` (templates), `service.py` (house orchestration and
cache), `sensor_summary.py` (per-sensor orchestration and cache).

## Model and client

- SDK: `google-genai==2.25.0`. `genai.Client()` reads `GEMINI_API_KEY` (or
  `GOOGLE_API_KEY`) from the environment. `backend/.env` is loaded by
  `python-dotenv` in `app/main.py`.
- Model: `GEMINI_MODEL`, default `gemini-3-flash-preview`.
- `llm.available()` is true only when one of the two keys is set. Without a
  key the code never imports the SDK path.
- Settings for both calls: `temperature = 0.4` (lightly varied wording, but
  repeatable in substance), `response_mime_type = "application/json"`,
  `response_schema = <pydantic model>`. Gemini's controlled generation
  returns JSON shaped to the schema.

## Call 1 — house narrative (`llm.narrate`)

Called by `service.get_analysis(window)` after `digest → events → score`.

### Input context (user message)

The user message is the text `"Here is the current house condition as
structured data:\n"` followed by `json.dumps` of:

| Key | Content | Source |
| --- | --- | --- |
| `audience_window` | e.g. `"today (last 24 hours, compared with the previous week)"` | `WINDOW_NAMES` |
| `required_tone` | `all_good` / `watch` / `attention` | `score_digest` |
| `score_out_of_100` | integer | `score_digest` |
| `season` | e.g. `"autumn (October)"` | digest |
| `site` | `{name, location: "Vantaa, Finland"}` | digest |
| `outdoor_weather` | the digest's weather block: Vantaa daily history summarised over the span, the baseline and per bucket, with a `wet` / `mixed` / `dry` `condition`; `null` if unavailable | digest |
| `findings` | scored findings: code, severity, location, ref, detail, occurrences, since | `score_digest` |
| `events` | every detected event incl. duplicates and simulated ones | digest |
| `devices` | per fan: label, online/alert flags, `latest` values, span + baseline stats, buckets, trend deltas | digest |
| `sensor_grid` | grid count, offline list, `as_of`, `data_lag_days`, median / share ≥ 80 / ≥ 90, outliers | digest |
| `previous_summary_for_continuity` | the most recent cached summary from a *different* period of the same window (only if one exists) | `analyses` |

No raw time series go in. The packet's size depends on device count × bucket
count (none / 7 daily / ~5 weekly / 12 monthly), not on how much history
exists. The LLM only sees the catalog's sources (`app/catalog.py`), labelled
with the UI's words: "the roof" (`katto-3`), "the crawl space" and the four
roof sensors ("the north-west roof"). It never hears about a device the UI
doesn't show. It is not given the sidebar's current Vaasa weather or the
house address.

Some context is **only** available to the narrator, because scoring ignores
it: grid `outliers`, `pct_sensors_mean_rh_ge_80`, `trend.mold_delta`,
`trend.ah_delta_delta`, and per-bucket stats. The model may mention a
wetter-than-neighbours sensor or a rising trend that has no corresponding
finding.

### System prompt (`llm.SYSTEM`), rule by rule

1. **Persona.** The voice of an "Oura for a house" product, speaking to
   homeowners who can't read charts.
2. **Tone is given, not chosen.**
   - `all_good` = brief reassurance
   - `watch` = calm "we're keeping an eye on it"
   - `attention` = clear but calm advice
   - never panic, never falsely reassure
3. **Observe, never diagnose.** Never state or imply mould, a leak or damage.
   Describe only what the sensors show, and hedge ("could allow mould", "may
   need a look"). Under `attention`, refer the homeowner to a qualified
   professional: *"we measure, they diagnose."*
4. **Plain language.** No units, decimals, ppm, percentages or jargon. Never
   write `mold_index`. At most one concrete number per sentence, and only
   when it helps ("for about two weeks").
5. **Locations by label** ("the crawl space", "the roof").
6. **Seasonal awareness.** Autumn wetting is expected. What matters is
   whether the structure keeps up with drying when it can.
7. **Weather as context.**
   - `outdoor_weather` goes in plain words ("after a rainy week", "despite
     the dry spell"), never as amounts.
   - Findings with `detail.weather_driven` get calm framing.
   - Findings with `detail.dry_weather` (still damp when it could have
     dried) matter more.
   - Don't blame the weather for anything else, and stay silent on weather
     when it's missing.
8. **Output limits:**
   - `headline`: a short verdict line, never a diagnosis
   - `summary`: one sentence under ~110 characters
   - `attention_items`: ≤ 3, real findings only
   - `recommendations`: ≤ 2 — watch it, or have a professional check it
     under `attention`
   - under `all_good`, both lists may be empty or hold one light reassurance

### Output schema (`models.Narrative`)

```python
Narrative:
  headline: str            # max 120
  summary: str             # max 120
  attention_items: list[AttentionItem]   # max 5
  recommendations: list[str]             # max 5

AttentionItem:
  title: str               # max 120
  detail: str              # max 500
  location: str | None     # max 120
```

The pydantic limits are looser than the prompt (5 vs 3 items, 5 vs 2
recommendations). The prompt shapes the style, and the schema rejects output
that is badly broken. The response is parsed with
`Narrative.model_validate_json(resp.text)`.

### Retry and failure

`narrate` makes **at most 2 attempts**. Any exception counts as a failure:
network error, quota/429, malformed JSON, or a schema violation such as a
summary over 120 characters. After two failures it raises, and `service.py`
logs the error and renders the template fallback instead. The retry doesn't
look at the error type, so a quota error is retried immediately.

## Call 2 — per-sensor chart summary (`llm.narrate_sensor`)

Called by `sensor_summary.get_summary` from `/api/sensors/{id}/series`. It
writes the line above each trend chart (labelled "AI insight" in the UI when
the source is `llm`).

### Input context

The user message is the bare `json.dumps` of:

```
sensor      logical name, e.g. "Crawl space"
kind        leak_sensor | fan | climate_sensor
zone        roof_south | roof_north | ridge | crawl_space
range       "the last 24 hours" | "the past week" | "the past month" | "the past year"
month       month name of the last point
normal_band the same {label, rh_pct, bands?} object the chart draws
stats       computed from the chart's own (downsampled) buckets:
  bucket_count
  rh_pct:     first, last, delta (last−first), min, mean, max, share_ge_90
  temp_c:     mean, min, max
  mold_index: last, max
  fan_rpm:    mean, last, stopped_share (share of buckets whose mean rpm is 0)
```

The stats come from exactly the points the chart renders, so the sentence
matches what the homeowner sees. That includes the simulated leak ramp,
because narration runs after the ramp is applied.

### System prompt (`llm.SENSOR_SYSTEM`)

- Write one sentence (two short ones at most) for display above the chart.
- Describe the trend, not the numbers ("crept up over the week", "stayed in
  its normal range", "the fan ran steadily"). No units, decimals or jargon.
  At most one number.
- Calm and factual. Say what happened and whether it matters. Don't start
  with the sensor's name.
- Never diagnose. If the readings look concerning, at most suggest a
  professional could assess it.
- If readings are sparse or missing for part of the range, say so plainly.

### Output schema and failure

`SensorSummary { summary: str (max 300) }`, with the same 2-attempt retry,
then fallback to the template.

## The template fallback (`fallback.py`)

The fallback produces the same schema with no model. It is used when there
is no key, when the LLM call fails, and for every simulated (demo) request.

**House narrative (`render`)**, keyed on tone:

| Tone | Headline | Summary | Recommendation |
| --- | --- | --- | --- |
| `all_good` | "Your home is in good shape" | "No worries — everything is looking good." | "Nothing needed right now. We'll keep watching." |
| `attention` | "<Top location> needs attention" | "<Top location> needs attention — moisture levels there have been elevated for a while." | "Have a professional inspect the area if readings don't improve." |
| `watch` | "One area needs watching" | "Humidity is a bit up in <top location> — this may be normal fluctuation…" | "No action needed — check back in a few days." |

**Attention items (`describe_finding`)**: there is one title template and one
detail template per finding code, e.g. `MOLD_INDEX_ELEVATED` → "Moisture in
{loc} could allow mold". It appends "This has come up N times in this period"
when `occurrences > 1`. Two findings have weather variants:
- an RH finding with `weather_driven` says the humidity moved "in step with
  the damp weather outside"
- an AH inversion with `dry_weather` adds "despite dry weather"

The fallback includes up to 5 items, while the LLM
prompt allows 3. The `watch` summary always says "Humidity is a bit up" even
when the top finding is a stopped fan.

**Sensor line (`describe_sensor`)**, at most two sentences, in rule order:
- RH:
  - share ≥ 90 % in at least half the buckets → "stayed high… holding
    moisture"
  - delta ≥ +5 → "climbing"
  - delta ≤ −5 → "drying down"
  - otherwise → "near its normal range"
- Mould max ≥ 0.5 → "could have allowed mold at some point".
- Fan:
  - stopped in ≥ 50 % of buckets → "stopped for most of…"
  - stopped in some buckets → "stopped for part of…"
  - otherwise → "ran steadily"
- Nothing applies → "Only sparse readings came through…"

The fallback ignores temperature and the normal band. Only the LLM sees
those as context.

## Orchestration and source labels

`service.get_analysis(window)` picks the narrator in this order:

```
cached (window, period_key), not refresh, no sim, not no-data  → return cached
no devices and empty grid                                      → placeholder, source "no-data"
simulation active                                              → fallback.render, source "demo"
llm.available()                                                → llm.narrate, source "llm"
  └─ exception                                                 → fallback.render, source "fallback"
otherwise                                                      → fallback.render, source "fallback"
```

`sensor_summary.get_summary` follows the same ladder: no points → `no-data`
(summary `null`); simulated 24 h series → `demo`; then `llm`, then
`fallback`.

The source is surfaced end to end:
- `/api/analysis` → `source`
- `/api/house` → `narrative_source`
- series → `summary_source`

The frontend shows the small **"AI insight"** tag only when the source is
`llm` (`HomePage.tsx`, `SensorDetailPage.tsx`). Mock mode (`VITE_API_MODE=mock`)
never calls the backend. Its copy is pre-written in
`scripts/gen_mock_data.py` and labelled `fallback`.

### Where the LLM text ends up

| Output | `day` analysis → | `year` analysis → |
| --- | --- | --- |
| `headline`, `summary` | `/api/house` (home page, sidebar) | `/api/report` |
| `recommendations` | `/api/house` | `/api/report` |
| `attention_items` | `/api/house` feed messages (matched, see below) | stored, served raw by `/api/analysis` |

**Feed matching.** The feed is built from deterministic findings. Each
finding looks for a narrative attention item whose `location`, lowercased and
trimmed, equals the finding's `location` label. Each item is used once. A hit
renders as `"<title> — <detail>"`. A miss uses the template text. Matching
only works when the model echoes the label verbatim ("the crawl space"). A
paraphrase like "your crawl space" silently falls back to template copy for
that finding. Narrative items with no matching finding (e.g. an outlier the
model chose to mention) are not shown in the feed.

**Demo overrides.** While a leak simulation is active, `/api/house` replaces
headline, summary, recommendations and the target's feed message with fixed
strings in `routers/house.py`. No model is involved, and the copy is
identical every run on camera.

## Caching and quota

The Gemini free tier on `gemini-3-flash-preview` allows roughly 20 requests a
day. The caches exist to stay within that.

| What | Cache key | One LLM call per |
| --- | --- | --- |
| House `day` | `(day, YYYY-MM-DDTHH)` | hour in which `/api/house` or `/api/sensors/{id}` is hit |
| House `week` / `month` | `(window, YYYY-MM-DD)` | day (only via `/api/analysis`) |
| House `year` | `(year, YYYY-MM)` | month in which `/api/report` is hit |
| Sensor `24h` | `(sensor, 24h, hour)` | sensor × hour viewed |
| Sensor `7d` / `30d` | `(sensor, range, day)` | sensor × range × day viewed |
| Sensor `1y` | `(sensor, 1y, month)` | sensor × month viewed |

Calls are lazy: they only happen when a page needs a key that isn't cached
yet. The upper bound is still well above 20 a day. For example, the `day`
analysis alone can regenerate 24 times a day, and the score page loads the
`1y` series of every mould-reporting sensor. Each failed call may use two
attempts.

**A fallback result is cached like an LLM result.** Once a call fails (for
example on quota), that `(window, period)` serves template copy until the
period rolls over. For `day` that's at most an hour, for `year` the rest of
the month. `?refresh=true` on `/api/analysis` bypasses the cache and always
calls the model.

Simulated requests never call the LLM. The UI polls every 15 s during the
demo, so per-poll calls would cost latency and quota.

**Continuity.** `previous_summary_for_continuity` gives the model the last
period's summary, so consecutive hours read as one voice instead of a fresh
reinterpretation each time.

## Guardrails: enforced vs. requested

| Guardrail | How it holds |
| --- | --- |
| Score / tone / findings can't be changed by the model | **Enforced**: computed before the call, and the model's output has no fields for them |
| Output shape and length limits | **Enforced**: JSON schema plus pydantic validation, with retry, then fallback |
| Always some answer | **Enforced**: template fallback on any failure |
| No diagnosis (no "you have mould / a leak") | Prompt only, no post-check |
| No numbers, units, percentages | Prompt only, no post-check |
| ≤ 3 attention items / ≤ 2 recommendations | Prompt only (schema allows 5 / 5) |
| Items refer to real findings only | Prompt only; the feed only shows location-matched items, which acts as a partial filter |
| Locations named by label | Prompt only; feed matching depends on it |

## Known gaps

1. **No tests cover the LLM path.** The suite checks `llm.available()` and
   the fallback only. There is no mocked `narrate` test, and nothing evaluates
   the prompt rules (no numbers, no diagnosis, length) against real outputs.
2. **No output post-validation** beyond lengths. A regex pass for digits, `%`
   and words like "mould" / "leak" (when not simulated) would turn the
   prompt-only rules into enforced ones.
3. **The fallback gets cached.** A quota failure is cached for the whole
   period, and the retry doesn't skip quota errors, so it burns a second
   attempt.
4. **The location label is a fragile join key** between narrative and
   findings. Asking the model to echo a finding `ref`/`code` per item would
   make the match exact.
5. **Context mismatches.**
   - The model is told the site is "Vantaa, Finland" and gets Vantaa
     weather (where the data comes from), while the UI and its weather pill
     say Vaasa. A "rainy week" in the narrative may not match the pill.
   - The per-sensor narrator (`narrate_sensor`) gets no weather.
6. **Prompt vs. schema drift.** Item and recommendation limits differ, and
   the summary limit (prompt ~110, schema 120) leaves little margin, so
   overruns turn into retries.
7. **`normal_band` is an unqualified "normal".** The sensor narrator gets
   the band with no indication of whether it is a prior-year climatology or
   the span's own readings (on this dataset it is usually the latter, and
   always for roof quadrants). It also doesn't know that "normal" is
   device-relative: the crawl space's summer band is 95–100 % RH. Being
   "within the normal band" can therefore be self-fulfilling, or can
   describe a saturated structure. See `deterministic-analysis.md` §7.
8. **Stale grid in the prompt.** For short windows the grid stats are about
   three weeks old (the CSV snapshot). `data_lag_days` is in the context, but
   the prompt never tells the model what to do with it.
