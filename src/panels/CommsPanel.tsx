'use client'

import { relayWsUrl as buildRelayWsUrl } from '../lib/relayWsUrl'
import { useState, useEffect, useCallback, useRef } from 'react'

type View = 'channels' | 'dms' | 'groups' | 'people' | 'email'
type RightPanel = 'members' | 'pins' | 'browse' | null

interface Channel { name: string; topic?: string; mode?: string; member_count?: number; scope?: string }
interface Reaction { emoji: string; count: number; nicks: string[] }
interface Message {
  id?: string; content: string; nick?: string; sender?: string
  timestamp?: string; created_at?: string; channel?: string
  reactions?: Reaction[]; thread_count?: number; pinned?: boolean
  optimistic?: boolean; failed?: boolean; type?: string
}
interface DMPartner { nick: string; last_message?: string; last_at?: string }
interface Group { id: string; name: string; members: string[]; created_by?: string }
interface User { nick: string; is_agent?: boolean; status?: string; email?: string; online?: boolean }
interface UnreadCounts { [channel: string]: number }
interface TypingInfo { nick: string; expiresAt: number }
interface Notification { id: string; type: string; channel?: string; from_nick?: string; content?: string; timestamp?: string }

const chId = (ch: Channel) => ch.name.replace(/^#/, '')
const POLL_INTERVAL = 4000
const TYPING_DEBOUNCE = 3000
const TYPING_DISPLAY_TIMEOUT = 4000
const QUICK_EMOJIS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F604}', '\u{1F914}', '\u{1F440}', '\u{1F389}', '\u{1F4AF}', '\u{1F525}']

interface CommsPanelProps {
  apiBase?: string
}

