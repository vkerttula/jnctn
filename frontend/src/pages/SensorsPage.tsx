import { Link } from 'react-router-dom'
import type { HouseSensor } from '../api'
import { useHouse } from '../hooks/useHouse'
import { KIND_LABEL, ZONE_LABEL, keyValues } from '../labels'
import { STATUS_COLOR } from '../theme'

export default function SensorsPage() {
  const { state } = useHouse()
  const sensors = state?.sensors ?? []
  const groups = [...new Set(sensors.map((s) => ZONE_LABEL[s.zone]))]

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <h1 className="font-display text-xl font-bold text-navy">Sensors</h1>
        {!state && <p className="text-sm text-muted">Loading sensors…</p>}
        {groups.map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
              {group}
            </h2>
            <div className="flex flex-col gap-1.5">
              {sensors
                .filter((s) => ZONE_LABEL[s.zone] === group)
                .map((s: HouseSensor) => (
                  <Link
                    key={s.id}
                    to={`/sensors/${s.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 transition-colors hover:border-sense/40 hover:bg-sense/5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: STATUS_COLOR[s.status] }}
                    />
                    <span className="flex flex-1 flex-col">
                      <span className="text-sm font-medium text-navy">{s.name}</span>
                      <span className="text-xs text-muted">{KIND_LABEL[s.kind]}</span>
                    </span>
                    <span className="text-xs text-muted tabular-nums">
                      {keyValues(s.latest).join(' · ')}
                    </span>
                    <span className="text-muted">→</span>
                  </Link>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
