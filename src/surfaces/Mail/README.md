# AitherMail Surface

A working mail inbox for the Company Room. Displays real mail data only, with plain-language error reporting for any issues.

## Features

- **Real data only**: Fetches from `/api/platform/email/inbox` (or custom endpoint)
- **Error transparency**: Reports missing endpoints, HTTP errors, format errors, and network issues in plain language
- **Message reading**: View full message details (from, subject, date, body) without leaving the room
- **Drop into conversation**: Cite a message in the room via the "Drop into room" button
- **Responsive**: Works as a narrow context panel (~260–340px) in the room's title block and scales to standalone viewing
- **Accessible**: Keyboard navigable, visible focus indicators, respects `prefers-reduced-motion`
- **Visual coherence**: Uses Company Room's drafting sheet language (mono utility type, humanist body, construction yellow/blueprint blue palette)

## Usage

```tsx
import { MailSurface } from 'awkit/src/surfaces/Mail'
import 'awkit/src/surfaces/Mail/mail.css'

export function MyComponent() {
  return (
    <MailSurface
      endpoint="/api/platform/email/inbox"  // optional; defaults to this
      onCite={(text) => {
        // Called when user clicks "Drop into room"
        console.log('Cited:', text)
      }}
      onClose={() => {
        // Called when surface is dismissed (context mode only)
        console.log('Closed')
      }}
    />
  )
}
```

## API

### MailSurface Props

- `endpoint?: string` — GET endpoint returning `{ messages: [...], source?: string, error?: string }`. Defaults to `/api/platform/email/inbox`.
- `onCite: (text: string) => void` — Called when user clicks "Drop into room" on a message.
- `onClose?: () => void` — Called when the close button is clicked (only shown if onClose is provided).

### useMail Hook

```tsx
import { useMail } from 'awkit/src/surfaces/Mail'

const { messages, loading, error, refresh } = useMail('/api/platform/email/inbox')
```

Returns:
- `messages: MailMessage[]` — Array of mail messages.
- `loading: boolean` — True while fetching.
- `error: string | null` — Error message if fetch failed.
- `refresh: () => Promise<void>` — Manually refetch messages.

## Expected Endpoint Format

The mail endpoint should return:

```json
{
  "messages": [
    {
      "id": "msg-1",
      "from": "alice@example.com",
      "to": "bob@example.com",
      "subject": "Hello",
      "body": "This is a message.",
      "date": "2026-07-24T10:00:00Z",
      "read": false,
      "thread_id": "thread-1",
      "labels": ["inbox"]
    }
  ],
  "source": "relay"
}
```

Or if an error occurs:

```json
{
  "error": "Mail service unavailable"
}
```

## Error Handling

The component handles errors gracefully and displays them to the user:

- **HTTP errors**: Shows the status code and advises to try again
- **Missing endpoint**: Reports that the endpoint returned an unexpected format
- **Network errors**: Reports the network error and advises to try again
- **Missing data**: If endpoint doesn't return `messages` array, shows a format error

The UI never renders a plausible-looking empty list when there's an error — it always reports the problem clearly.

## Styling

Uses Company Room CSS custom properties for theming:

- `--ink`, `--ink-soft`, `--graphite` — Text colors
- `--stake`, `--datum`, `--alarm` — Accent colors (yellow, blue, red)
- `--rule`, `--rule-soft` — Border colors
- `--sheet-void`, `--sheet-base`, `--sheet-panel` — Background colors
- `--font-draft`, `--font-hand` — Typography (monospace utility, humanist body)

All values fall back to sensible defaults if the container doesn't provide theme variables.

## Accessibility

- ✓ Keyboard navigable (buttons, focus management)
- ✓ Visible focus indicators on all interactive elements
- ✓ Respects `prefers-reduced-motion` media query
- ✓ No horizontal page scroll
- ✓ Semantic HTML (buttons, lists, sections)
- ✓ Clear, user-side vocabulary in copy