export default function CommsPanel({ apiBase = '/api/platform' }: CommsPanelProps = {}) {
  const [view, setView] = useState<View>('channels')
  // Channels
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<string | null>(null)
  const [channelMembers, setChannelMembers] = useState<User[]>([])
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelTopic, setNewChannelTopic] = useState('')
  const [newChannelPrivate, setNewChannelPrivate] = useState(false)
  const [showChannelSettings, setShowChannelSettings] = useState(false)
  const [editTopic, setEditTopic] = useState('')
  // DMs
  const [dmPartners, setDmPartners] = useState<DMPartner[]>([])
  const [activeDM, setActiveDM] = useState<string | null>(null)
  const [showNewDM, setShowNewDM] = useState(false)
  const [dmSearch, setDmSearch] = useState('')
  const [dmSearchResults, setDmSearchResults] = useState<User[]>([])
  // Groups
  const [groups, setGroups] = useState<Group[]>([])
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([])
  const [groupMemberSearch, setGroupMemberSearch] = useState('')
  const [groupSearchResults, setGroupSearchResults] = useState<User[]>([])
  const [showGroupInvite, setShowGroupInvite] = useState(false)
  const [groupInviteNick, setGroupInviteNick] = useState('')
  // People
  const [onlineUsers, setOnlineUsers] = useState<User[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([])
  const [peopleSearch, setPeopleSearch] = useState('')
  const [peopleSearchResults, setPeopleSearchResults] = useState<User[]>([])
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  // Email
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailStatus, setEmailStatus] = useState('')
  const [inbox, setInbox] = useState<any[]>([])
  // Shared
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  const [error, setError] = useState<string | null>(null)
  // Reactions, threads, unread, search
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>({})
  const [reactionPickerMsg, setReactionPickerMsg] = useState<string | null>(null)
  const [threadParent, setThreadParent] = useState<Message | null>(null)
  const [threadReplies, setThreadReplies] = useState<Message[]>([])
  const [threadInput, setThreadInput] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Message[]>([])
  const [editingMessage, setEditingMessage] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [announcements, setAnnouncements] = useState<any[]>([])
  // WebSocket + typing
  const [wsConnected, setWsConnected] = useState(false)
  const [typingUsers, setTypingUsers] = useState<TypingInfo[]>([])
  // Pins
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([])
  // Channel browser
  const [allChannels, setAllChannels] = useState<Channel[]>([])
  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  // File upload
  const [uploading, setUploading] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgIdCounter = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const lastTypingSentRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Helpers ───────────────────────────────────────────────────────────

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  const apiFetch = async (url: string, opts?: RequestInit) => {
    const r = await fetch(url, opts)
    const data = await r.json()
    if (!r.ok || data.error) throw new Error(data.error || data.detail || `HTTP ${r.status}`)
    return data
  }

  // ── WebSocket ─────────────────────────────────────────────────────────

  useEffect(() => {
    // One shared resolver -- see lib/relayWsUrl.ts. The cross-origin branch
    // here was unreachable in practice: this panel's apiBase defaults to the
    // RELATIVE '/api/platform', so it never matched the startsWith('http')
    // test and always fell back to window.location.host -- the static host on
    // a Pages deployment. Host and prefix are now resolved separately.
    const wsUrl = buildRelayWsUrl(undefined, apiBase)
    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          setWsConnected(true)
          // Auto-join current channel
          if (activeChannel) {
            ws.send(JSON.stringify({ type: 'join', channel: `#${activeChannel}` }))
          }
        }

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data)
            handleWsMessage(data)
          } catch { /* ignore malformed */ }
        }

        ws.onclose = () => {
          setWsConnected(false)
          wsRef.current = null
          // Reconnect after 3s
          reconnectTimer = setTimeout(connect, 3000)
        }

        ws.onerror = () => { /* onclose will fire */ }
      } catch { /* WS not available, polling fallback */ }
    }

    connect()
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) { try { ws.close() } catch {} }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase])

  const handleWsMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'message': case 'action': case 'system':
        setMessages(prev => {
          // Dedupe — don't add if we already have this ID (optimistic)
          if (data.id && prev.some(m => m.id === data.id)) return prev
          // Remove matching optimistic message from same nick
          const filtered = prev.filter(m => !(m.optimistic && m.nick === 'You' && m.content === data.content))
          return [...filtered, data as Message]
        })
        break
      case 'history':
        if (data.channel && Array.isArray(data.messages)) {
          setMessages(data.messages as Message[])
        }
        break
      case 'typing':
        if (data.nick && data.channel) {
          setTypingUsers(prev => {
            const filtered = prev.filter(t => t.nick !== data.nick)
            return [...filtered, { nick: data.nick, expiresAt: Date.now() + TYPING_DISPLAY_TIMEOUT }]
          })
        }
        break
      case 'join':
        if (data.channel && data.nick) {
          setMessages(prev => [...prev, {
            id: `join-${data.nick}-${Date.now()}`, content: `${data.nick} joined`,
            nick: 'system', timestamp: new Date().toISOString(), type: 'system',
          }])
        }
        break
      case 'part':
        if (data.channel && data.nick) {
          setMessages(prev => [...prev, {
            id: `part-${data.nick}-${Date.now()}`, content: `${data.nick} left`,
            nick: 'system', timestamp: new Date().toISOString(), type: 'system',
          }])
        }
        break
      case 'userlist':
        if (data.channel && Array.isArray(data.users)) {
          setChannelMembers(data.users.map((u: any) => ({
            nick: u.nick || u, is_agent: u.is_agent, online: true,
            status: u.status || u.status_text,
          })))
        }
        break
      case 'reaction':
        if (data.message_id && data.emoji) {
          setMessages(prev => prev.map(m => {
            if (m.id !== data.message_id) return m
            const reactions = [...(m.reactions || [])]
            const existing = reactions.find(r => r.emoji === data.emoji)
            if (existing) {
              existing.count++
              existing.nicks.push(data.nick)
            } else {
              reactions.push({ emoji: data.emoji, count: 1, nicks: [data.nick] })
            }
            return { ...m, reactions }
          }))
        }
        break
      case 'mention_notification':
        setNotifications(prev => [{
          id: `notif-${Date.now()}`, type: 'mention', channel: data.channel,
          from_nick: data.from_nick, content: data.content, timestamp: data.timestamp,
        }, ...prev].slice(0, 50))
        break
    }
  }, [])

  // Expire typing indicators
  useEffect(() => {
    const timer = setInterval(() => {
      setTypingUsers(prev => prev.filter(t => t.expiresAt > Date.now()))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const wsSend = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
      return true
    }
    return false
  }, [])

  const sendTypingIndicator = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSentRef.current < TYPING_DEBOUNCE) return
    lastTypingSentRef.current = now
    if (activeChannel) wsSend({ type: 'typing', channel: `#${activeChannel}` })
  }, [activeChannel, wsSend])

  // ── Data fetching ──────────────────────────────────────────────────────

  const fetchChannels = useCallback(async () => {
    try {
      const d = await apiFetch(`${apiBase}/channels`)
      setChannels(d.channels || [])
    } catch { setChannels([]) }
  }, [apiBase])

  const fetchDMs = useCallback(async () => {
    try {
      const d = await apiFetch(`${apiBase}/dms`)
      setDmPartners(d.partners || [])
    } catch { setDmPartners([]) }
  }, [apiBase])

  const fetchGroups = useCallback(async () => {
    try {
      const d = await apiFetch(`${apiBase}/groups`)
      setGroups(d.groups || [])
    } catch { setGroups([]) }
  }, [apiBase])

  const fetchMessages = useCallback(async (channel: string) => {
    // If WS is connected, rely on history from WS join
    if (wsConnected && wsRef.current?.readyState === WebSocket.OPEN) return
    try {
      const d = await apiFetch(`${apiBase}/channels/${channel}/messages?limit=100`)
      setMessages(prev => {
        const optimistic = prev.filter(m => m.optimistic && !m.failed)
        const serverMsgs = d.messages || []
        const serverIds = new Set(serverMsgs.map((m: Message) => m.id))
        const remaining = optimistic.filter(m => !serverIds.has(m.id))
        return [...serverMsgs, ...remaining]
      })
    } catch { /* keep existing */ }
  }, [apiBase, wsConnected])

  const fetchDMMessages = useCallback(async (other: string) => {
    try {
      const d = await apiFetch(`${apiBase}/dms/${other}?limit=100`)
      setMessages(d.messages || [])
    } catch { /* keep existing */ }
  }, [apiBase])

  const fetchGroupMessages = useCallback(async (groupId: string) => {
    try {
      const d = await apiFetch(`${apiBase}/groups/${groupId}/messages?limit=100`)
      setMessages(d.messages || [])
    } catch { /* keep existing */ }
  }, [apiBase])

  const fetchChannelMembers = useCallback(async (channel: string) => {
    // WS provides userlist automatically on join
    if (wsConnected) return
    try {
      const d = await apiFetch(`${apiBase}/channels/${channel}/users`)
      setChannelMembers(d.users || [])
    } catch { setChannelMembers([]) }
  }, [apiBase, wsConnected])

  const fetchOnlineUsers = useCallback(async () => {
    try {
      const all = (await apiFetch(`${apiBase}/users/online`)).users || []
      setOnlineUsers(all.filter((u: any) => !u.is_agent))
    } catch { setOnlineUsers([]) }
  }, [apiBase])

  const fetchDirectoryUsers = useCallback(async () => {
    try {
      const d = await apiFetch(`${apiBase}/users`)
      const all = d.users || d.entries || []
      setDirectoryUsers(all.filter((u: any) => !u.is_agent))
    } catch { setDirectoryUsers([]) }
  }, [apiBase])

  const fetchInbox = useCallback(async () => {
    try { setInbox((await apiFetch(`${apiBase}/email/inbox`)).messages || []) }
    catch { setInbox([]) }
  }, [apiBase])

  const fetchUnread = useCallback(async () => {
    try { setUnreadCounts((await apiFetch(`${apiBase}/unread`)).channels || {}) }
    catch { /* ignore */ }
  }, [apiBase])

  const fetchAnnouncements = useCallback(async () => {
    try { setAnnouncements((await apiFetch(`${apiBase}/announcements`)).announcements || []) }
    catch { /* ignore */ }
  }, [apiBase])

  const fetchNotifications = useCallback(async () => {
    try { setNotifications((await apiFetch(`${apiBase}/notifications`)).notifications || []) }
    catch { /* ignore */ }
  }, [apiBase])

  const fetchPins = useCallback(async (channel: string) => {
    try { setPinnedMessages((await apiFetch(`${apiBase}/channels/${channel}/pins`)).pins || []) }
    catch { setPinnedMessages([]) }
  }, [apiBase])

  const fetchAllChannels = useCallback(async () => {
    try { setAllChannels((await apiFetch(`${apiBase}/channels`)).channels || []) }
    catch { setAllChannels([]) }
  }, [apiBase])

  const searchUsers = useCallback(async (q: string, setter: (u: User[]) => void) => {
    if (!q.trim()) { setter([]); return }
    try { setter((await apiFetch(`${apiBase}/users/search?q=${encodeURIComponent(q)}`)).users || []) }
    catch { setter([]) }
  }, [apiBase])

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchChannels(); fetchDMs(); fetchUnread(); fetchAnnouncements(); fetchNotifications()
  }, [fetchChannels, fetchDMs, fetchUnread, fetchAnnouncements, fetchNotifications])

  useEffect(() => {
    if (activeChannel) {
      setLoading(true)
      // If WS connected, send join to get history
      if (wsConnected) {
        wsSend({ type: 'join', channel: `#${activeChannel}` })
        setLoading(false)
      } else {
        fetchMessages(activeChannel).finally(() => setLoading(false))
        fetchChannelMembers(activeChannel)
      }
      setRightPanel('members')
      apiFetch(`${apiBase}/channels/${activeChannel}/read`, { method: 'POST' }).catch(() => {})
      setUnreadCounts(prev => { const next = { ...prev }; delete next[activeChannel]; return next })
    }
  }, [activeChannel, fetchMessages, fetchChannelMembers, apiBase, wsConnected, wsSend])

  useEffect(() => {
    if (activeDM) {
      setLoading(true)
      fetchDMMessages(activeDM).finally(() => setLoading(false))
      setRightPanel(null)
    }
  }, [activeDM, fetchDMMessages])

  useEffect(() => {
    if (activeGroup) {
      setLoading(true)
      fetchGroupMessages(activeGroup).finally(() => setLoading(false))
      setRightPanel('members')
    }
  }, [activeGroup, fetchGroupMessages])

  useEffect(() => {
    if (view === 'groups') fetchGroups()
    if (view === 'people') { fetchOnlineUsers(); fetchDirectoryUsers() }
    if (view === 'email') fetchInbox()
  }, [view, fetchGroups, fetchOnlineUsers, fetchDirectoryUsers, fetchInbox])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // ── Polling (fallback when WS not connected) ──────────────────────────

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (wsConnected) return // WS handles real-time updates
    const poll = () => {
      if (view === 'channels' && activeChannel) fetchMessages(activeChannel)
      else if (view === 'dms' && activeDM) fetchDMMessages(activeDM)
      else if (view === 'groups' && activeGroup) fetchGroupMessages(activeGroup)
      fetchUnread()
    }
    if ((view === 'channels' && activeChannel) || (view === 'dms' && activeDM) || (view === 'groups' && activeGroup)) {
      pollRef.current = setInterval(poll, POLL_INTERVAL)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [view, activeChannel, activeDM, activeGroup, fetchMessages, fetchDMMessages, fetchGroupMessages, fetchUnread, wsConnected])

  // Debounced searches
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => { if (showNewDM) searchUsers(dmSearch, setDmSearchResults) }, 300)
  }, [dmSearch, showNewDM, searchUsers])

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => { if (showNewGroup) searchUsers(groupMemberSearch, setGroupSearchResults) }, 300)
  }, [groupMemberSearch, showNewGroup, searchUsers])

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => { if (view === 'people') searchUsers(peopleSearch, setPeopleSearchResults) }, 300)
  }, [peopleSearch, view, searchUsers])

  // ── Actions ────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!input.trim()) return
    const content = input
    setInput('')
    const tempId = `optimistic-${++msgIdCounter.current}`
    const optimisticMsg: Message = {
      id: tempId, content, nick: 'You', timestamp: new Date().toISOString(), optimistic: true,
    }
    setMessages(prev => [...prev, optimisticMsg])
    setSending(true)

    // Try WS first for channels
    if (view === 'channels' && activeChannel && wsConnected) {
      const sent = wsSend({ type: 'message', channel: `#${activeChannel}`, content })
      if (sent) { setSending(false); return }
    }

    try {
      if (view === 'dms' && activeDM) {
        await apiFetch(`${apiBase}/dms`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: activeDM, content }) })
        fetchDMMessages(activeDM)
      } else if (view === 'groups' && activeGroup) {
        await apiFetch(`${apiBase}/groups/${activeGroup}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }) })
        fetchGroupMessages(activeGroup)
      } else if (activeChannel) {
        await apiFetch(`${apiBase}/channels/${activeChannel}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }) })
        if (!wsConnected) fetchMessages(activeChannel)
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, failed: true, optimistic: false } : m))
      showError(`Send failed: ${e.message || 'unknown error'}`)
    } finally { setSending(false) }
  }

  const createChannel = async () => {
    if (!newChannelName.trim()) return
    try {
      await apiFetch(`${apiBase}/channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newChannelName.trim().toLowerCase().replace(/\s+/g, '-'), topic: newChannelTopic, mode: newChannelPrivate ? 'private' : 'public' }) })
      setNewChannelName(''); setNewChannelTopic(''); setNewChannelPrivate(false); setShowNewChannel(false)
      fetchChannels()
    } catch (e: any) { showError(`Create channel failed: ${e.message}`) }
  }

  const updateTopic = async () => {
    if (!activeChannel) return
    try {
      await apiFetch(`${apiBase}/channels/${activeChannel}/topic`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: editTopic }) })
      setShowChannelSettings(false); fetchChannels()
    } catch (e: any) { showError(`Update topic failed: ${e.message}`) }
  }

  const deleteChannel = async () => {
    if (!activeChannel || !confirm(`Delete #${activeChannel}?`)) return
    try {
      await apiFetch(`${apiBase}/channels/${activeChannel}`, { method: 'DELETE' })
      setActiveChannel(null); setShowChannelSettings(false); fetchChannels()
    } catch (e: any) { showError(`Delete failed: ${e.message}`) }
  }

  const createGroup = async () => {
    if (!newGroupName.trim()) return
    try {
      await apiFetch(`${apiBase}/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), members: newGroupMembers }) })
      setNewGroupName(''); setNewGroupMembers([]); setShowNewGroup(false); fetchGroups()
    } catch (e: any) { showError(`Create group failed: ${e.message}`) }
  }

  const inviteToGroup = async () => {
    if (!activeGroup || !groupInviteNick.trim()) return
    try {
      await apiFetch(`${apiBase}/groups/${activeGroup}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: groupInviteNick.trim() }) })
      setGroupInviteNick(''); setShowGroupInvite(false)
    } catch (e: any) { showError(`Invite failed: ${e.message}`) }
  }

  const leaveGroup = async () => {
    if (!activeGroup || !confirm('Leave this group?')) return
    try {
      await apiFetch(`${apiBase}/groups/${activeGroup}/leave`, { method: 'POST' })
      setActiveGroup(null); fetchGroups()
    } catch (e: any) { showError(`Leave failed: ${e.message}`) }
  }

  const startDMWith = (nick: string) => {
    setView('dms'); setActiveDM(nick); setActiveChannel(null); setActiveGroup(null); setShowNewDM(false); setDmSearch('')
  }

  const emailUser = async (nick: string) => {
    try {
      const d = await apiFetch(`${apiBase}/profiles/${nick}`)
      setEmailTo(d.email || nick); setEmailSubject(`Message from workspace`)
    } catch { setEmailTo(nick) }
    setView('email')
  }

  const sendEmail = async () => {
    if (!emailTo || !emailSubject || !emailBody) return
    setEmailSending(true); setEmailStatus('')
    try {
      await apiFetch(`${apiBase}/email/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emailTo.split(',').map(e => e.trim()).filter(Boolean), subject: emailSubject, body: emailBody }) })
      setEmailStatus('Email sent'); setEmailTo(''); setEmailSubject(''); setEmailBody('')
    } catch (e: any) { setEmailStatus(`Failed: ${e.message || 'Unknown'}`) }
    finally { setEmailSending(false); setTimeout(() => setEmailStatus(''), 4000) }
  }

  const createInviteLink = async () => {
    setInviteStatus('Creating...')
    try {
      const d = await apiFetch(`${apiBase}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const url = d.invite_url || d.url || ''
      if (url) { await navigator.clipboard.writeText(url); setInviteStatus('Link copied!') }
      else setInviteStatus('Could not generate link')
    } catch (e: any) { setInviteStatus(`Failed: ${e.message}`) }
    setTimeout(() => setInviteStatus(''), 3000)
  }

  const sendInviteEmail = async () => {
    if (!inviteEmail.trim()) return
    setInviteStatus('Sending...')
    try {
      await apiFetch(`${apiBase}/invites/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }) })
      setInviteStatus('Invite sent!'); setInviteEmail('')
    } catch (e: any) { setInviteStatus(`Failed: ${e.message}`) }
    setTimeout(() => setInviteStatus(''), 3000)
  }

  // Reactions
  const addReaction = async (messageId: string, emoji: string) => {
    if (!activeChannel) return
    setReactionPickerMsg(null)
    try {
      await apiFetch(`${apiBase}/channels/${activeChannel}/messages/${messageId}/react`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }) })
      if (!wsConnected && activeChannel) fetchMessages(activeChannel)
    } catch (e: any) { showError(`Reaction failed: ${e.message}`) }
  }

  // Threads
  const openThread = async (msg: Message) => {
    if (!activeChannel || !msg.id) return
    setThreadParent(msg); setRightPanel(null)
    try { setThreadReplies((await apiFetch(`${apiBase}/channels/${activeChannel}/messages/${msg.id}/thread`)).replies || []) }
    catch { setThreadReplies([]) }
  }

  const sendThreadReply = async () => {
    if (!threadInput.trim() || !activeChannel || !threadParent?.id) return
    try {
      await apiFetch(`${apiBase}/channels/${activeChannel}/messages/${threadParent.id}/thread`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: threadInput }) })
      setThreadInput('')
      setThreadReplies((await apiFetch(`${apiBase}/channels/${activeChannel}/messages/${threadParent.id}/thread`)).replies || [])
    } catch (e: any) { showError(`Thread reply failed: ${e.message}`) }
  }

  // Edit/delete
  const startEditMessage = (msg: Message) => { setEditingMessage(msg.id || null); setEditContent(msg.content) }
  const saveEditMessage = async () => {
    if (!editingMessage || !activeChannel) return
    try {
      await apiFetch(`${apiBase}/channels/${activeChannel}/messages/${editingMessage}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editContent }) })
      setEditingMessage(null); setEditContent(''); fetchMessages(activeChannel)
    } catch (e: any) { showError(`Edit failed: ${e.message}`) }
  }
  const deleteMessage = async (messageId: string) => {
    if (!activeChannel || !confirm('Delete this message?')) return
    try { await apiFetch(`${apiBase}/channels/${activeChannel}/messages/${messageId}`, { method: 'DELETE' }); fetchMessages(activeChannel) }
    catch (e: any) { showError(`Delete failed: ${e.message}`) }
  }

  // Search
  const performSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    try { setSearchResults((await apiFetch(`${apiBase}/search?q=${encodeURIComponent(searchQuery)}${activeChannel ? `&channel=${activeChannel}` : ''}`)).results || []) }
    catch { setSearchResults([]) }
  }

  // Announcements
  const dismissAnnouncement = async (annId: string) => {
    try { await apiFetch(`${apiBase}/announcements/${annId}/dismiss`, { method: 'POST' }); setAnnouncements(prev => prev.filter(a => a.id !== annId)) }
    catch { /* ignore */ }
  }

  // Pins
  const pinMessage = async (messageId: string) => {
    if (!activeChannel) return
    try { await apiFetch(`${apiBase}/channels/${activeChannel}/pin/${messageId}`, { method: 'POST' }); fetchPins(activeChannel) }
    catch (e: any) { showError(`Pin failed: ${e.message}`) }
  }

  // File upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeChannel) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch(`${apiBase}/channels/${activeChannel}/upload`, { method: 'POST', body: form })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      // Send a message referencing the upload
      const content = `[File: ${file.name}]`
      if (wsConnected) wsSend({ type: 'message', channel: `#${activeChannel}`, content })
      else await apiFetch(`${apiBase}/channels/${activeChannel}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) })
    } catch (e: any) { showError(`Upload failed: ${e.message}`) }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  // Channel browser — join
  const joinChannel = async (channelName: string) => {
    const id = channelName.replace(/^#/, '')
    if (wsConnected) wsSend({ type: 'join', channel: channelName.startsWith('#') ? channelName : `#${channelName}` })
    setActiveChannel(id); setActiveDM(null); setActiveGroup(null); setView('channels')
    setRightPanel('members')
    fetchChannels()
  }

  // ── Computed ───────────────────────────────────────────────────────────

  const hasActive = (view === 'channels' && activeChannel) || (view === 'dms' && activeDM) || (view === 'groups' && activeGroup)
  const activeLabel = view === 'channels' ? `# ${activeChannel}` : view === 'dms' ? activeDM : view === 'groups' ? groups.find(g => g.id === activeGroup)?.name || activeGroup : ''
  const activeTopicText = view === 'channels' ? channels.find(ch => chId(ch) === activeChannel)?.topic || '' : ''
  const activeGroupObj = groups.find(g => g.id === activeGroup)
  const contextPanelUsers = view === 'channels' ? channelMembers : view === 'groups' && activeGroupObj ? activeGroupObj.members.map(m => ({ nick: m } as User)) : []
  const totalUnread = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0)
  const activeTyping = typingUsers.filter(t => t.expiresAt > Date.now()).map(t => t.nick)
  const unreadNotifications = notifications.length

  // ── Render ─────────────────────────────────────────────────────────────

  const viewLabels: Record<View, string> = { channels: 'Channels', dms: 'DMs', groups: 'Groups', people: 'People', email: 'Email' }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
      {/* Error toast */}
      {error && (
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
          padding: '0.5rem 1rem', background: 'var(--accent-coral, #f87171)', color: '#fff',
          borderRadius: 'var(--radius)', fontSize: '0.8rem', fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)', maxWidth: '80%', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Announcements banner */}
      {announcements.length > 0 && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 90,
          background: 'var(--accent-primary)', color: 'var(--bg-deep)', padding: '0.4rem 1rem',
          fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{announcements[0].content || announcements[0].message}</span>
          <button onClick={() => dismissAnnouncement(announcements[0].id)}
            style={{ background: 'transparent', color: 'var(--bg-deep)', fontWeight: 600, fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>Dismiss</button>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileUpload} />

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div style={{ width: 240, borderRight: '1px solid var(--glass-border)', display: 'flex',
        flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
        marginTop: announcements.length > 0 ? 32 : 0 }}>
        {/* View tabs + notification bell */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', alignItems: 'center' }}>
          <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap' }}>
            {(Object.keys(viewLabels) as View[]).map(v => (
              <button key={v} onClick={() => {
                setView(v); setMessages([]); setActiveChannel(null); setActiveDM(null); setActiveGroup(null)
                setShowNewChannel(false); setShowNewDM(false); setShowNewGroup(false)
                setShowChannelSettings(false); setRightPanel(null); setThreadParent(null); setShowSearch(false)
              }} style={{
                flex: 1, padding: '0.55rem 0', fontSize: '0.68rem', fontWeight: 600,
                background: view === v ? 'var(--bg-surface)' : 'transparent',
                color: view === v ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: view === v ? '2px solid var(--accent-primary)' : '2px solid transparent',
                minWidth: 0, whiteSpace: 'nowrap', position: 'relative',
              }}>
                {viewLabels[v]}
                {v === 'channels' && totalUnread > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14,
                    borderRadius: '50%', background: 'var(--accent-coral, #f87171)', color: '#fff',
                    fontSize: '0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                    {totalUnread > 9 ? '9+' : totalUnread}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Notification bell */}
          <button onClick={() => setShowNotifications(!showNotifications)} style={{
            position: 'relative', background: 'transparent', color: 'var(--text-muted)',
            padding: '0.4rem', fontSize: '0.9rem', flexShrink: 0 }}>
            {'\u{1F514}'}
            {unreadNotifications > 0 && (
              <span style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12,
                borderRadius: '50%', background: 'var(--accent-coral, #f87171)', color: '#fff',
                fontSize: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </button>
        </div>

        {/* Notification dropdown */}
        {showNotifications && (
          <div style={{ maxHeight: 250, overflow: 'auto', borderBottom: '1px solid var(--glass-border)',
            background: 'var(--bg-surface)', padding: '0.5rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
              Notifications
            </div>
            {notifications.length === 0 && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem' }}>No notifications</p>
            )}
            {notifications.slice(0, 20).map(n => (
              <div key={n.id} onClick={() => { if (n.channel) { setActiveChannel(n.channel.replace(/^#/, '')); setView('channels') }; setShowNotifications(false) }}
                style={{ padding: '0.35rem', borderRadius: 4, cursor: 'pointer', marginBottom: '0.2rem',
                  fontSize: '0.72rem', background: 'var(--bg-deep)' }}>
                <span style={{ fontWeight: 600 }}>{n.from_nick}</span>
                {n.channel && <span style={{ color: 'var(--text-muted)' }}> in {n.channel}</span>}
                {n.content && <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.content}</div>}
              </div>
            ))}
          </div>
        )}

        {/* WS status indicator */}
        <div style={{ padding: '0.2rem 0.5rem', fontSize: '0.6rem', color: 'var(--text-muted)',
          borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%',
            background: wsConnected ? 'var(--accent-green, #4ade80)' : 'var(--text-muted)' }} />
          {wsConnected ? 'Live' : 'Polling'}
        </div>

        {/* Sidebar content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0.5rem' }}>
          {/* Channels sidebar */}
          {view === 'channels' && (<>
            {channels.map(ch => {
              const id = chId(ch)
              const unread = unreadCounts[id] || 0
              return (
                <button key={id} onClick={() => { setActiveChannel(id); setActiveDM(null); setActiveGroup(null); setThreadParent(null) }}
                  style={{ display: 'flex', width: '100%', textAlign: 'left', padding: '0.5rem 0.6rem',
                    background: activeChannel === id ? 'var(--bg-surface)' : 'transparent',
                    color: activeChannel === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderRadius: 'var(--radius)', fontSize: '0.82rem', marginBottom: '0.15rem',
                    fontWeight: unread > 0 ? 700 : 400, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span><span style={{ opacity: 0.5 }}>{ch.mode === 'private' ? '\uD83D\uDD12 ' : '# '}</span>{id}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    {unread > 0 && <span style={{ minWidth: 16, height: 16, borderRadius: 8, fontSize: '0.6rem',
                      background: 'var(--accent-coral, #f87171)', color: '#fff', fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread}</span>}
                    {ch.member_count != null && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ch.member_count}</span>}
                  </span>
                </button>
              )
            })}
            {showNewChannel ? (
              <div style={{ padding: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem',
                background: 'var(--bg-surface)', borderRadius: 'var(--radius)', marginTop: '0.3rem' }}>
                <input value={newChannelName} onChange={e => setNewChannelName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createChannel()}
                  placeholder="channel-name" autoFocus style={sidebarInputStyle} />
                <input value={newChannelTopic} onChange={e => setNewChannelTopic(e.target.value)} placeholder="Topic (optional)" style={sidebarInputStyle} />
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <input type="checkbox" checked={newChannelPrivate} onChange={e => setNewChannelPrivate(e.target.checked)} /> Private
                </label>
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button onClick={createChannel} style={smallBtnPrimary}>Create</button>
                  <button onClick={() => setShowNewChannel(false)} style={smallBtnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button onClick={() => setShowNewChannel(true)} style={{ ...addBtnStyle, flex: 1 }}>+ New</button>
                <button onClick={() => { fetchAllChannels(); setRightPanel('browse') }}
                  style={{ ...addBtnStyle, flex: 1 }}>Browse</button>
              </div>
            )}
          </>)}

          {/* DMs sidebar */}
          {view === 'dms' && (<>
            {showNewDM ? (
              <div style={{ marginBottom: '0.5rem', padding: '0.4rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)' }}>
                <input value={dmSearch} onChange={e => setDmSearch(e.target.value)} placeholder="Search users..." autoFocus style={sidebarInputStyle} />
                {dmSearchResults.map(u => (
                  <button key={u.nick} onClick={() => startDMWith(u.nick)} style={{
                    display: 'flex', width: '100%', textAlign: 'left', padding: '0.4rem 0.5rem',
                    alignItems: 'center', gap: '0.4rem', background: 'transparent',
                    color: 'var(--text-secondary)', fontSize: '0.78rem', borderRadius: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: u.online ? 'var(--accent-green, #4ade80)' : 'var(--text-muted)' }} />
                    {u.nick}
                  </button>
                ))}
                <button onClick={() => { setShowNewDM(false); setDmSearch('') }} style={smallBtnGhost}>Cancel</button>
              </div>
            ) : <button onClick={() => setShowNewDM(true)} style={addBtnStyle}>+ New Message</button>}
            {dmPartners.length === 0 && !showNewDM && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem', textAlign: 'center' }}>No conversations yet</p>}
            {dmPartners.map(p => (
              <button key={p.nick} onClick={() => { setActiveDM(p.nick); setActiveChannel(null); setActiveGroup(null) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.6rem',
                  background: activeDM === p.nick ? 'var(--bg-surface)' : 'transparent',
                  color: activeDM === p.nick ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderRadius: 'var(--radius)', fontSize: '0.82rem', marginBottom: '0.15rem' }}>
                {p.nick}
                {p.last_message && <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.last_message}</span>}
              </button>
            ))}
          </>)}

          {/* Groups sidebar */}
          {view === 'groups' && (<>
            {showNewGroup ? (
              <div style={{ marginBottom: '0.5rem', padding: '0.4rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Group name" autoFocus style={sidebarInputStyle} />
                <input value={groupMemberSearch} onChange={e => setGroupMemberSearch(e.target.value)} placeholder="Add members..." style={sidebarInputStyle} />
                {groupSearchResults.map(u => (
                  <button key={u.nick} onClick={() => { if (!newGroupMembers.includes(u.nick)) setNewGroupMembers([...newGroupMembers, u.nick]); setGroupMemberSearch('') }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.3rem 0.5rem', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{u.nick}</button>
                ))}
                {newGroupMembers.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
                    {newGroupMembers.map(m => (
                      <span key={m} onClick={() => setNewGroupMembers(newGroupMembers.filter(x => x !== m))}
                        style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem', background: 'var(--bg-elevated, var(--bg-deep))', borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}>{m} x</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button onClick={createGroup} style={smallBtnPrimary}>Create</button>
                  <button onClick={() => { setShowNewGroup(false); setNewGroupName(''); setNewGroupMembers([]) }} style={smallBtnGhost}>Cancel</button>
                </div>
              </div>
            ) : <button onClick={() => setShowNewGroup(true)} style={addBtnStyle}>+ New Group</button>}
            {groups.length === 0 && !showNewGroup && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem', textAlign: 'center' }}>No groups yet</p>}
            {groups.map(g => (
              <button key={g.id} onClick={() => { setActiveGroup(g.id); setActiveChannel(null); setActiveDM(null) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.6rem',
                  background: activeGroup === g.id ? 'var(--bg-surface)' : 'transparent',
                  color: activeGroup === g.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderRadius: 'var(--radius)', fontSize: '0.82rem', marginBottom: '0.15rem' }}>
                {g.name}<span style={{ float: 'right', fontSize: '0.65rem', color: 'var(--text-muted)' }}>{g.members.length}</span>
              </button>
            ))}
          </>)}

          {view === 'people' && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem' }}>{onlineUsers.length} online &middot; {directoryUsers.length} in workspace</p>}
          {view === 'email' && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem' }}>{inbox.length} message(s) in inbox</p>}
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, marginTop: announcements.length > 0 ? 32 : 0 }}>
        {/* People view */}
        {view === 'people' ? (
          <PeopleView
            peopleSearch={peopleSearch} setPeopleSearch={setPeopleSearch}
            showInviteDialog={showInviteDialog} setShowInviteDialog={setShowInviteDialog}
            inviteEmail={inviteEmail} setInviteEmail={setInviteEmail}
            inviteStatus={inviteStatus} createInviteLink={createInviteLink}
            sendInviteEmail={sendInviteEmail} setInviteStatus={setInviteStatus}
            peopleSearchResults={peopleSearchResults} onlineUsers={onlineUsers}
            directoryUsers={directoryUsers} startDMWith={startDMWith} emailUser={emailUser} />
        ) : view === 'email' ? (
          <EmailView emailTo={emailTo} setEmailTo={setEmailTo} emailSubject={emailSubject} setEmailSubject={setEmailSubject}
            emailBody={emailBody} setEmailBody={setEmailBody} emailSending={emailSending}
            emailStatus={emailStatus} sendEmail={sendEmail} inbox={inbox} />
        ) : !hasActive ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Select a {view === 'channels' ? 'channel' : view === 'dms' ? 'conversation' : 'group'} to start chatting
          </div>
        ) : (<>
          {/* Message header */}
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{activeLabel}</span>
              {activeTopicText && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>{activeTopicText}</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <button onClick={() => setShowSearch(!showSearch)} style={headerBtn}>Search</button>
              {view === 'channels' && <>
                <button onClick={() => { if (activeChannel) fetchPins(activeChannel); setRightPanel(rightPanel === 'pins' ? 'members' : 'pins'); setThreadParent(null) }} style={headerBtn}>Pins</button>
                <button onClick={() => setShowChannelSettings(!showChannelSettings)} style={headerBtn}>Settings</button>
              </>}
              {view === 'groups' && <>
                <button onClick={() => setShowGroupInvite(!showGroupInvite)} style={headerBtn}>Invite</button>
                <button onClick={leaveGroup} style={{ ...headerBtn, color: 'var(--accent-coral, #f87171)' }}>Leave</button>
              </>}
              {view === 'dms' && activeDM && <button onClick={() => emailUser(activeDM)} style={headerBtn}>Email</button>}
              {(view === 'channels' || view === 'groups') && (
                <button onClick={() => { setRightPanel(rightPanel === 'members' ? null : 'members'); setThreadParent(null) }} style={headerBtn}>
                  {rightPanel === 'members' ? 'Hide' : 'Members'}
                </button>
              )}
            </div>
          </div>

          {/* Search bar */}
          {showSearch && (
            <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-surface)', display: 'flex', gap: '0.5rem' }}>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && performSearch()} placeholder="Search messages..." autoFocus
                style={{ flex: 1, ...inputStyle, padding: '0.4rem 0.6rem', fontSize: '0.8rem' }} />
              <button onClick={performSearch} style={smallBtnPrimary}>Search</button>
              <button onClick={() => { setShowSearch(false); setSearchResults([]) }} style={smallBtnGhost}>Close</button>
            </div>
          )}
          {showSearch && searchResults.length > 0 && (
            <div style={{ maxHeight: 200, overflow: 'auto', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-surface)', padding: '0.5rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{searchResults.length} result(s)</div>
              {searchResults.map((m, i) => (
                <div key={m.id || i} style={{ padding: '0.3rem 0', fontSize: '0.78rem', borderBottom: '1px solid var(--glass-border)' }}>
                  <span style={{ fontWeight: 600 }}>{m.nick || m.sender}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.65rem' }}>{formatTimestamp(m.timestamp || m.created_at || '')}</span>
                  <div style={{ color: 'var(--text-secondary)' }}>{m.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Channel settings / group invite bars */}
          {showChannelSettings && view === 'channels' && (
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-surface)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input value={editTopic} onChange={e => setEditTopic(e.target.value)} placeholder="Edit topic..."
                style={{ flex: 1, ...inputStyle, padding: '0.4rem 0.6rem', fontSize: '0.8rem' }} />
              <button onClick={updateTopic} style={smallBtnPrimary}>Save</button>
              <button onClick={deleteChannel} style={{ ...smallBtnGhost, color: 'var(--accent-coral, #f87171)' }}>Delete</button>
            </div>
          )}
          {showGroupInvite && view === 'groups' && (
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-surface)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input value={groupInviteNick} onChange={e => setGroupInviteNick(e.target.value)} placeholder="Username to invite..."
                style={{ flex: 1, ...inputStyle, padding: '0.4rem 0.6rem', fontSize: '0.8rem' }} />
              <button onClick={inviteToGroup} style={smallBtnPrimary}>Invite</button>
            </div>
          )}

          {/* Messages + right panels */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Messages area */}
            <div style={{ flex: 1, overflow: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {loading && <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading...</div>}
              {!loading && messages.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No messages yet. Start the conversation!</div>}
              {messages.map((m, i) => {
                if (m.type === 'system' || m.type === 'join' || m.type === 'part') {
                  return <div key={m.id || i} style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', padding: '0.3rem 0' }}>{m.content}</div>
                }
                const prev = i > 0 ? messages[i - 1] : null
                const sameNick = prev && (prev.nick || prev.sender) === (m.nick || m.sender) && prev.type !== 'system'
                const prevTs = prev ? new Date(prev.timestamp || prev.created_at || 0) : null
                const curTs = new Date(m.timestamp || m.created_at || 0)
                const sameGroup = sameNick && prevTs && (curTs.getTime() - prevTs.getTime()) < 300000
                const showDate = !prev || (prevTs && curTs.toDateString() !== prevTs.toDateString())

                return (
                  <div key={m.id || i}>
                    {showDate && <div style={{ textAlign: 'center', padding: '0.75rem 0 0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{formatDateSeparator(m.timestamp || m.created_at || '')}</div>}
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: sameGroup ? '0.05rem 0' : '0.4rem 0',
                      opacity: m.optimistic ? 0.6 : m.failed ? 0.4 : 1, position: 'relative' }}
                      onMouseEnter={e => { const a = e.currentTarget.querySelector('[data-msg-actions]') as HTMLElement; if (a) a.style.display = 'flex' }}
                      onMouseLeave={e => { const a = e.currentTarget.querySelector('[data-msg-actions]') as HTMLElement; if (a) a.style.display = 'none' }}>
                      {sameGroup ? <div style={{ width: 28, flexShrink: 0 }} /> : (
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-elevated, var(--bg-surface))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0 }}>
                          {(m.nick || m.sender || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {!sameGroup && (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{m.nick || m.sender || 'Unknown'}</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{formatTimestamp(m.timestamp || m.created_at || '')}</span>
                            {m.pinned && <span style={{ fontSize: '0.6rem', color: 'var(--accent-primary)', fontWeight: 600 }}>PINNED</span>}
                          </div>
                        )}
                        {editingMessage === m.id ? (
                          <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.2rem' }}>
                            <input value={editContent} onChange={e => setEditContent(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEditMessage(); if (e.key === 'Escape') setEditingMessage(null) }}
                              autoFocus style={{ flex: 1, ...inputStyle, padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} />
                            <button onClick={saveEditMessage} style={smallBtnPrimary}>Save</button>
                            <button onClick={() => setEditingMessage(null)} style={smallBtnGhost}>Cancel</button>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            <RenderedContent content={m.content} />
                          </div>
                        )}
                        {m.failed && <span style={{ fontSize: '0.65rem', color: 'var(--accent-coral, #f87171)' }}>Failed to send</span>}
                        {m.reactions && m.reactions.length > 0 && (
                          <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                            {m.reactions.map((r, ri) => (
                              <button key={ri} onClick={() => m.id && addReaction(m.id, r.emoji)}
                                style={{ padding: '0.1rem 0.4rem', background: 'var(--bg-deep)', border: '1px solid var(--glass-border)',
                                  borderRadius: 10, fontSize: '0.72rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                <span>{r.emoji}</span><span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{r.count}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {m.thread_count != null && m.thread_count > 0 && (
                          <button onClick={() => openThread(m)} style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', background: 'transparent', padding: '0.15rem 0', fontWeight: 500 }}>
                            {m.thread_count} {m.thread_count === 1 ? 'reply' : 'replies'}
                          </button>
                        )}
                      </div>
                      {/* Hover actions */}
                      {m.id && !m.optimistic && view === 'channels' && (
                        <div data-msg-actions style={{ display: 'none', position: 'absolute', top: -4, right: 4, gap: '0.15rem',
                          background: 'var(--bg-surface)', border: '1px solid var(--glass-border)', borderRadius: 4, padding: '0.15rem' }}>
                          <button onClick={() => setReactionPickerMsg(reactionPickerMsg === m.id ? null : m.id!)} style={actionBtnStyle} title="React">{'\u{1F642}'}</button>
                          <button onClick={() => openThread(m)} style={actionBtnStyle} title="Thread">{'\u{1F4AC}'}</button>
                          <button onClick={() => m.id && pinMessage(m.id)} style={actionBtnStyle} title="Pin">{'\u{1F4CC}'}</button>
                          <button onClick={() => startEditMessage(m)} style={actionBtnStyle} title="Edit">{'\u{270F}\u{FE0F}'}</button>
                          <button onClick={() => m.id && deleteMessage(m.id)} style={{ ...actionBtnStyle, color: 'var(--accent-coral, #f87171)' }} title="Delete">{'\u{1F5D1}\u{FE0F}'}</button>
                        </div>
                      )}
                    </div>
                    {reactionPickerMsg === m.id && (
                      <div style={{ display: 'flex', gap: '0.2rem', padding: '0.3rem 0.5rem 0.3rem 2.5rem', flexWrap: 'wrap' }}>
                        {QUICK_EMOJIS.map(emoji => (
                          <button key={emoji} onClick={() => m.id && addReaction(m.id, emoji)}
                            style={{ fontSize: '1.1rem', padding: '0.2rem 0.35rem', background: 'var(--bg-surface)',
                              border: '1px solid var(--glass-border)', borderRadius: 6, cursor: 'pointer', lineHeight: 1 }}>{emoji}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Thread panel */}
            {threadParent && (
              <div style={{ width: 280, borderLeft: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                <div style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Thread</span>
                  <button onClick={() => setThreadParent(null)} style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '0.78rem' }}>Close</button>
                </div>
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-surface)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{threadParent.nick || threadParent.sender}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{threadParent.content}</div>
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: '0.5rem 0.75rem' }}>
                  {threadReplies.map((r, i) => (
                    <div key={r.id || i} style={{ marginBottom: '0.5rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600 }}>{r.nick || r.sender}
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem', fontSize: '0.6rem' }}>{formatTimestamp(r.timestamp || r.created_at || '')}</span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{r.content}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '0.3rem' }}>
                  <input value={threadInput} onChange={e => setThreadInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendThreadReply()} placeholder="Reply..."
                    style={{ flex: 1, ...inputStyle, padding: '0.35rem 0.5rem', fontSize: '0.78rem' }} />
                  <button onClick={sendThreadReply} disabled={!threadInput.trim()} style={{ ...smallBtnPrimary, opacity: threadInput.trim() ? 1 : 0.5 }}>Reply</button>
                </div>
              </div>
            )}

            {/* Pins panel */}
            {rightPanel === 'pins' && !threadParent && (
              <div style={{ width: 250, borderLeft: '1px solid var(--glass-border)', overflow: 'auto', padding: '0.75rem', flexShrink: 0 }}>
                <h4 style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  Pinned Messages ({pinnedMessages.length})
                </h4>
                {pinnedMessages.length === 0 && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center' }}>No pinned messages</p>}
                {pinnedMessages.map((p, i) => (
                  <div key={p.id || i} style={{ padding: '0.4rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', marginBottom: '0.3rem', border: '1px solid var(--glass-border)' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600 }}>{p.nick || p.sender}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.content}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{formatTimestamp(p.timestamp || p.created_at || '')}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Channel browser panel */}
            {rightPanel === 'browse' && !threadParent && (
              <div style={{ width: 280, borderLeft: '1px solid var(--glass-border)', overflow: 'auto', padding: '0.75rem', flexShrink: 0 }}>
                <h4 style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  Browse Channels ({allChannels.length})
                </h4>
                <button onClick={() => setRightPanel('members')} style={{ ...smallBtnGhost, marginBottom: '0.5rem' }}>Close</button>
                {allChannels.map(ch => {
                  const id = chId(ch)
                  const joined = channels.some(c => chId(c) === id)
                  return (
                    <div key={id} style={{ padding: '0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', marginBottom: '0.3rem', border: '1px solid var(--glass-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>#{id}</span>
                        {joined ? (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Joined</span>
                        ) : (
                          <button onClick={() => joinChannel(ch.name)} style={{ ...smallBtnPrimary, padding: '0.2rem 0.5rem' }}>Join</button>
                        )}
                      </div>
                      {ch.topic && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{ch.topic}</div>}
                      {ch.member_count != null && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{ch.member_count} members</div>}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Members panel */}
            {rightPanel === 'members' && !threadParent && contextPanelUsers.length > 0 && (
              <div style={{ width: 180, borderLeft: '1px solid var(--glass-border)', overflow: 'auto', padding: '0.75rem', flexShrink: 0 }}>
                <h4 style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  Members ({contextPanelUsers.length})
                </h4>
                {contextPanelUsers.map(u => (
                  <div key={u.nick} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%',
                      background: u.online ? 'var(--accent-green, #4ade80)' : u.status === 'away' ? '#fbbf24' : u.status === 'busy' ? 'var(--accent-coral, #f87171)' : 'var(--text-muted)',
                      flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nick}</span>
                    {u.is_agent && <span style={{ fontSize: '0.5rem', color: 'var(--accent-primary)', fontWeight: 700 }}>BOT</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Typing indicator */}
          {activeTyping.length > 0 && (
            <div style={{ padding: '0.2rem 1rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {activeTyping.join(', ')} {activeTyping.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}

          {/* Input */}
          <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {view === 'channels' && (
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '1rem', padding: '0.3rem', flexShrink: 0 }}
                title="Upload file">{uploading ? '\u{23F3}' : '\u{1F4CE}'}</button>
            )}
            <input value={input} onChange={e => { setInput(e.target.value); sendTypingIndicator() }}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder={`Message ${activeLabel}...`} disabled={sending}
              style={{ flex: 1, padding: '0.6rem 0.85rem', background: 'var(--bg-deep)',
                border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
                color: 'var(--text-primary)', fontSize: '0.85rem', opacity: sending ? 0.6 : 1 }} />
            <button onClick={sendMessage} disabled={sending || !input.trim()} style={{
              padding: '0.6rem 1rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)',
              borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 600,
              opacity: input.trim() && !sending ? 1 : 0.5 }}>{sending ? '...' : 'Send'}</button>
          </div>
        </>)}
      </div>
    </div>
  )
}

// ── Extracted sub-views ───────────────────────────────────────────────────

function PeopleView({ peopleSearch, setPeopleSearch, showInviteDialog, setShowInviteDialog,
  inviteEmail, setInviteEmail, inviteStatus, createInviteLink, sendInviteEmail, setInviteStatus,
  peopleSearchResults, onlineUsers, directoryUsers, startDMWith, emailUser }: any) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
        <input value={peopleSearch} onChange={(e: any) => setPeopleSearch(e.target.value)} placeholder="Search users..."
          style={{ flex: 1, padding: '0.55rem 0.85rem', background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.85rem' }} />
        <button onClick={() => setShowInviteDialog(true)} style={{ padding: '0.55rem 1rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)', borderRadius: 'var(--radius)', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Invite</button>
      </div>
      {showInviteDialog && (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Invite to Workspace</span>
            <button onClick={() => { setShowInviteDialog(false); setInviteStatus('') }} style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Close</button>
          </div>
          <button onClick={createInviteLink} style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem', background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.82rem', textAlign: 'left' }}>Copy Invite Link</button>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <input value={inviteEmail} onChange={(e: any) => setInviteEmail(e.target.value)} placeholder="Email address" style={{ flex: 1, ...inputStyle }} />
            <button onClick={sendInviteEmail} style={smallBtnPrimary}>Send</button>
          </div>
          {inviteStatus && <p style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', marginTop: '0.4rem' }}>{inviteStatus}</p>}
        </div>
      )}
      {peopleSearch && peopleSearchResults.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <SectionHeader>Search Results</SectionHeader>
          <div style={{ display: 'grid', gap: '0.4rem' }}>{peopleSearchResults.map((u: User) => <UserCard key={u.nick} user={u} onMessage={startDMWith} onEmail={emailUser} />)}</div>
        </div>
      )}
      {onlineUsers.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <SectionHeader>Online Now</SectionHeader>
          <div style={{ display: 'grid', gap: '0.4rem' }}>{onlineUsers.map((u: User) => <UserCard key={u.nick} user={{ ...u, online: true }} onMessage={startDMWith} onEmail={emailUser} />)}</div>
        </div>
      )}
      <div>
        <SectionHeader>Directory</SectionHeader>
        {directoryUsers.length === 0 ? <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '1rem', textAlign: 'center' }}>No members found</p> : (
          <div style={{ display: 'grid', gap: '0.4rem' }}>{directoryUsers.map((u: any) => (
            <UserCard key={u.nick || u.email || u.name} user={{ nick: u.nick || u.name || u.email, email: u.email, status: u.role }} onMessage={startDMWith} onEmail={emailUser} />
          ))}</div>
        )}
      </div>
    </div>
  )
}

function EmailView({ emailTo, setEmailTo, emailSubject, setEmailSubject, emailBody, setEmailBody, emailSending, emailStatus, sendEmail, inbox }: any) {
  return (
    <div style={{ padding: '1.5rem', maxWidth: 700, overflow: 'auto', flex: 1 }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Compose Email</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <input value={emailTo} onChange={(e: any) => setEmailTo(e.target.value)} placeholder="To (comma-separated emails)" style={inputStyle} />
        <input value={emailSubject} onChange={(e: any) => setEmailSubject(e.target.value)} placeholder="Subject" style={inputStyle} />
        <textarea value={emailBody} onChange={(e: any) => setEmailBody(e.target.value)} placeholder="Message body..." rows={10}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={sendEmail} disabled={emailSending || !emailTo || !emailSubject || !emailBody}
            style={{ padding: '0.6rem 1.5rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)', borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 600, opacity: (!emailTo || !emailSubject || !emailBody) ? 0.5 : 1 }}>
            {emailSending ? 'Sending...' : 'Send Email'}
          </button>
          {emailStatus && <span style={{ fontSize: '0.8rem', color: emailStatus.startsWith('Failed') ? 'var(--accent-coral, #f87171)' : 'var(--accent-green, #4ade80)' }}>{emailStatus}</span>}
        </div>
      </div>
      {inbox.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Recent Inbox</h4>
          {inbox.slice(0, 10).map((m: any, i: number) => (
            <div key={i} style={{ padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', marginBottom: '0.4rem', border: '1px solid var(--glass-border)' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{m.subject || '(no subject)'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.from || m.sender || 'unknown'} &middot; {m.date || m.received_at || ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── RenderedContent — lightweight markdown ──────────────────────────────

function RenderedContent({ content }: { content: string }) {
  if (!content) return null
  const parts: (string | React.ReactElement)[] = []
  const rx = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|(@\w+)/g
  let last = 0, key = 0, match: RegExpExecArray | null
  while ((match = rx.exec(content)) !== null) {
    if (match.index > last) parts.push(content.slice(last, match.index))
    if (match[1]) parts.push(<strong key={++key}>{match[2]}</strong>)
    else if (match[3]) parts.push(<em key={++key}>{match[4]}</em>)
    else if (match[5]) parts.push(<code key={++key} style={{ padding: '0.1rem 0.3rem', background: 'var(--bg-deep)', borderRadius: 3, fontSize: '0.78rem', fontFamily: 'monospace' }}>{match[6]}</code>)
    else if (match[7]) parts.push(<span key={++key} style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{match[7]}</span>)
    last = match.index + match[0].length
  }
  if (last < content.length) parts.push(content.slice(last))
  return <>{parts}</>
}

function SectionHeader({ children }: { children: string }) {
  return <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</h4>
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}

function formatDateSeparator(ts: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === now.toDateString()) return 'Today'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  } catch { return '' }
}

function UserCard({ user, onMessage, onEmail }: { user: User; onMessage: (nick: string) => void; onEmail: (nick: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated, var(--bg-deep))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0, color: user.is_agent ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
        {(user.nick || '?').charAt(0).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{user.nick}</span>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: user.online ? 'var(--accent-green, #4ade80)' : 'var(--text-muted)', flexShrink: 0 }} />
          {user.is_agent && <span style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)', borderRadius: 8, fontWeight: 600 }}>BOT</span>}
        </div>
        {user.status && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{user.status}</div>}
      </div>
      <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
        <button onClick={() => onMessage(user.nick)} style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Message</button>
        <button onClick={() => onEmail(user.nick)} style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Email</button>
      </div>
    </div>
  )
}

// ── Shared styles ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '0.6rem 0.85rem', background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.85rem',
}
const sidebarInputStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem', background: 'var(--bg-deep)', border: '1px solid var(--glass-border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: '0.75rem', width: '100%',
}
const smallBtnPrimary: React.CSSProperties = {
  padding: '0.35rem 0.6rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
}
const smallBtnGhost: React.CSSProperties = {
  padding: '0.35rem 0.6rem', background: 'transparent', color: 'var(--text-muted)', borderRadius: 4, fontSize: '0.7rem',
}
const addBtnStyle: React.CSSProperties = {
  width: '100%', padding: '0.4rem', background: 'transparent', color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'left',
}
const actionBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: '0.15rem 0.3rem', lineHeight: 1,
}
const headerBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--text-muted)', fontSize: '0.78rem', padding: '0.3rem 0.5rem',
}
