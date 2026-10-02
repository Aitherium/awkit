'use client'

/**
 * AcademyClassroomBridge — the one place a record panel (Lesson Library, Learning
 * Profiles, Mastery Analytics) says where a class lives and what to do about it.
 *
 * Aither Classroom is the teacher's product. A class is "in Classroom" when the
 * router says so (`classroom: true` on `GET /api/v1/academy/classes`):
 *
 *  - in Classroom      -> its roster, join sheet, parent codes and lesson studio are
 *                         there; a LINK goes there.
 *  - made here, before -> the teacher who made it can move it (`move-to-classroom`),
 *                         after which Classroom lists it and can draft and publish
 *                         for it. Until then this is the only home of that class.
 *  - unknown           -> a router older than the field. Nothing is claimed.
 *
 * `noClasses` renders the empty state: the way to make a first class.
 * Not a panel: no registry entry, no barrel export.
 */

import { useState } from 'react'
import { type AcademyClass, classroomHref, isHomeClass, moveToClassroom } from './academyApi'

export interface AcademyClassroomBridgeProps {
  apiBase: string
  /** The selected class, as `listClasses` returned it. */
  cls?: AcademyClass
  /** True when the caller has no class at all. */
  noClasses?: boolean
  /** Called after a successful move so the panel reloads its class list. */
  onMoved?: () => void | Promise<void>
  /** Where Aither Classroom is on this host (default: `classroomHref()`). */
  href?: string
}

const LINK = 'inline-flex min-h-[44px] items-center rounded border px-3 py-1 text-sm font-medium underline-offset-2 hover:underline'

export default function AcademyClassroomBridge({ apiBase, cls, noClasses, onMoved, href }: AcademyClassroomBridgeProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moved, setMoved] = useState<{ id: string; recordOnly: number } | null>(null)
  const to = classroomHref(href)

  const open = (
    <a href={to} className={LINK} data-testid="open-classroom">Open Aither Classroom</a>
  )

  if (noClasses) {
    return (
      <section className="space-y-2 rounded border p-3 text-sm" data-testid="classroom-bridge" data-state="empty">
        <p className="text-gray-700">No classes yet. A class is created in Aither Classroom, and shows here once it exists.</p>
        {open}
      </section>
    )
  }
  if (!cls || isHomeClass(cls.id)) return null

  const justMoved = moved?.id === cls.id
  if (cls.classroom === true || justMoved) {
    return (
      <section className="space-y-2 rounded border p-3 text-sm" data-testid="classroom-bridge" data-state="in-classroom">
        <p className="text-gray-700">
          {justMoved ? `${cls.name} is now in Aither Classroom. ` : ''}
          {'This class is in Aither Classroom: its roster, join sheet, parent codes and lesson studio are there.'}
        </p>
        {justMoved && moved.recordOnly > 0 && (
          <p className="text-xs text-gray-500" data-testid="record-only-note">
            {`${moved.recordOnly} student ${moved.recordOnly === 1 ? 'profile' : 'profiles'} here ${moved.recordOnly === 1 ? 'has' : 'have'} no login yet. Add each student on the Classroom roster to give them one.`}
          </p>
        )}
        {open}
      </section>
    )
  }
  if (cls.classroom !== false) return null

  const move = async () => {
    setBusy(true)
    setError(null)
    try {
      const out = await moveToClassroom(apiBase, cls.id)
      setMoved({ id: cls.id, recordOnly: out?.record_only_students ?? 0 })
      await onMoved?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded border p-3 text-sm" data-testid="classroom-bridge" data-state="not-in-classroom">
      <p className="text-gray-700">
        {'This class was made here and is not in Aither Classroom yet. Move it to draft and publish lessons for it and to build a roster with student logins. Its lessons and student profiles stay as they are.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void move()}
          className="min-h-[44px] rounded border px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-60">
          {busy ? 'Moving…' : 'Move this class to Aither Classroom'}
        </button>
        {open}
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          <strong>Not moved.</strong> {error}
        </p>
      )}
    </section>
  )
}
