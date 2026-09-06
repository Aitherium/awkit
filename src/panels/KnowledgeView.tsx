'use client'

import { useState, useEffect, useCallback } from 'react'

export interface KnowledgeViewProps {
  apiBase?: string
}

interface KnowledgeCollection {
  collection: string
  documents: number
  chunks: number
  last_synced?: string
  source_name?: string
  embedding_coverage: number
}

interface WikiArticle {
  id: string
  title: string
  content: string
  tags: string[]
  category: string
  created_at: string
  updated_at: string
  indexed: boolean
}

export default function KnowledgeView({ apiBase = '/api/data-plane' }: KnowledgeViewProps) {
  const [tab, setTab] = useState<'collections' | 'wiki'>('collections')
  const [collections, setCollections] = useState<KnowledgeCollection[]>([])
  const [wikiArticles, setWikiArticles] = useState<WikiArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [documents, setDocuments] = useState<unknown[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<unknown[]>([])
  const [searching, setSearching] = useState(false)
  // Wiki form
  const [showWikiForm, setShowWikiForm] = useState(false)
  const [wikiTitle, setWikiTitle] = useState('')
  const [wikiContent, setWikiContent] = useState('')
  const [wikiCategory, setWikiCategory] = useState('general')

  const fetchCollections = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/knowledge`)
      if (resp.ok) {
        const data = await resp.json()
        setCollections(Array.isArray(data) ? data : data.collections || [])
      }
    } catch (e) {
      console.error('Fetch knowledge error:', e)
    }
    setLoading(false)
  }, [apiBase])

  const fetchWiki = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/wiki/articles`)
      if (resp.ok) {
        const data = await resp.json()
        setWikiArticles(data.articles || [])
      }
    } catch (e) {
      console.error('Fetch wiki error:', e)
    }
  }, [apiBase])

  useEffect(() => { fetchCollections(); fetchWiki() }, [fetchCollections, fetchWiki])

  const handleSelectCollection = async (name: string) => {
    setSelectedCollection(name)
    try {
      const resp = await fetch(`${apiBase}/knowledge/${encodeURIComponent(name)}/documents`)
      if (resp.ok) {
        const data = await resp.json()
        setDocuments(data.documents || [])
      }
    } catch {
      setDocuments([])
    }
  }

  const handleSearch = async () => {
    if (!searchQuery || !selectedCollection) return
    setSearching(true)
    try {
      const resp = await fetch(
        `${apiBase}/knowledge/${encodeURIComponent(selectedCollection)}/search?q=${encodeURIComponent(searchQuery)}`
      )
      if (resp.ok) {
        const data = await resp.json()
        setSearchResults(data.results || [])
      }
    } catch {
      setSearchResults([])
    }
    setSearching(false)
  }

  const handleCreateArticle = async () => {
    if (!wikiTitle || !wikiContent) return
    try {
      const resp = await fetch(`${apiBase}/wiki/articles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: wikiTitle, content: wikiContent, category: wikiCategory }),
      })
      if (resp.ok) {
        setShowWikiForm(false)
        setWikiTitle('')
        setWikiContent('')
        fetchWiki()
      }
    } catch (e) {
      console.error('Create wiki article error:', e)
    }
  }

  const handleDeleteArticle = async (id: string) => {
    try {
      await fetch(`${apiBase}/wiki/articles/${id}`, { method: 'DELETE' })
      fetchWiki()
    } catch {}
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading knowledge...</div>
  }

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
        {(['collections', 'wiki'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '5px 14px', borderRadius: 5, border: 'none', fontSize: '0.8rem',
              background: tab === t ? 'var(--accent, #7c3aed)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === 'collections' ? 'Collections' : 'Wiki'}
          </button>
        ))}
      </div>

      {tab === 'collections' && (
        <div>
          {/* Collection cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: '1rem' }}>
            {collections.map(c => (
              <div
                key={c.collection}
                onClick={() => handleSelectCollection(c.collection)}
                style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: selectedCollection === c.collection ? 'rgba(124,58,237,0.1)' : 'var(--bg-elevated)',
                  border: selectedCollection === c.collection ? '1px solid var(--accent)' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: 6 }}>{c.collection}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 10 }}>
                  <span>{c.documents} docs</span>
                  <span>{c.chunks} chunks</span>
                </div>
                {/* Embedding coverage bar */}
                <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: 'var(--bg-deep)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.round(c.embedding_coverage * 100)}%`, height: '100%',
                    background: c.embedding_coverage >= 0.9 ? '#00c853' : c.embedding_coverage >= 0.5 ? '#ffc107' : '#ff5252',
                    borderRadius: 2,
                  }} />
                </div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 3 }}>
                  {Math.round(c.embedding_coverage * 100)}% embedded
                  {c.source_name && <span> / {c.source_name}</span>}
                </div>
              </div>
            ))}
          </div>

          {collections.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No knowledge collections yet. Upload documents or connect a data source to create collections.
            </div>
          )}

          {/* Search within selected collection */}
          {selectedCollection && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder={`Semantic search in ${selectedCollection}...`}
                  style={{
                    flex: 1, padding: '7px 12px', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'var(--bg-deep)',
                    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
                  }}
                />
                <button onClick={handleSearch} disabled={searching} style={{
                  padding: '6px 14px', borderRadius: 6, border: 'none',
                  background: 'var(--accent, #7c3aed)', color: '#fff',
                  cursor: 'pointer', fontSize: '0.8rem',
                }}>
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {searchResults.length} results
                  </div>
                  {searchResults.map((r: any, i: number) => (
                    <div key={i} style={{
                      padding: '8px 12px', borderRadius: 6, background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)', marginBottom: 6, fontSize: '0.8rem',
                    }}>
                      <div style={{ color: 'var(--text)', marginBottom: 4 }}>
                        {(r.content || r.text || '').slice(0, 300)}...
                      </div>
                      {r.score != null && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          Score: {r.score.toFixed(3)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Document list */}
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>
                Documents in {selectedCollection}
              </div>
              {documents.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No documents found.</div>
              ) : (
                documents.map((d: any, i: number) => (
                  <div key={d.id || i} style={{
                    padding: '6px 10px', borderRadius: 4, background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', marginBottom: 4, fontSize: '0.75rem',
                    display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span style={{ color: 'var(--text)' }}>{d.title || d.file_path || d.id || `Doc ${i + 1}`}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{d.chunk_count || ''}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'wiki' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {wikiArticles.length} article{wikiArticles.length !== 1 ? 's' : ''}
            </div>
            <button
              onClick={() => setShowWikiForm(!showWikiForm)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: 'none',
                background: 'var(--accent, #7c3aed)', color: '#fff',
                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
              }}
            >
              {showWikiForm ? 'Cancel' : '+ New Article'}
            </button>
          </div>

          {showWikiForm && (
            <div style={{
              padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', marginBottom: '1rem',
            }}>
              <input
                value={wikiTitle}
                onChange={e => setWikiTitle(e.target.value)}
                placeholder="Article title"
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <select
                value={wikiCategory}
                onChange={e => setWikiCategory(e.target.value)}
                style={{ ...inputStyle, marginBottom: 8, cursor: 'pointer' }}
              >
                <option value="general">General</option>
                <option value="technical">Technical</option>
                <option value="process">Process</option>
                <option value="faq">FAQ</option>
                <option value="research">Research</option>
              </select>
              <textarea
                value={wikiContent}
                onChange={e => setWikiContent(e.target.value)}
                placeholder="Article content (Markdown supported)"
                rows={6}
                style={{ ...inputStyle, marginBottom: 8, resize: 'vertical' }}
              />
              <button onClick={handleCreateArticle} disabled={!wikiTitle || !wikiContent} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: wikiTitle && wikiContent ? 'var(--accent)' : 'var(--bg-deep)',
                color: '#fff', cursor: wikiTitle && wikiContent ? 'pointer' : 'default',
                fontSize: '0.8rem', fontWeight: 600,
              }}>
                Create Article
              </button>
            </div>
          )}

          {wikiArticles.map(a => (
            <div key={a.id} style={{
              padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{a.title}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 8, marginTop: 2 }}>
                    <span>{a.category}</span>
                    {a.tags.length > 0 && <span>{a.tags.join(', ')}</span>}
                    <span>{a.indexed ? 'indexed' : 'not indexed'}</span>
                  </div>
                </div>
                <button onClick={() => handleDeleteArticle(a.id)} style={smallBtnStyle}>Delete</button>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6, maxHeight: 60, overflow: 'hidden' }}>
                {a.content.slice(0, 200)}{a.content.length > 200 ? '...' : ''}
              </div>
            </div>
          ))}

          {wikiArticles.length === 0 && !showWikiForm && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No wiki articles yet. Create your first article to build a team knowledge base.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border, #333)', background: 'var(--bg-deep, #111)',
  color: 'var(--text, #fff)', fontSize: '0.85rem', boxSizing: 'border-box',
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border, #333)',
  background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer',
  fontSize: '0.7rem',
}
