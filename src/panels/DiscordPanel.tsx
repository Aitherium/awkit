/**
 * Discord Panel — server presence for the Discord-connected workspace.
 *
 * Shows the Discord guild(s) bound to this workspace: channel list, recent
 * messages, and a reply box that posts IN-CHANNEL AS AITHER. Everything goes
 * through the workspace discord_presence router — the bot's own token and
 * sidecar never reach the browser, and every channel is verified against the
 * workspace's guild binding server-side.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Hash, MessageSquare, RefreshCw, Send } from "lucide-react";
import { rewriteApiUrl } from "@aitherium/awkit/lib";

interface BoundGuild {
  guild_id: string;
  guild_name: string;
  channel_count: number;
}

interface Channel {
  id: string;
  name: string;
  type?: string;
  category_id?: string | null;
  topic?: string | null;
}

interface Message {
  id: string;
  author: string;
  author_id: string;
  author_bot?: boolean;
  content: string;
  created_at: string;
}

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(rewriteApiUrl(`/api/workspace/discord${path}`), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const DiscordPanel: React.FC = () => {
  const [guilds, setGuilds] = useState<BoundGuild[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedGuild, setSelectedGuild] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGuilds = useCallback(async () => {
    try {
      const data = await api<{ guilds: BoundGuild[] }>("/guilds");
      setGuilds(data.guilds || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load guilds");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGuilds();
  }, [fetchGuilds]);

  const selectGuild = useCallback(async (guildId: string) => {
    setSelectedGuild(guildId);
    setSelectedChannel(null);
    setMessages([]);
    try {
      const data = await api<{ channels: Channel[] }>(
        `/guilds/${guildId}/channels`
      );
      setChannels(
        (data.channels || []).filter(
          (c) => c.type === "text" || c.type === "forum" || c.type === "news"
        )
      );
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load channels");
    }
  }, []);

  const selectChannel = useCallback(async (channelId: string) => {
    setSelectedChannel(channelId);
    setMessages([]);
    try {
      const data = await api<{ messages: Message[] }>(
        `/channels/${channelId}/messages?limit=30`
      );
      setMessages(data.messages || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load messages");
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchGuilds();
      if (selectedGuild) await selectGuild(selectedGuild);
      if (selectedChannel) await selectChannel(selectedChannel);
    } finally {
      setRefreshing(false);
    }
  }, [fetchGuilds, selectGuild, selectChannel, selectedGuild, selectedChannel]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !selectedChannel || sending) return;
    setSending(true);
    try {
      await api(`/channels/${selectedChannel}/send`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setDraft("");
      // Re-fetch to show the message as Aither posted it.
      await selectChannel(selectedChannel);
    } catch (e: any) {
      setError(e.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }, [draft, selectedChannel, sending, selectChannel]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading Discord server…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[420px] overflow-hidden rounded-lg border bg-card">
      {/* ── Left: channels ─────────────────────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-r bg-muted/40">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {selectedGuild
              ? guilds.find((g) => g.guild_id === selectedGuild)?.guild_name ||
                "Server"
              : "Server"}
          </span>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={refresh}
            title="Refresh"
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>

        {!selectedGuild && (
          <div className="space-y-1 p-2">
            {guilds.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No Discord server is bound to this workspace yet.
              </p>
            )}
            {guilds.map((g) => (
              <button
                key={g.guild_id}
                onClick={() => selectGuild(g.guild_id)}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span className="font-medium">{g.guild_name}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  {g.channel_count} channels
                </span>
              </button>
            ))}
          </div>
        )}

        {selectedGuild && (
          <>
            <button
              onClick={() => {
                setSelectedGuild(null);
                setChannels([]);
              }}
              className="border-b px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              ← All servers
            </button>
            <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {channels.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectChannel(c.id)}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                    selectedChannel === c.id ? "bg-muted font-medium" : ""
                  }`}
                >
                  <Hash size={13} className="text-muted-foreground" />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Right: messages + composer ─────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="border-b bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {!selectedChannel ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <MessageSquare size={18} className="mr-2" />
            Pick a channel to see recent messages
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No recent messages.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <span className="font-medium">
                    {m.author}
                    {m.author_bot && (
                      <span className="ml-1.5 rounded bg-blue-100 px-1 py-px text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Aither
                      </span>
                    )}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {fmtTime(m.created_at)}
                    </span>
                  </span>
                  <p className="mt-0.5 whitespace-pre-wrap text-foreground/90">
                    {m.content || <span className="italic text-muted-foreground">(attachment)</span>}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 border-t p-3">
              <input
                className="flex-1 rounded border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                placeholder={`Message #${
                  channels.find((c) => c.id === selectedChannel)?.name || ""
                } as Aither…`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                onClick={send}
                disabled={!draft.trim() || sending}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Send size={13} />
                {sending ? "…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DiscordPanel;
