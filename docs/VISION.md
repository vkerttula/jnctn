# Vision

**"Oura for a house."**

VILPE measures — Sense sensors produce humidity and temperature data inside
and outside building structures, leak detectors, controlled ventilation.
But VILPE only *measures*. **jnctn is the interpretation layer**: this
backend is where the raw numbers become meaning.

## The problem

Sensor data is hard to understand. Homeowners today can't read humidity
charts — support has to explain what the numbers mean. And raw values are
dangerous: a suddenly spiking humidity reading or a rapidly changing number
will scare an owner who has no context for it.

## The product

Like an Oura ring, the app condenses the house's condition into things a
person understands:

- **One score + short plain-language summary** — generated from the
  location's weather context, the sensors' time series and the season. Slow,
  smoothed, interpreted — never a raw live gauge.
- **Attention items & recommendations** — "your structures are drying
  normally for October; keep an eye on the north slope" — not
  "RH 78.4% +2.1pp".
- **The house is an interface, not the only one** — a rotatable 3D model
  (Tesla-style) with clickable sensor hotspots anchors the experience, but
  side panels, alert feeds and per-sensor detail pages carry the
  information.

## Business model

**Monthly subscription for homeowners** — the company goal this product
serves.

Why they pay: **certainty, not savings.** The home is the owner's biggest
asset; moisture damage is hidden and largely uninsured. The product sells
peace of mind — "something is watching your house 24/7 and tells you, in
words you understand, the moment things start trending wrong." Like Oura:
you don't pay for data, you pay to know you're fine and to hear first when
you're not.

Why VILPE can ship it: the pilot costs almost nothing — existing Sense
customers already produce every data point needed. The only missing piece
is this UI. An opt-in consumer view for current Sense customers is a
real-world test VILPE could run next week.

**Future development** (pitch ammo, not this build):

- **Inspection marketplace** — when values trend wrong, the owner books a
  structural inspection from local contractors straight in the app. VILPE
  takes a cut; a one-tap path from "alert" to "fixed".
- **Remote expert review** — send sensor data to a VILPE / third-party
  expert for assessment without a site visit.
- **Structural moisture report (PDF)** — sellable document from sensor
  history, e.g. for house sales: a certified "structures healthy for N
  years" report adds transaction value.
- **Aggregated data products** — an admin map view (zoom to street level,
  see every sensored house's condition) unlocks derived insights, e.g. how
  climate affects buildings in an area — valuable to insurers, especially
  the US market.

## Demo scope (deadline: Sun 12:00)

- Web only — mobile is wanted later, no cross-platform work this weekend
- Simulated Sense data (~30 days history + live tick), real FMI weather for
  Vaasa as the location context
- Score + AI-style summaries + 3D home view + sensor detail pages +
  "Simulate leak" demo moment

## What a successful demo looks like

A judge rotates the house, clicks a pulsing sensor, and reads one calm
sentence telling them what's happening and why it matters — zero
explanation from us, zero scary numbers on screen.
