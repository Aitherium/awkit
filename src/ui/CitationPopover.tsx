import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Citation {
  source_num: number
  source_name: string
  excerpt: string
  score: number
}

interface Props {
  citations: Citation[]
}

interface PopoverState {
  sourceNum: number
  anchorRect: DOMRect
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relevanceClass(score: number): string {
  if (score >= 0.7) return 'confidence-high'
  if (score >= 0.5) return 'confidence-mid'
  return 'confidence-low'
}

function relevanceFillColor(score: number): string {
  if (score >= 0.7) return 'var(--accent-green)'
  if (score >= 0.5) return 'oklch(0.85 0.12 85)'
  return 'var(--accent-coral)'
}

/* ------------------------------------------------------------------ */
/*  Single citation badge (reused by both the row and inline render)   */
/* ------------------------------------------------------------------ */

function CitationBadge({
  citation,
  isActive,
  onClick,
  inline,
}: {
  citation: Citation
  isActive: boolean
  onClick: (e: React.MouseEvent<HTMLSpanElement>) => void
  inline?: boolean
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Source ${citation.source_num}: ${citation.source_name}`}
      className={`badge badge-info ${isActive ? 'citation-badge-active' : 'citation-badge'}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent<HTMLSpanElement>)
        }
      }}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        fontWeight: 700,
        fontSize: inline ? '0.58rem' : '0.68rem',
        padding: inline ? '0.05rem 0.3rem' : '0.1rem 0.4rem',
        borderRadius: 4,
        lineHeight: 1,
        transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
        ...(inline ? {
          verticalAlign: 'super',
          position: 'relative' as const,
          top: '-0.15em',
          marginLeft: '0.1rem',
          marginRight: '0.05rem',
        } : {}),
        ...(isActive ? {
          background: 'var(--accent-primary)',
          color: 'var(--bg-deep)',
          boxShadow: '0 0 0 2px oklch(0.72 0.14 290 / 0.25)',
        } : {}),
      }}
    >
      {citation.source_num}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Popover content                                                    */
/* ------------------------------------------------------------------ */

function PopoverContent({ citation }: { citation: Citation }) {
  const pct = Math.round(citation.score * 100)

  return (
    <div style={{ padding: '0.85rem', minWidth: 260, maxWidth: 320 }}>
      <div style={{
        fontSize: '0.85rem',
        fontWeight: 600,
        color: 'var(--text-primary)',
        lineHeight: 1.3,
        marginBottom: '0.6rem',
      }}>
        {citation.source_name}
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '0.6rem',
      }}>
        <span style={{
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          fontWeight: 500,
          flexShrink: 0,
          width: 56,
        }}>
          Relevance
        </span>
        <div className="progress-bar" style={{ flex: 1 }}>
          <div
            className="progress-bar-fill"
            style={{
              width: `${pct}%`,
              background: relevanceFillColor(citation.score),
            }}
          />
        </div>
        <span
          className={relevanceClass(citation.score)}
          style={{ fontSize: '0.72rem', fontWeight: 600, flexShrink: 0, width: 28, textAlign: 'right' }}
        >
          {pct}%
        </span>
      </div>

      <p style={{
        fontSize: '0.78rem',
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
        margin: 0,
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        wordBreak: 'break-word',
      }}>
        {citation.excerpt}
      </p>

      <div style={{
        marginTop: '0.6rem',
        paddingTop: '0.5rem',
        borderTop: '1px solid var(--glass-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          Source {citation.source_num}
        </span>
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          style={{
            fontSize: '0.7rem',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.2rem',
          }}
        >
          View source
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M3 7l4-4M7 3v4M7 3H3" />
          </svg>
        </a>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Popover positioning logic                                          */
/* ------------------------------------------------------------------ */

function usePopoverPosition(
  anchorRect: DOMRect | null,
  popoverRef: React.RefObject<HTMLDivElement | null>,
) {
  const [style, setStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!anchorRect || !popoverRef.current) return

    const popRect = popoverRef.current.getBoundingClientRect()
    const viewW = window.innerWidth
    const pad = 12

    let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2
    const top = anchorRect.bottom + 8

    if (left < pad) left = pad
    if (left + popRect.width > viewW - pad) left = viewW - pad - popRect.width

    const arrowLeft = Math.max(
      16,
      Math.min(
        anchorRect.left + anchorRect.width / 2 - left,
        popRect.width - 16,
      ),
    )

    setStyle({
      position: 'fixed',
      left,
      top,
      '--arrow-left': `${arrowLeft}px`,
    } as React.CSSProperties)
  }, [anchorRect, popoverRef])

  return style
}

/* ------------------------------------------------------------------ */
/*  Main component: horizontal citation badges with popover            */
/* ------------------------------------------------------------------ */

