"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus, Search, Edit3, Trash2, Eye, EyeOff, Save, X,
  ChevronDown, ChevronUp, ExternalLink,
  Bold, Italic, Heading2, List, Minus, Code, Quote,
  Link as LinkIcon, ImageIcon,
} from "lucide-react";
import { adminFetch, type BlogPost, type BlogPostCreate } from "./AdminAPI";

export interface ContentManagerProps {
  apiBase?: string;
  defaultAuthor?: string;
  blogUrlPrefix?: string;
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}

function estimateReadTime(content: string): string {
  const words = content.trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 230))} min read`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function MarkdownToolbar({
  textareaRef, onInsert,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (newValue: string) => void;
}) {
  const wrap = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.substring(start, end) || "text";
    const newVal = ta.value.substring(0, start) + before + selected + after + ta.value.substring(end);
    onInsert(newVal);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + before.length, start + before.length + selected.length); }, 0);
  };

  const insertLine = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.substring(0, pos);
    const after = ta.value.substring(pos);
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const newVal = before + (needsNl ? "\n" : "") + prefix + after;
    onInsert(newVal);
    setTimeout(() => { ta.focus(); const np = pos + (needsNl ? 1 : 0) + prefix.length; ta.setSelectionRange(np, np); }, 0);
  };

  const btn = "p-1.5 rounded transition-colors";
  const btnStyle = { color: "var(--text-muted, #4A6A8A)" };

  return (
    <div className="flex items-center gap-0.5 px-3 py-2 overflow-x-auto"
      style={{ background: "var(--bg-elevated, #1A2A40)", borderBottom: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}>
      <button type="button" className={btn} style={btnStyle} onClick={() => wrap("**", "**")} title="Bold"><Bold className="w-4 h-4" /></button>
      <button type="button" className={btn} style={btnStyle} onClick={() => wrap("*", "*")} title="Italic"><Italic className="w-4 h-4" /></button>
      <div className="w-px h-5 mx-1" style={{ background: "var(--glass-border)" }} />
      <button type="button" className={btn} style={btnStyle} onClick={() => insertLine("## ")} title="Heading"><Heading2 className="w-4 h-4" /></button>
      <button type="button" className={btn} style={btnStyle} onClick={() => insertLine("- ")} title="List"><List className="w-4 h-4" /></button>
      <button type="button" className={btn} style={btnStyle} onClick={() => insertLine("> ")} title="Quote"><Quote className="w-4 h-4" /></button>
      <div className="w-px h-5 mx-1" style={{ background: "var(--glass-border)" }} />
      <button type="button" className={btn} style={btnStyle} onClick={() => insertLine("\n---\n")} title="Divider"><Minus className="w-4 h-4" /></button>
      <button type="button" className={btn} style={btnStyle} onClick={() => wrap("`", "`")} title="Code"><Code className="w-4 h-4" /></button>
      <button type="button" className={btn} style={btnStyle} onClick={() => wrap("[", "](url)")} title="Link"><LinkIcon className="w-4 h-4" /></button>
      <button type="button" className={btn} style={btnStyle} onClick={() => insertLine("![alt](image-url)\n")} title="Image"><ImageIcon className="w-4 h-4" /></button>
    </div>
  );
}

export default function ContentManager({
  apiBase = "/api/shop",
  defaultAuthor = "Admin",
  blogUrlPrefix = "/blog",
}: ContentManagerProps) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPublished, setFilterPublished] = useState<"all" | "published" | "draft">("all");
  const [editing, setEditing] = useState<BlogPost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<BlogPostCreate>({
    slug: "", title: "", excerpt: "", content: "", category: "General",
    cover_image: "", read_time: "5 min read", published: false, sort_order: 0,
    author: defaultAuthor, meta_description: "", tags: "",
  });
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (filterPublished !== "all") q.set("published", String(filterPublished === "published"));
      if (search) q.set("search", search);
      const qs = q.toString();
      const data = await adminFetch<BlogPost[]>(apiBase, `/blog${qs ? `?${qs}` : ""}`);
      setPosts(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [apiBase, filterPublished, search]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  async function openEditor(id: number) {
    try {
      const full = await adminFetch<BlogPost>(apiBase, `/blog/${id}`);
      setEditing(full);
      setIsNew(false);
      setDraft({
        slug: full.slug, title: full.title, excerpt: full.excerpt, content: full.content,
        category: full.category, cover_image: full.cover_image, read_time: full.read_time,
        published: full.published, sort_order: full.sort_order,
        author: full.author ?? defaultAuthor,
        meta_description: full.meta_description ?? "", tags: full.tags ?? "",
      });
      setShowPreview(false);
    } catch (err) { alert("Failed to load post: " + (err as Error).message); }
  }

  function startNew() {
    setIsNew(true); setEditing(null);
    setDraft({
      slug: "", title: "", excerpt: "", content: "", category: "General",
      cover_image: "", read_time: "5 min read", published: false, sort_order: 0,
      author: defaultAuthor, meta_description: "", tags: "",
    });
    setShowPreview(false);
  }

  function closeEditor() { setEditing(null); setIsNew(false); }

  async function handleSave() {
    if (!draft.title.trim()) { alert("Title is required."); return; }
    setSaving(true);
    try {
      const slug = draft.slug || slugify(draft.title);
      const readTime = draft.content ? estimateReadTime(draft.content) : draft.read_time;
      const payload: BlogPostCreate = { ...draft, slug, read_time: readTime };
      if (isNew) { await adminFetch(apiBase, "/blog", { method: "POST", body: JSON.stringify(payload) }); }
      else if (editing) { await adminFetch(apiBase, `/blog/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) }); }
      closeEditor(); await loadPosts();
    } catch (err) { alert("Save failed: " + (err as Error).message); }
    setSaving(false);
  }

  async function handleDelete(id: number, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    try { await adminFetch(apiBase, `/blog/${id}`, { method: "DELETE" }); await loadPosts(); }
    catch (err) { alert("Delete failed: " + (err as Error).message); }
  }

  async function togglePublished(id: number, pub: boolean) {
    try { await adminFetch(apiBase, `/blog/${id}`, { method: "PATCH", body: JSON.stringify({ published: !pub }) }); await loadPosts(); }
    catch (err) { alert("Update failed: " + (err as Error).message); }
  }

  const showingEditor = editing !== null || isNew;

  /* ── Editor ── */
  if (showingEditor) {
    const inputStyle = {
      background: "var(--bg-elevated, #1A2A40)",
      border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
      color: "var(--text-primary, #E8F0F8)",
    };

    return (
      <div className="min-h-screen" style={{ background: "var(--bg-deep, #060D1A)" }}>
        <div className="sticky top-0 z-30 px-6 py-3 flex items-center justify-between backdrop-blur-sm"
          style={{ background: "rgba(10,22,40,0.95)", borderBottom: "1px solid var(--glass-border)" }}>
          <div className="flex items-center gap-3">
            <button onClick={closeEditor} className="p-1.5 rounded" style={{ color: "var(--text-muted)" }}><X className="w-5 h-5" /></button>
            <h2 className="text-lg font-light" style={{ color: "var(--text-primary)" }}>
              {isNew ? "New Post" : `Editing: ${editing?.title}`}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs uppercase tracking-wider"
              style={{
                background: showPreview ? "var(--accent-primary, #00E5FF)" : "var(--bg-elevated, #1A2A40)",
                color: showPreview ? "var(--bg-deep, #060D1A)" : "var(--text-muted, #4A6A8A)",
              }}>
              <Eye className="w-3.5 h-3.5" /> Preview
            </button>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
              Published
            </label>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs uppercase tracking-wider disabled:opacity-50"
              style={{ background: "var(--accent-primary, #00E5FF)", color: "var(--bg-deep, #060D1A)", fontWeight: 600 }}>
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 grid gap-6">
          <input type="text" placeholder="Post title…" value={draft.title}
            onChange={(e) => {
              const title = e.target.value;
              setDraft({ ...draft, title, slug: draft.slug === slugify(draft.title || "") ? slugify(title) : draft.slug });
            }}
            className="w-full text-3xl md:text-4xl bg-transparent outline-none border-none font-light"
            style={{ color: "var(--text-primary, #E8F0F8)" }}
          />
          <textarea placeholder="Brief excerpt…" value={draft.excerpt}
            onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} rows={2}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none resize-none" style={inputStyle} />

          <button type="button" onClick={() => setShowMeta(!showMeta)}
            className="flex items-center gap-2 text-xs uppercase tracking-wider self-start"
            style={{ color: "var(--accent-primary, #00E5FF)" }}>
            {showMeta ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Post Settings
          </button>

          {showMeta && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 rounded-xl" style={inputStyle}>
              {[
                { label: "Slug", key: "slug" as const, placeholder: "auto-from-title" },
                { label: "Category", key: "category" as const, placeholder: "General" },
                { label: "Cover Image URL", key: "cover_image" as const, placeholder: "https://…" },
                { label: "Author", key: "author" as const, placeholder: defaultAuthor },
                { label: "Tags (comma-separated)", key: "tags" as const, placeholder: "tech,product" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-ghost)" }}>{f.label}</label>
                  <input type="text" value={(draft as unknown as Record<string, string>)[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full rounded px-3 py-2 text-sm outline-none"
                    style={{ background: "var(--bg-deep)", border: "1px solid var(--glass-border)", color: "var(--text-primary)" }} />
                </div>
              ))}
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-ghost)" }}>Meta Description (SEO)</label>
                <input type="text" value={draft.meta_description}
                  onChange={(e) => setDraft({ ...draft, meta_description: e.target.value })}
                  placeholder="Short description for search engines…"
                  className="w-full rounded px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg-deep)", border: "1px solid var(--glass-border)", color: "var(--text-primary)" }} />
              </div>
            </div>
          )}

          {showPreview ? (
            <div className="rounded-xl p-8 min-h-[500px]" style={inputStyle}>
              <p className="text-[10px] uppercase tracking-wider mb-4" style={{ color: "var(--accent-primary)" }}>Preview</p>
              <h1 className="text-3xl font-light mb-4" style={{ color: "var(--text-primary)" }}>{draft.title || "Untitled"}</h1>
              <div className="whitespace-pre-wrap font-light leading-8" style={{ color: "var(--text-secondary, #8EACCD)" }}>
                {draft.content || "No content yet…"}
              </div>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--glass-border)" }}>
              <MarkdownToolbar textareaRef={textareaRef} onInsert={(val) => setDraft({ ...draft, content: val })} />
              <textarea ref={textareaRef} value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder="Write your post content here… (Markdown supported)"
                className="w-full min-h-[500px] px-5 py-4 text-sm leading-7 font-mono outline-none resize-y"
                style={{ background: "var(--bg-surface, #0A1628)", color: "var(--text-secondary, #8EACCD)" }} />
            </div>
          )}

          <div className="flex items-center gap-6 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-ghost, #2A4A6A)" }}>
            <span>{(draft.content || "").trim().split(/\s+/).filter(Boolean).length} words</span>
            <span>{(draft.content || "").length} characters</span>
            <span>{estimateReadTime(draft.content || "")}</span>
          </div>
        </div>
      </div>
    );
  }

  /* ── Post List ── */
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-light mb-1" style={{ color: "var(--text-primary, #E8F0F8)" }}>Content</h1>
          <p className="text-sm" style={{ color: "var(--text-muted, #4A6A8A)" }}>Create, edit, and publish posts</p>
        </div>
        <button onClick={startNew}
          className="flex items-center gap-1.5 px-4 py-2 rounded text-xs uppercase tracking-wider"
          style={{ background: "var(--accent-primary, #00E5FF)", color: "var(--bg-deep, #060D1A)", fontWeight: 600 }}>
          <Plus className="w-3.5 h-3.5" /> New Post
        </button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-ghost)" }} />
          <input type="text" placeholder="Search posts…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--glass-border)", color: "var(--text-primary)" }} />
        </div>
        <select value={filterPublished} onChange={(e) => setFilterPublished(e.target.value as "all" | "published" | "draft")}
          className="rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--glass-border)", color: "var(--text-primary)" }}>
          <option value="all">All Posts</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-20" style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-20" style={{ color: "var(--text-muted)" }}>
          <p className="mb-4">No posts yet.</p>
          <button onClick={startNew}
            className="px-4 py-2 rounded text-xs uppercase tracking-wider"
            style={{ background: "var(--accent-primary)", color: "var(--bg-deep)", fontWeight: 600 }}>
            Create First Post
          </button>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--glass-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--glass-border)" }}>
                {["Title", "Category", "Status", "Date", "Actions"].map((h) => (
                  <th key={h} className={`text-[10px] uppercase tracking-wider px-5 py-3 font-medium ${h === "Actions" ? "text-right" : "text-left"}`}
                    style={{ color: "var(--text-ghost)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="transition-colors" style={{ borderBottom: "1px solid var(--bg-elevated)" }}>
                  <td className="px-5 py-4">
                    <p className="font-medium line-clamp-1" style={{ color: "var(--text-primary)" }}>{post.title}</p>
                    <p className="text-xs line-clamp-1" style={{ color: "var(--text-ghost)" }}>/{post.slug}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider"
                      style={{ background: "var(--bg-elevated)", color: "var(--accent-primary)" }}>
                      {post.category}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <button onClick={() => togglePublished(post.id, post.published)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider"
                      style={{
                        background: post.published ? "rgba(74,222,128,0.15)" : "rgba(245,158,11,0.15)",
                        color: post.published ? "var(--accent-success)" : "var(--accent-warn)",
                      }}>
                      {post.published ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      {post.published ? "Published" : "Draft"}
                    </button>
                  </td>
                  <td className="px-4 py-4" style={{ color: "var(--text-muted)" }}>{formatDate(post.created_at)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1 justify-end">
                      <a href={`${blogUrlPrefix}/${post.slug}`} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded transition-colors" title="View" style={{ color: "var(--text-muted)" }}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button onClick={() => openEditor(post.id)} className="p-1.5 rounded transition-colors" title="Edit"
                        style={{ color: "var(--text-muted)" }}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(post.id, post.title)} className="p-1.5 rounded transition-colors" title="Delete"
                        style={{ color: "var(--accent-danger, #f87171)" }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
