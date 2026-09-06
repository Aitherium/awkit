interface Source {
  filename: string
  score: number
}

interface Props {
  sources: (string | Source)[]
}

export default function SourceCitations({ sources }: Props) {
  if (!sources || sources.length === 0) return null

  const normalized: Source[] = sources.map(s =>
    typeof s === 'string' ? { filename: s, score: 0 } : s
  )

  const deduped = Object.values(
    normalized.reduce((acc, s) => {
      if (!acc[s.filename] || acc[s.filename].score < s.score) acc[s.filename] = s
      return acc
    }, {} as Record<string, Source>)
  ).sort((a, b) => b.score - a.score)

  return (
    <div style={{ marginTop: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
      {deduped.map((s, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          padding: '0.15rem 0.5rem', background: 'var(--bg-elevated)',
          borderRadius: 4, fontSize: '0.7rem', color: 'var(--text-secondary)',
        }}>
          <span style={{ opacity: 0.6 }}>&#128196;</span>
          {s.filename}
          {s.score > 0 && (
            <span style={{ color: 'var(--accent-cyan)', fontSize: '0.65rem' }}>
              {(s.score * 100).toFixed(0)}%
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
