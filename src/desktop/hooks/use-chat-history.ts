'use client'

// ============================================================================
// CHAT HISTORY HOOK — Persists AeonMessage[] to localStorage via SparkKV
// ============================================================================
// Usage:
//   const { messages, addMessage, replaceMessages, clearHistory } = useChatHistory('sidepanel-genesis')
//
// Messages are keyed per session (typically per-agent). Caps at MAX_MESSAGES
// to avoid hitting the ~5MB localStorage limit.

import { useCallback, useRef } from 'react'
import { useSparkKV } from '../lib/spark-kv'
import type { AeonMessage } from '../types/chat'

const MAX_MESSAGES = 200

interface SerializedMessage extends Omit<AeonMessage, 'timestamp'> {
    timestamp: number
}

function serialize(msg: AeonMessage): SerializedMessage {
    return {
        ...msg,
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp
            : msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
    }
}

function deserialize(msg: SerializedMessage): AeonMessage {
    return { ...msg, timestamp: msg.timestamp }
}

export function useChatHistory(sessionKey: string) {
    const storageKey = `chat:history:${sessionKey}`
    const [stored, setStored, removeStored] = useSparkKV<SerializedMessage[]>(storageKey, [])
    const storedRef = useRef(stored)
    storedRef.current = stored

    const messages: AeonMessage[] = (stored || []).map(deserialize)

    const addMessage = useCallback((msg: AeonMessage) => {
        setStored((prev: SerializedMessage[]) => {
            const arr = Array.isArray(prev) ? prev : []
            const next = [...arr, serialize(msg)]
            // Cap to MAX_MESSAGES, keeping most recent
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
        })
    }, [setStored])

    const replaceMessages = useCallback((msgs: AeonMessage[]) => {
        const capped = msgs.slice(-MAX_MESSAGES)
        setStored(capped.map(serialize))
    }, [setStored])

    const updateMessages = useCallback((updater: (msgs: AeonMessage[]) => AeonMessage[]) => {
        setStored((prev: SerializedMessage[]) => {
            const current = (Array.isArray(prev) ? prev : []).map(deserialize)
            const updated = updater(current)
            return updated.slice(-MAX_MESSAGES).map(serialize)
        })
    }, [setStored])

    const deleteMessage = useCallback((id: string) => {
        setStored((prev: SerializedMessage[]) => {
            const arr = Array.isArray(prev) ? prev : []
            return arr.filter(m => m.id !== id)
        })
    }, [setStored])

    const editMessage = useCallback((id: string, content: string) => {
        setStored((prev: SerializedMessage[]) => {
            const arr = Array.isArray(prev) ? prev : []
            return arr.map(m => m.id === id ? { ...m, content } : m)
        })
    }, [setStored])

    const clearHistory = useCallback(() => {
        removeStored()
    }, [removeStored])

    return { messages, addMessage, replaceMessages, updateMessages, deleteMessage, editMessage, clearHistory }
}
