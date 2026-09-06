import { useEffect, useState } from 'react'

export interface MailMessage {
  id: string
  from: string
  to?: string
  subject: string
  body?: string
  date: string
  read: boolean
  thread_id?: string
  labels?: string[]
}

interface MailResponse {
  messages?: MailMessage[]
  source?: string
  error?: string
}

export interface UseMailState {
  messages: MailMessage[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Fetch mail from the inbox endpoint. Handles errors gracefully and reports them
 * clearly so the UI never renders a silent no-op.
 */
export function useMail(endpoint = '/api/platform/email/inbox'): UseMailState {
  const [messages, setMessages] = useState<MailMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMail = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'same-origin',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data: MailResponse = await response.json()

      if (data.error) {
        setError(`Mail service error: ${data.error}`)
        setMessages([])
        return
      }

      if (!data.messages || !Array.isArray(data.messages)) {
        setError('Mail endpoint returned an unexpected format.')
        setMessages([])
        return
      }

      setMessages(data.messages)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`Could not reach the mail service: ${message}`)
      setMessages([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMail()
  }, [endpoint])

  return {
    messages,
    loading,
    error,
    refresh: fetchMail,
  }
}
