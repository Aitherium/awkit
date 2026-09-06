import { useState } from 'react'

interface Recommendation {
  name: string
  [key: string]: unknown
}

interface Props {
  query: string
  recommendations: Recommendation[]
  category: string
  onSelect: (chosen: Recommendation, reasoning: string) => void
}

export default function SelectionCard({ query, recommendations, category, onSelect }: Props) {
  const [reasoning, setReasoning] = useState('')
  const [selected, setSelected] = useState<number | null>(null)

  const submit = (idx: number) => {
    setSelected(idx)
    onSelect(recommendations[idx], reasoning)
  }

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--accent-primary)',
      borderRadius: 'var(--radius)',
      padding: '1rem',
      marginTop: '0.75rem',
    }}>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
        Select your choice for: <strong>{query}</strong>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {recommendations.map((rec, i) => (
          <button
            key={i}
            onClick={() => submit(i)}
            disabled={selected !== null}
            style={{
              padding: '0.5rem 0.75rem',
              background: selected === i ? 'var(--accent-primary)' : 'var(--bg-surface)',
              color: selected === i ? 'var(--bg-deep)' : 'var(--text-primary)',
              borderRadius: 6,
              fontSize: '0.85rem',
              textAlign: 'left',
              border: '1px solid var(--glass-border)',
              opacity: selected !== null && selected !== i ? 0.5 : 1,
            }}
          >
            {rec.name}
          </button>
        ))}
      </div>

      {selected === null && (
        <input
          value={reasoning}
          onChange={e => setReasoning(e.target.value)}
          placeholder="Why this choice? (optional)"
          style={{
            width: '100%',
            marginTop: '0.5rem',
            padding: '0.4rem 0.6rem',
            background: 'var(--bg-surface)',
            border: '1px solid var(--glass-border)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontSize: '0.8rem',
          }}
        />
      )}

      {selected !== null && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--accent-green)' }}>
          Selection recorded for learning.
        </p>
      )}
    </div>
  )
}
