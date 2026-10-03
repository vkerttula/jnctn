import { useState } from 'react'
import type { FormEvent } from 'react'
import { findByEmail, signIn, USERS } from '../auth'
import type { User } from '../auth'
import Spinner from '../components/Spinner'

// Brand-styled login: navy panel with the VILPE lockup on the left, a sign-in
// card on the right. Two preset demo accounts fill/skip the form — any
// password is accepted for a known email in this demo build.
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<User | null>(null)

  // Brief fake loading beat before the reload — makes the demo read like a
  // real session starting instead of an instant page swap.
  const begin = (user: User) => {
    setPending(user)
    window.setTimeout(() => signIn(user.id), 1400)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const user = findByEmail(email)
    if (!user) {
      setError('Unknown email — try one of the demo accounts below.')
      return
    }
    begin(user)
  }

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <div className="flex flex-col gap-10 bg-navy px-8 py-10 text-white lg:w-[46%] lg:justify-between lg:px-14 lg:py-14">
        <div className="flex items-center gap-3">
          <img src="/vilpe-logo.png" alt="VILPE" className="h-8 w-auto" />
          <span className="h-9 w-px bg-white/25" aria-hidden />
          <span className="font-display text-sm leading-tight font-semibold tracking-wide text-white/80">
            Peace of mind
            <br />
            for your home
          </span>
        </div>
        <div>
          <h1 className="font-display text-3xl font-semibold lg:text-4xl">
            Your home, at a glance.
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60">
            VILPE Sense watches the structures you can't see — roof, crawl
            space and ventilation — and tells you the moment something needs
            attention.
          </p>
        </div>
        <p className="hidden text-xs text-white/40 lg:block">
          VILPE Sense · demo build
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl shadow-navy/10">
          {pending ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <Spinner />
              <div>
                <p className="font-display text-base font-semibold">
                  Signing you in…
                </p>
                <p className="mt-1 text-xs text-muted">
                  {pending.name} · {pending.home}
                </p>
              </div>
            </div>
          ) : (
            <>
          <h2 className="font-display text-xl font-semibold">Sign in</h2>
          <p className="mt-1 text-xs text-muted">
            Demo build — any password works for a known email.
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="username"
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-navy/40"
            />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-navy/40"
            />
            {error && <p className="text-xs font-medium text-alert">{error}</p>}
            <button
              type="submit"
              className="mt-1 w-full rounded-xl bg-navy py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sense"
            >
              Sign in
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-[10px] font-semibold tracking-widest text-muted uppercase">
            <span className="h-px flex-1 bg-line" aria-hidden />
            Demo accounts
            <span className="h-px flex-1 bg-line" aria-hidden />
          </div>

          <div className="flex flex-col gap-2">
            {USERS.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => begin(u)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left transition-colors hover:border-navy/30 hover:bg-mist"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
                  {u.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {u.name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {u.email}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                    u.dataMode === 'live'
                      ? 'bg-sense/10 text-sense'
                      : 'bg-watch/20 text-navy'
                  }`}
                >
                  {u.dataMode === 'live' ? 'live data' : 'demo data'}
                </span>
              </button>
            ))}
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