export default function CitationPopover({ citations }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      popoverRef.current &&
      !popoverRef.current.contains(e.target as Node) &&
      !(e.target as HTMLElement).closest('[data-citation-badge]')
    ) {
      setPopover(null)
    }
  }, [])

  useEffect(() => {
    if (popover) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [popover, handleClickOutside])

  useEffect(() => {
    if (!popover) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [popover])

  const positionStyle = usePopoverPosition(
    popover?.anchorRect ?? null,
    popoverRef,
  )

  if (!citations || citations.length === 0) return null

  const activeCitation = popover
    ? citations.find(c => c.source_num === popover.sourceNum)
    : null

  const togglePopover = (citation: Citation, el: HTMLElement) => {
    if (popover?.sourceNum === citation.source_num) {
      setPopover(null)
      return
    }
    setPopover({
      sourceNum: citation.source_num,
      anchorRect: el.getBoundingClientRect(),
    })
  }

  return (
    <>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexWrap: 'wrap',
        }}
      >
        {citations.map(citation => (
          <span key={citation.source_num} data-citation-badge>
            <CitationBadge
              citation={citation}
              isActive={popover?.sourceNum === citation.source_num}
              onClick={(e) => togglePopover(citation, e.currentTarget)}
            />
          </span>
        ))}
      </span>

      {popover && activeCitation && (
        <div
          ref={popoverRef}
          className="popover animate-in"
          style={{
            ...positionStyle,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -5,
              left: 'var(--arrow-left, 50%)',
              transform: 'translateX(-50%) rotate(45deg)',
              width: 10,
              height: 10,
              background: 'var(--bg-elevated)',
              borderTop: '1px solid var(--glass-border)',
              borderLeft: '1px solid var(--glass-border)',
            }}
          />
          <PopoverContent citation={activeCitation} />
        </div>
      )}

      <style>{`
        .citation-badge {
          transition: background 0.12s, color 0.12s, box-shadow 0.12s;
        }
        .citation-badge:hover {
          box-shadow: 0 0 0 2px oklch(0.80 0.12 195 / 0.25);
        }
        .citation-badge:focus-visible {
          outline: 2px solid oklch(0.72 0.14 290 / 0.5);
          outline-offset: 1px;
        }
        .citation-badge-active:focus-visible {
          outline: 2px solid oklch(0.72 0.14 290 / 0.5);
          outline-offset: 1px;
        }
      `}</style>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  renderCitedText: replaces [Source N] with inline citation badges   */
/* ------------------------------------------------------------------ */

export function renderCitedText(
  text: string,
  citations: Citation[],
): ReactNode {
  if (!citations || citations.length === 0) return text

  const citationMap = new Map<number, Citation>()
  for (const c of citations) {
    citationMap.set(c.source_num, c)
  }

  const parts = text.split(/(\[Source\s+\d+\])/gi)
  if (parts.length === 1) return text

  return <CitedTextRenderer parts={parts} citationMap={citationMap} />
}

/* ------------------------------------------------------------------ */
/*  CitedTextRenderer: stateful wrapper for inline citation popovers   */
/* ------------------------------------------------------------------ */

function CitedTextRenderer({
  parts,
  citationMap,
}: {
  parts: string[]
  citationMap: Map<number, Citation>
}) {
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const sourceNumPattern = /\[Source\s+(\d+)\]/i

  useEffect(() => {
    if (!popover) return
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('[data-citation-inline]')
      ) {
        setPopover(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popover])

  useEffect(() => {
    if (!popover) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [popover])

  const positionStyle = usePopoverPosition(
    popover?.anchorRect ?? null,
    popoverRef,
  )

  const activeCitation = popover
    ? citationMap.get(popover.sourceNum) ?? null
    : null

  const togglePopover = (citation: Citation, el: HTMLElement) => {
    if (popover?.sourceNum === citation.source_num) {
      setPopover(null)
      return
    }
    setPopover({
      sourceNum: citation.source_num,
      anchorRect: el.getBoundingClientRect(),
    })
  }

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(sourceNumPattern)
        if (!match) return <span key={i}>{part}</span>

        const num = parseInt(match[1], 10)
        const citation = citationMap.get(num)
        if (!citation) return <span key={i}>{part}</span>

        return (
          <span key={i} data-citation-inline>
            <CitationBadge
              citation={citation}
              isActive={popover?.sourceNum === num}
              onClick={(e) => togglePopover(citation, e.currentTarget)}
              inline
            />
          </span>
        )
      })}

      {popover && activeCitation && (
        <div
          ref={popoverRef}
          className="popover animate-in"
          style={{
            ...positionStyle,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -5,
              left: 'var(--arrow-left, 50%)',
              transform: 'translateX(-50%) rotate(45deg)',
              width: 10,
              height: 10,
              background: 'var(--bg-elevated)',
              borderTop: '1px solid var(--glass-border)',
              borderLeft: '1px solid var(--glass-border)',
            }}
          />
          <PopoverContent citation={activeCitation} />
        </div>
      )}
    </>
  )
}
