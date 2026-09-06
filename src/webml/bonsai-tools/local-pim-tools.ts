// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * Local PIM tools — the agent works YOUR data, on YOUR device, no login, no fleet.
 *
 * These make the browser agent genuinely useful from the first anonymous visit: "add a
 * note", "what's on my calendar today", "remind me tomorrow at 3pm" all write the SAME
 * IndexedDB stores the Calendar and Notes OS apps read — so the agent's actions appear in
 * the apps instantly, and the apps' edits are visible to the agent.
 *
 * Failure discipline (owner rule: NO silent fallbacks): every storage error returns an
 * explicit "could not save / could not load — <reason>" string, never a cheerful empty
 * success. A tool that says "saved" when nothing was written is the worst possible answer.
 *
 * Merged into BONSAI_TOOLS (registry.ts) so getToolDefinitions() and executeTool() pick
 * them up automatically.
 */

import type { ToolFunction } from '../bonsai/tokenizer/chat_template'
import type { RegisteredTool } from './registry'
import {
  createNote as storeCreateNote,
  listNotes as storeListNotes,
  searchNotes as storeSearchNotes,
  getNote as storeGetNote,
  updateNote as storeUpdateNote,
  deleteNote as storeDeleteNote,
  createEvent as storeCreateEvent,
  listEvents as storeListEvents,
  eventsForDay as storeEventsForDay,
  createTask as storeCreateTask,
  listTasks as storeListTasks,
  getTask as storeGetTask,
  updateTask as storeUpdateTask,
  deleteTask as storeDeleteTask,
  createKbItem as storeCreateKbItem,
  searchKbItems as storeSearchKbItems,
  getKbItem as storeGetKbItem,
} from '../local-pim/store'

const CLIFF = ' (Your data stays on this device and is never sent anywhere.)'

/* ── executors ────────────────────────────────────────────────────────── */

async function execNotesCreate(args: Record<string, any>): Promise<string> {
  const title = String(args.title ?? '').trim()
  const body = String(args.body ?? '').trim()
  if (!title && !body) {
    return 'Error: pass title=<title> and/or body=<text> to create a note.'
  }
  try {
    const note = await storeCreateNote({
      title: title || 'Untitled',
      body,
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    })
    return `Saved note "${note.title}" (id ${note.id.slice(0, 8)}).${CLIFF}`
  } catch (e) {
    return `I could not save that note: on-device storage refused the write (${(e as Error).message}). ` +
      'This is usually private browsing or blocked site storage.'
  }
}

async function execNotesSearch(args: Record<string, any>): Promise<string> {
  const q = String(args.query ?? '').trim()
  try {
    const notes = await (q ? storeSearchNotes(q) : storeListNotes())
    if (notes.length === 0) {
      return q
        ? `No notes match "${q}". Nothing has been saved that says that yet.`
        : 'No notes yet. Tell me something worth keeping and I will save it.'
    }
    // The FULL id is included so the agent can act on a hit (notes_update/notes_delete
    // key on id). A truncated id is unusable for that and silently fails lookups.
    const lines = notes.slice(0, 8).map((n) => {
      const snippet = n.body.trim().replace(/\s+/g, ' ').slice(0, 120)
      return `- ${n.title}${snippet ? ': ' + snippet : ''}  (id: ${n.id})`
    })
    return `${notes.length} note(s)${q ? ` matching "${q}"` : ''}:\n${lines.join('\n')}`
  } catch (e) {
    return `I could not read your notes: on-device storage refused the read (${(e as Error).message}).`
  }
}

async function execNotesGet(args: Record<string, any>): Promise<string> {
  const id = String(args.id ?? '').trim()
  try {
    // id wins; otherwise search by the id-as-query and take the best match.
    const note = id
      ? await storeGetNote(id)
      : null
    const match = note ?? (await storeSearchNotes(id))[0] ?? null
    if (!match) return `No note found for ${id ? `id "${id}"` : 'that query'}.`
    return `# ${match.title}\n\n${match.body || '(empty)'}`
  } catch (e) {
    return `I could not read that note (${(e as Error).message}).`
  }
}

async function execNotesUpdate(args: Record<string, any>): Promise<string> {
  const id = String(args.id ?? '').trim()
  if (!id) return 'Error: pass id=<note id> to update a note.'
  const title = args.title !== undefined ? String(args.title).trim() : undefined
  const body = args.body !== undefined ? String(args.body).trim() : undefined
  if (title === undefined && body === undefined) {
    return 'Error: pass title=<new title> and/or body=<new body> to update a note.'
  }
  try {
    const updated = await storeUpdateNote(id, { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) })
    if (!updated) return `No note with id "${id}".`
    return `Updated note "${updated.title}".`
  } catch (e) {
    return `I could not update that note (${(e as Error).message}).`
  }
}

