import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { api, type HelpKind } from '../api'

// Sidebar "Services": what VILPE can do for the homeowner beyond watching —
// the report, remote expert review and the inspection marketplace.

const ROW =
  'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors'

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/85">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </span>
  )
}

function Text({ title, sub }: { title: string; sub: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-sm font-semibold text-white">{title}</span>
      <span className="truncate text-xs text-white/50">{sub}</span>
    </span>
  )
}

const REQUESTS: Record<HelpKind, { title: string; sub: string; confirm: string; send: string; icon: ReactNode }> = {
  expert: {
    title: 'Ask a VILPE expert',
    sub: 'Have your readings reviewed remotely',
    confirm: 'Send your latest readings to a VILPE expert for review?',
    send: 'Send readings',
    icon: (
      <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z" />
    ),
  },
  inspection: {
    title: 'Book an inspection',
    sub: 'Certified local inspectors',
    confirm: 'Ask a certified local inspector to contact you?',
    send: 'Request a call',
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" />
      </>
    ),
  },
}

function RequestItem({ kind }: { kind: HelpKind }) {
  const r = REQUESTS[kind]
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending'>('idle')
  const [sent, setSent] = useState<string | null>(null)

  const send = async () => {
    setStep('sending')
    try {
      setSent((await api.requestHelp(kind)).message)
    } finally {
      setStep('idle')
    }
  }

  return (
    <div className={`rounded-2xl ${step !== 'idle' || sent ? 'bg-white/5' : ''}`}>
      <button
        onClick={() => !sent && setStep(step === 'idle' ? 'confirm' : 'idle')}
        className={`${ROW} ${sent ? 'cursor-default' : 'hover:bg-white/5'}`}
      >
        <Icon>{r.icon}</Icon>
        <Text title={r.title} sub={r.sub} />
      </button>
      {step !== 'idle' && (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <p className="text-xs leading-relaxed text-white/75">{r.confirm}</p>
          <div className="flex gap-2">
            <button
              onClick={send}
              disabled={step === 'sending'}
              className="rounded-full bg-vilpe-orange px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-vilpe-orange/90 disabled:opacity-50"
            >
              {r.send}
            </button>
            <button
              onClick={() => setStep('idle')}
              className="rounded-full px-3 py-1.5 text-xs text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {sent && (
        <p className="flex items-start gap-2 px-3 pb-3 text-xs leading-relaxed text-white/80">
          <span className="text-ok">✓</span>
          {sent}
        </p>
      )}
    </div>
  )
}

export default function ServicesList() {
  return (
    <section className="flex flex-col gap-1 border-t border-white/10 pt-4">
      <h2 className="mb-1 font-display text-xs font-semibold tracking-[0.25em] text-white/50 uppercase">
        Services
      </h2>
      <NavLink
        to="/report"
        className={({ isActive }) => `${ROW} ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}
      >
        <Icon>
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M14 3v5h5M10 13h6M10 17h6" />
        </Icon>
        <Text title="Moisture History Report" sub="5-year record of your home" />
      </NavLink>
      <RequestItem kind="expert" />
      <RequestItem kind="inspection" />
    </section>
  )
}
