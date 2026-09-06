/**
 * useSyncedSpeech -- Sentence-chunked typewriter + TTS sync hook.
 * Direct copy from Veil's use-synced-speech.ts -- zero external deps, pure React.
 */

import { useState, useRef, useCallback, useEffect } from 'react'

export interface SyncedSpeechOptions {
  voiceEnabled: boolean
  speakSentence?: (sentence: string) => Promise<void>
  onComplete?: () => void
  baseCharDelay?: number
  minCharDelay?: number
  maxCharDelay?: number
}

export interface SyncedSpeechState {
  displayText: string
  isTyping: boolean
  isSpeaking: boolean
  isComplete: boolean
  currentSentenceIndex: number
  totalSentences: number
  skipToEnd: () => void
  startMessage: (fullText: string) => void
  cancel: () => void
}

function splitIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return []

  const raw = text
    .split(/(?<=[.!?…])\s+|(?<=\.{3})\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean)

  if (raw.length === 0) return [text.trim()]

  const merged: string[] = []
  for (const segment of raw) {
    if (merged.length > 0 && segment.length < 10 && !segment.match(/[.!?]$/)) {
      merged[merged.length - 1] += ' ' + segment
    } else {
      merged.push(segment)
    }
  }

  return merged.length > 0 ? merged : [text.trim()]
}

function estimateTtsDurationMs(sentence: string, ttsRate = 1.0): number {
  const wordCount = sentence.split(/\s+/).length
  const BASE_WPM = 160
  const effectiveWPM = BASE_WPM * ttsRate
  const msPerWord = 60_000 / effectiveWPM
  return Math.max(400, wordCount * msPerWord)
}

export function useSyncedSpeech(options: SyncedSpeechOptions): SyncedSpeechState {
  const {
    voiceEnabled,
    speakSentence,
    onComplete,
    baseCharDelay = 12,
    minCharDelay = 8,
    maxCharDelay = 60,
  } = options

  const [displayText, setDisplayText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isComplete, setIsComplete] = useState(true)
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0)
  const [totalSentences, setTotalSentences] = useState(0)

  const sentencesRef = useRef<string[]>([])
  const fullTextRef = useRef('')
  const cancelledRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const speakingPromiseRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current as unknown as number)
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const typeSentence = useCallback((
    sentence: string,
    precedingText: string,
    charDelay: number,
  ): Promise<void> => {
    return new Promise((resolve) => {
      let charIndex = 0
      let startTime: number | null = null
      setIsTyping(true)

      const spacer = precedingText ? ' ' : ''

      const tick = (timestamp: number) => {
        if (cancelledRef.current) {
          resolve()
          return
        }

        if (startTime === null) startTime = timestamp

        const elapsed = timestamp - startTime
        const targetChars = Math.min(sentence.length, Math.floor(elapsed / charDelay) + 1)

        if (targetChars > charIndex) {
          charIndex = targetChars
          setDisplayText(precedingText + spacer + sentence.slice(0, charIndex))
        }

        if (charIndex >= sentence.length) {
          setIsTyping(false)
          timerRef.current = null
          resolve()
        } else {
          timerRef.current = requestAnimationFrame(tick) as unknown as ReturnType<typeof setTimeout>
        }
      }

      timerRef.current = requestAnimationFrame(tick) as unknown as ReturnType<typeof setTimeout>
    })
  }, [])

  const processSentences = useCallback(async (sentences: string[]) => {
    let accumulated = ''

    for (let i = 0; i < sentences.length; i++) {
      if (cancelledRef.current) break

      const sentence = sentences[i]
      setCurrentSentenceIndex(i)

      let charDelay = baseCharDelay
      if (voiceEnabled && speakSentence) {
        const estimatedMs = estimateTtsDurationMs(sentence)
        charDelay = Math.max(minCharDelay, Math.min(maxCharDelay, estimatedMs / sentence.length))
      }

      const typePromise = typeSentence(sentence, accumulated, charDelay)

      let speakPromise: Promise<void> = Promise.resolve()
      if (voiceEnabled && speakSentence) {
        setIsSpeaking(true)
        speakPromise = speakSentence(sentence).catch(err => {
          console.warn('[SyncedSpeech] TTS error for sentence:', err)
        }).finally(() => {
          setIsSpeaking(false)
        })
        speakingPromiseRef.current = speakPromise
      }

      await Promise.all([typePromise, speakPromise])

      if (cancelledRef.current) break

      const spacer = accumulated ? ' ' : ''
      accumulated = accumulated + spacer + sentence
    }

    if (!cancelledRef.current) {
      setIsComplete(true)
      setIsTyping(false)
      setIsSpeaking(false)
      onComplete?.()
    }
  }, [voiceEnabled, speakSentence, onComplete, baseCharDelay, minCharDelay, maxCharDelay, typeSentence])

  const startMessage = useCallback((fullText: string) => {
    cancelledRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)

    setTimeout(() => {
      cancelledRef.current = false
      fullTextRef.current = fullText
      const sentences = splitIntoSentences(fullText)
      sentencesRef.current = sentences

      setDisplayText('')
      setIsTyping(true)
      setIsSpeaking(false)
      setIsComplete(false)
      setCurrentSentenceIndex(0)
      setTotalSentences(sentences.length)

      processSentences(sentences)
    }, 0)
  }, [processSentences])

  const skipToEnd = useCallback(() => {
    cancelledRef.current = true
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current as unknown as number)
      clearTimeout(timerRef.current)
    }

    setDisplayText(fullTextRef.current)
    setIsTyping(false)
    setIsSpeaking(false)
    setIsComplete(true)
    setCurrentSentenceIndex(sentencesRef.current.length)

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current as unknown as number)
      clearTimeout(timerRef.current)
    }

    setDisplayText('')
    setIsTyping(false)
    setIsSpeaking(false)
    setIsComplete(true)
    setCurrentSentenceIndex(0)
    setTotalSentences(0)
    fullTextRef.current = ''
    sentencesRef.current = []

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  return {
    displayText,
    isTyping,
    isSpeaking,
    isComplete,
    currentSentenceIndex,
    totalSentences,
    skipToEnd,
    startMessage,
    cancel,
  }
}