async function execNotesDelete(args: Record<string, any>): Promise<string> {
  const id = String(args.id ?? '').trim()
  if (!id) return 'Error: pass id=<note id> to delete a note.'
  try {
    const store = await import('../local-pim/store')
    const existing = await store.getNote(id)
    if (!existing) return `No note with id "${id}".`
    await storeDeleteNote(id)
    return `Deleted note "${existing.title}".`
  } catch (e) {
    return `I could not delete that note (${(e as Error).message}).`
  }
}

async function execCalendarToday(_args: Record<string, any>): Promise<string> {
  try {
    const events = await storeEventsForDay(new Date())
    if (events.length === 0) {
      return 'Nothing scheduled today. A clear day — want me to plan something?'
    }
    const lines = events
      .sort((a, b) => (a.start > b.start ? 1 : -1))
      .map((e) => {
        const t = new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        return `- ${t}  ${e.title}${e.location ? ` @ ${e.location}` : ''}`
      })
    return `Today's agenda (${events.length}):\n${lines.join('\n')}`
  } catch (e) {
    return `I could not read your calendar (${(e as Error).message}).`
  }
}

async function execCalendarList(args: Record<string, any>): Promise<string> {
  const from = String(args.from ?? '').trim()
  const to = String(args.to ?? '').trim()
  try {
    const events = await storeListEvents(from || undefined, to || undefined)
    if (events.length === 0) {
      return 'No events in that range.'
    }
    const lines = events
      .sort((a, b) => (a.start > b.start ? 1 : -1))
      .map((e) => `- ${new Date(e.start).toLocaleString()}  ${e.title}`)
    return `${events.length} event(s):\n${lines.join('\n')}`
  } catch (e) {
    return `I could not read your calendar (${(e as Error).message}).`
  }
}

async function execCalendarCreateEvent(args: Record<string, any>): Promise<string> {
  const title = String(args.title ?? '').trim()
  if (!title) return 'Error: pass title=<event title> to create an event.'
  const whenRaw = String(args.when ?? args.start ?? '').trim()
  let start: Date
  if (whenRaw) {
    const parsed = new Date(whenRaw)
    if (isNaN(parsed.getTime())) {
      return `Error: could not parse "${whenRaw}" as a date/time. Pass an ISO string ` +
        'like "2026-08-07T15:00:00" (the current time is available from get_current_time).'
    }
    start = parsed
  } else {
    // No time given → default to one hour from now (a sensible "remind me soon").
    start = new Date(Date.now() + 60 * 60 * 1000)
  }
  const durationMin = Math.max(1, Number(args.durationMin ?? args.duration ?? 60) || 60)
  const end = new Date(start.getTime() + durationMin * 60 * 1000)
  try {
    await storeCreateEvent({
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      location: args.location ? String(args.location) : undefined,
      notes: args.notes ? String(args.notes) : undefined,
    })
    const when = start.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    return `Scheduled "${title}" for ${when} (${durationMin} min).${CLIFF}`
  } catch (e) {
    return `I could not save that event (${(e as Error).message}).`
  }
}

async function execTasksAdd(args: Record<string, any>): Promise<string> {
  const title = String(args.title ?? '').trim()
  if (!title) return 'Error: pass title=<task> to add a task.'
  let due: string | undefined
  if (args.due !== undefined && String(args.due).trim()) {
    const parsed = new Date(String(args.due).trim())
    if (isNaN(parsed.getTime())) {
      return `Error: could not parse "${args.due}" as a due date. Pass an ISO string ` +
        'like "2026-08-07T15:00:00" (get_current_time tells you what time it is now).'
    }
    due = parsed.toISOString()
  }
  try {
    const task = await storeCreateTask({
      title,
      due,
      notes: args.notes ? String(args.notes) : undefined,
    })
    return `Added task "${task.title}"${due ? ` due ${new Date(due).toLocaleString()}` : ''} (id ${task.id}).${CLIFF}`
  } catch (e) {
    return `I could not save that task: on-device storage refused the write (${(e as Error).message}).`
  }
}

async function execTasksList(_args: Record<string, any>): Promise<string> {
  try {
    const tasks = await storeListTasks()
    if (tasks.length === 0) {
      return 'No tasks yet. Tell me what needs doing and I will track it.'
    }
    const open = tasks.filter((t) => !t.done)
    const lines = open.slice(0, 10).map((t) => {
      const due = t.due ? `  (due ${new Date(t.due).toLocaleString()})` : ''
      return `- ${t.title}${due}  (id: ${t.id})`
    })
    const doneCount = tasks.length - open.length
    return `${open.length} open task(s)${doneCount ? `, ${doneCount} done` : ''}:\n${lines.join('\n') || '(all done!)'}`
  } catch (e) {
    return `I could not read your tasks (${(e as Error).message}).`
  }
}

