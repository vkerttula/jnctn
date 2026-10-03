import type { ReactNode } from 'react'

// Compact weather glyph for the home overlay. Stroke style matches the
// ServicesList icons; the tint hints at the condition — amber sun, blue
// precipitation, neutral cloud/fog.

const CLOUD = 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2'

function variant(condition: string): { body: ReactNode; tint: string } {
  const c = condition.toLowerCase()
  if (c.includes('thunder'))
    return {
      tint: 'text-watch',
      body: (
        <>
          <path d={CLOUD} />
          <path d="M13 11l-4 6h6l-4 6" />
        </>
      ),
    }
  if (c.includes('snow') || c.includes('freezing'))
    return {
      tint: 'text-sense',
      body: (
        <>
          <path d={CLOUD} />
          <path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01" />
        </>
      ),
    }
  if (c.includes('drizzle'))
    return {
      tint: 'text-sense',
      body: (
        <>
          <path d={CLOUD} />
          <path d="M8 15v2M8 20v1M16 15v2M16 20v1M12 17v2M12 21v1" />
        </>
      ),
    }
  if (c.includes('rain') || c.includes('shower'))
    return {
      tint: 'text-sense',
      body: (
        <>
          <path d={CLOUD} />
          <path d="M8 15v6M12 16v6M16 15v6" />
        </>
      ),
    }
  if (c.includes('fog'))
    return {
      tint: 'text-navy/50',
      body: (
        <>
          <path d="M17.5 12a4.5 4.5 0 0 0-.42-8.98A7 7 0 1 0 6 12" />
          <path d="M4 15h16M6 18h12M8 21h8" />
        </>
      ),
    }
  if (c.includes('overcast') || c.includes('cloud'))
    return {
      tint: 'text-navy/50',
      body: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />,
    }
  if (c.includes('partly') || c.includes('mostly'))
    return {
      tint: 'text-watch',
      body: (
        <>
          <path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.95 12.65a4 4 0 0 0-5.93-4.13M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
        </>
      ),
    }
  // clear, plus anything unrecognised
  return {
    tint: 'text-watch',
    body: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </>
    ),
  }
}

export default function WeatherIcon({
  condition,
  className = 'h-8 w-8',
}: {
  condition: string
  className?: string
}) {
  const { body, tint } = variant(condition)
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} ${tint}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {body}
    </svg>
  )
}
