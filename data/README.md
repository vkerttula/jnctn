# Example data — VILPE Sense demo site

Cleaned export of the VILPE Vantaa demo building ("VILPE Express Store"),
converted from the original Drive zip (`xlsx`/`docx`/`pdf`, Finnish headers)
into JSON + CSV. Regenerate with:

```bash
uv run --with openpyxl --with python-docx \
    python scripts/convert_sense_data.py <source.zip> data
```

All timestamps are naive local time, `Europe/Helsinki`.

## Layout

| File | Contents |
| --- | --- |
| `site.json` | Site metadata: Finnish description, public Sense link, timezone, base station (CCU2) |
| `site-layout.pdf` | Original floor plan showing sensor/fan positions |
| `devices.json` | The 7 VILPE MCU-2 ventilation fans: serial, location (`roof` / `green_roof` / `crawl_space`), paired indoor/outdoor transmitter serials, latest mold index & rpm, public link |
| `sensors.json` | Registry of the 51 environmental sensors: `sensor_id` ↔ `serial_number`, reading count, first/last seen |
| `readings/fans/<device-id>.csv` | Per-fan time series, ~5 800 rows each, 2025-05 → 2026-09 |
| `readings/sensors.csv` | All environmental sensor readings, 37 303 rows, 2025-09 → 2026-09 |

## CSV schemas

`readings/fans/*.csv` — one row per fan control cycle:

```
timestamp, rpm,
indoor_temp_c, indoor_rh_pct, indoor_abs_humidity_g_m3,
outdoor_temp_c, outdoor_rh_pct, outdoor_abs_humidity_g_m3
```

`indoor_*` = the fan's controlling indoor (structure-side) transmitter,
`outdoor_*` = outdoor reference. Empty cells mean the transmitter wasn't
paired/reporting yet. Column order is normalized — the source xlsx files
swap indoor/outdoor order between files.

`readings/sensors.csv` — raw environmental sensors (the Sense leak/ climate
sensors on the roof):

```
timestamp, sensor_id, sensor_serial,
base_station_id, base_station_serial,
temperature_c, relative_humidity_pct, absolute_humidity_g_m3
```

## Notes

- The 51 environmental sensors are distinct devices from the fans' paired
  transmitters — `paired_to` in `sensors.json` links any that overlap (none
  in this export).
- `latest.mold_index` in `devices.json` is the VILPE-computed mold index at
  export time; it is not present as a time series.
- Source quirks handled by the converter: Finnish key/value metadata blocks,
  random filename suffixes, `YYYY/MM/DD` timestamps, inconsistent column
  order, blank spacer rows.