async function execTasksComplete(args: Record<string, any>): Promise<string> {
  const id = String(args.id ?? '').trim()
  if (!id) return 'Error: pass id=<task id> (from tasks_list) to complete a task.'
  try {
    const updated = await storeUpdateTask(id, { done: true })
    if (!updated) return `No task with id "${id}".`
    return `Done: "${updated.title}" ✓`
  } catch (e) {
    return `I could not update that task (${(e as Error).message}).`
  }
}

async function execTasksDelete(args: Record<string, any>): Promise<string> {
  const id = String(args.id ?? '').trim()
  if (!id) return 'Error: pass id=<task id> to delete a task.'
  try {
    const existing = await storeGetTask(id)
    if (!existing) return `No task with id "${id}".`
    await storeDeleteTask(id)
    return `Deleted task "${existing.title}".`
  } catch (e) {
    return `I could not delete that task (${(e as Error).message}).`
  }
}

async function execKbSave(args: Record<string, any>): Promise<string> {
  const title = String(args.title ?? '').trim()
  const content = String(args.content ?? '').trim()
  if (!title && !content) {
    return 'Error: pass title=<title> and/or content=<what to remember> to save to the knowledge base.'
  }
  try {
    const item = await storeCreateKbItem({
      title: title || 'Untitled',
      content,
      sourceUrl: args.sourceUrl ? String(args.sourceUrl) : undefined,
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    })
    return `Saved "${item.title}" to your knowledge base (id ${item.id}).${CLIFF}`
  } catch (e) {
    return `I could not save that: on-device storage refused the write (${(e as Error).message}).`
  }
}

async function execKbSearch(args: Record<string, any>): Promise<string> {
  const q = String(args.query ?? '').trim()
  try {
    const items = await storeSearchKbItems(q)
    if (items.length === 0) {
      return q
        ? `Nothing in your knowledge base matches "${q}".`
        : 'Your knowledge base is empty. Say "save this" about anything worth keeping.'
    }
    const lines = items.slice(0, 8).map((i) => {
      const snippet = i.content.trim().replace(/\s+/g, ' ').slice(0, 120)
      const src = i.sourceUrl ? `  [${i.sourceUrl}]` : ''
      return `- ${i.title}${snippet ? ': ' + snippet : ''}${src}  (id: ${i.id})`
    })
    return `${items.length} item(s)${q ? ` matching "${q}"` : ''}:\n${lines.join('\n')}`
  } catch (e) {
    return `I could not search your knowledge base (${(e as Error).message}).`
  }
}

async function execKbGet(args: Record<string, any>): Promise<string> {
  const id = String(args.id ?? '').trim()
  if (!id) return 'Error: pass id=<item id> (from kb_search) to read an item.'
  try {
    const item = await storeGetKbItem(id)
    if (!item) return `No knowledge-base item with id "${id}".`
    const src = item.sourceUrl ? `\nSource: ${item.sourceUrl}` : ''
    return `# ${item.title}${src}\n\n${item.content || '(empty)'}`
  } catch (e) {
    return `I could not read that item (${(e as Error).message}).`
  }
}

/* ── definitions ──────────────────────────────────────────────────────── */

export const LOCAL_PIM_TOOLS: Record<string, RegisteredTool> = {
  notes_create: {
    definition: {
      name: 'notes_create',
      description:
        'Save a note on this device. Use it whenever the person asks you to remember a '
        + 'task, a fact, a thought, or anything worth keeping, OR when they say "note '
        + 'this down". Notes are stored locally and appear in their Notes app.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title. Optional but preferred.' },
          body: { type: 'string', description: 'The note content, markdown allowed.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        },
      },
    },
    execute: execNotesCreate,
  },
  notes_search: {
    definition: {
      name: 'notes_search',
      description:
        'Search the person\'s saved notes on this device by keyword. Use it before '
        + 'answering anything that might be in their notes, and when they ask "what did '
        + 'I note about X". Without a query it returns the most recent notes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for (title, body, or tag).' },
        },
      },
    },
    execute: execNotesSearch,
  },
  notes_get: {
    definition: {
      name: 'notes_get',
      description: 'Read a full note by its id, or the best match for a search.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The note id (from notes_search).' },
        },
      },
    },
    execute: execNotesGet,
  },
  notes_update: {
    definition: {
      name: 'notes_update',
      description:
        'Edit an existing note by its id. Use it when the person asks you to change or '
        + 'correct a note they already have. Pass only the fields you want to change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The note id (from notes_search).' },
          title: { type: 'string', description: 'New title (omit to keep).' },
          body: { type: 'string', description: 'New body (omit to keep).' },
        },
        required: ['id'],
      },
    },
    execute: execNotesUpdate,
  },
  notes_delete: {
    definition: {
      name: 'notes_delete',
      description: 'Delete a note by its id. Confirm before using.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The note id.' },
        },
        required: ['id'],
      },
    },
    execute: execNotesDelete,
  },
  calendar_today: {
    definition: {
      name: 'calendar_today',
      description:
        'Show today\'s agenda from the person\'s local calendar. Use it when they ask '
        + '"what\'s on my calendar" or "what am I doing today".',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: execCalendarToday,
  },
  calendar_list: {
    definition: {
      name: 'calendar_list',
      description:
        'List calendar events in a date range. `from`/`to` are ISO strings; omitted means '
        + 'all events. Prefer calendar_today for "today".',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO start of range, e.g. "2026-08-07".' },
          to: { type: 'string', description: 'ISO end of range.' },
        },
      },
    },
    execute: execCalendarList,
  },
  calendar_create_event: {
    definition: {
      name: 'calendar_create_event',
      description:
        'Create an event on the person\'s local calendar. Use it when they ask you to '
        + '"schedule", "book", "remind me", or set a meeting. `when` is an ISO string like '
        + '"2026-08-07T15:00:00"; get_current_time tells you what time it is now. '
        + 'Omit `when` to schedule one hour from now.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The event title, e.g. "Standup".' },
          when: { type: 'string', description: 'ISO start time, e.g. "2026-08-07T15:00:00".' },
          durationMin: { type: 'number', description: 'Duration in minutes (default 60).' },
          location: { type: 'string', description: 'Optional location.' },
        },
        required: ['title'],
      },
    },
    execute: execCalendarCreateEvent,
  },
  tasks_add: {
    definition: {
      name: 'tasks_add',
      description:
        'Add a task/to-do on this device. Use it when the person asks you to track '
        + 'something to do — "remind me to", "I need to", "add to my list". Tasks appear '
        + 'in their Tasks app. `due` is an optional ISO time.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What needs doing, e.g. "Email the landlord".' },
          due: { type: 'string', description: 'Optional ISO due time, e.g. "2026-08-07T15:00:00".' },
          notes: { type: 'string', description: 'Optional detail.' },
        },
        required: ['title'],
      },
    },
    execute: execTasksAdd,
  },
  tasks_list: {
    definition: {
      name: 'tasks_list',
      description:
        'List the person\'s open tasks (nearest due first). Use it when they ask "what\'s '
        + 'on my list", "what do I need to do", or before adding a possible duplicate.',
      parameters: { type: 'object', properties: {} },
    },
    execute: execTasksList,
  },
  tasks_complete: {
    definition: {
      name: 'tasks_complete',
      description: 'Mark a task done by its id (from tasks_list). Use when they say they did it.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The task id.' },
        },
        required: ['id'],
      },
    },
    execute: execTasksComplete,
  },
  tasks_delete: {
    definition: {
      name: 'tasks_delete',
      description: 'Delete a task by its id. Confirm before using.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The task id.' },
        },
        required: ['id'],
      },
    },
    execute: execTasksDelete,
  },
  kb_save: {
    definition: {
      name: 'kb_save',
      description:
        'Save a fact, snippet, or page summary to the person\'s local knowledge base. Use '
        + 'it when they say "save this", "remember this page", or share something worth '
        + 'keeping with a source. Items appear in their Knowledge app.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for the item.' },
          content: { type: 'string', description: 'The content worth keeping.' },
          sourceUrl: { type: 'string', description: 'Optional URL this came from.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        },
      },
    },
    execute: execKbSave,
  },
  kb_search: {
    definition: {
      name: 'kb_search',
      description:
        'Search the person\'s local knowledge base by keyword. Use it before answering '
        + 'anything they may have saved — "what did I save about X". Without a query it '
        + 'returns the most recent items.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for (title, content, URL, or tag).' },
        },
      },
    },
    execute: execKbSearch,
  },
  kb_get: {
    definition: {
      name: 'kb_get',
      description: 'Read a full knowledge-base item by its id (from kb_search).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The item id.' },
        },
        required: ['id'],
      },
    },
    execute: execKbGet,
  },
}

export type LocalPimToolName = keyof typeof LOCAL_PIM_TOOLS

/** Type reference so ToolFunction stays in the emitted graph for consumers. */
export function _localPimToolDefs(): ToolFunction[] {
  return Object.values(LOCAL_PIM_TOOLS).map((t) => t.definition)
}
