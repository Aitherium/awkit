/**
 * Aither Classroom support suite client: the Support Passport, Quick Tally, substitute
 * plans, the Family Support Portal and the teacher's workload log.
 *
 * Host app proxy (Veil: `/api/classroom-support/*` -> aither-hearth
 * `/api/v1/classroom-support/*`, lib/hearth/classroom_support_router.py). Like every
 * classroom client it sends only path ids the server re-checks; teacher, guardian,
 * student and substitute scope all come from the verified caller (or, for a substitute,
 * the link token in the X-Sub-Pass header).
 *
 * Spec: docs/plans/2026-10-17-classroom-support-suite.md.
 */
import { classroomFetch, cseg, send } from './classroomApi'

export const SUPPORT_API = '/api/classroom-support'

/** Minutes EAST of UTC: tallies bucket by the teacher's own day. */
export function tzParam(d: Date = new Date()): string {
  return `tz=${-d.getTimezoneOffset()}`
}

export type SectionKey =
  | 'strengths' | 'interests' | 'learning_preferences' | 'calm_plan' | 'strategies' | 'goals'
  | 'accommodations' | 'what_works' | 'reviews' | 'data' | 'staff_notes'

export interface Strategy { id?: string; strategy: string; started?: string; outcome?: '' | 'worked' | 'mixed' | 'did_not' | 'too_early'; note?: string }
export interface GoalProgress { at: string; value: string; note?: string }
export interface Goal { id?: string; goal: string; measure?: string; baseline?: string; target?: string; status?: 'active' | 'met' | 'paused'; progress?: GoalProgress[] }
export interface Support { id?: string; support: string; kind?: 'accommodation' | 'modification' | 'related_service'; owner?: string; when?: string }
export interface Review { id?: string; title: string; date?: string; kind?: string }
export interface Action { id?: string; text: string; owner?: string; due?: string; done?: boolean }

export type SectionBody =
  | { items: string[] }
  | { items: Strategy[] }
  | { items: Goal[] }
  | { items: Support[] }
  | { upcoming: Review[]; actions: Action[] }
  | { text: string }
  | Record<string, never>

export interface PassportSection {
  section: SectionKey
  title: string
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
  share_family: boolean
  share_student: boolean
  student_may_see: boolean
  never_shared: boolean
  updated_at: string | null
}

export interface DaySeries { day: string; count: number }

export interface Counter {
  id: string
  label: string
  goal_id?: string | null
  member_id: string
  today: number
  series: DaySeries[]
  total_14d: number
  alias?: string
}

export interface MarkLog { mark_id: number; counter_id: string; label: string; at: string; by_you: boolean; voided: boolean }

export interface Checkin { at: string; feeling: string; title: string }

export interface StaffPassport {
  student: { member_id: string; alias: string }
  sections: PassportSection[]
  counters: Counter[]
  pinned: string[]
  checkins?: Checkin[]
}

/** An AI draft: a SUGGESTION the teacher edits and sends themselves (never auto-sent). */
export interface Draft {
  kind: 'family_update' | 'meeting_prep'
  draft: string
  source: 'model' | 'template'
  reason?: string
  warnings: string[]
  used_sections: string[]
  auto_send: false
  note: string
}

/** What a family is shown after writing during the teacher's quiet hours. */
export interface QuietReply { held: true; auto_reply: string; reply_within_hours?: number; back_at?: string }

/** The student's own child-safe view (GET /api/tutor/me/support-passport). */
export interface StudentSupportClass {
  class_id: string
  class_name?: string | null
  sections: Array<{ section: string; title: string; items: Array<string | { goal: string; target?: string; status?: string; progress?: Array<{ at: string; value: string }> }> }>
  checkin: { feelings: Array<{ feeling: string; title: string }>; latest: { feeling: string; title: string } | null }
}

/** The tutor proxy a child may call (child lockdown allowlists /api/tutor/me/*). */
export const STUDENT_SUPPORT_API = '/api/tutor'

/** Drafts wait on a local model: give them longer than a plain read. */
const DRAFT_TIMEOUT_MS = 70000

export interface RosterLine {
  member_id: string
  alias: string
  sections_filled: number
  sections_total: number
  next_review: string | null
  open_actions: number
  counters: number
}

export interface SupportRoster { class_id: string; class_name: string | null; students: RosterLine[]; pinned: string[] }

export interface FamilyPassport {
  student: { member_id: string; alias: string }
  sections: Array<{ section: SectionKey; title: string; body: any; updated_at: string | null }> // eslint-disable-line @typescript-eslint/no-explicit-any
  data: Array<{ id: string; label: string; today: number; series: DaySeries[]; total_14d: number }> | null
}

export interface TeacherHours { quiet_start: string; quiet_end: string; quiet_weekends: boolean; auto_reply: string; reply_within_hours: number }

/** The browser's IANA zone ('' when unknown): quiet hours are enforced in this zone. */
export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
}

export interface FamilyChild { class_id: string; member_id: string; alias: string; class_name: string | null; teacher_hours: TeacherHours | null }

export interface MeetingDoc { title: string; note?: string; section?: string | null }

export interface Meeting {
  id?: string
  title: string
  kind: string
  at: string
  where?: string
  purpose?: string
  questions?: string[]
  documents?: MeetingDoc[]
  shared?: boolean
}

export interface FamilyMeeting {
  id: string
  title: string
  kind: string
  kind_title: string
  at: string
  where: string
  purpose: string
  teacher_questions: string[]
  suggested_questions: string[]
  documents: MeetingDoc[]
  past: boolean
}

export interface GlossaryTerm { term: string; full: string; plain: string }

export interface SubPlanBody {
  title: string
  day?: string
  schedule: Array<{ time: string; what: string }>
  lessons: Array<{ when: string; title: string; steps: string }>
  seating: { rows: number; cols: number; seats: Array<{ r: number; c: number; name: string }>; front?: string }
  routines: string[]
  emergency: string[]
  contacts: Array<{ role: string; how: string }>
  notes?: string
}

export interface SubLink { id: string; created_at: string; expires_at: string; revoked: boolean; live: boolean; opens: number; last_opened_at: string | null }
export interface SubPlan { id: string; updated_at: string; plan: SubPlanBody; links: SubLink[] }
export interface SubPlans { class_name: string | null; plans: SubPlan[]; roster_names: string[]; max_hours: number }
export interface SubView { class_name: string; expires_at: string; plan: SubPlanBody }

export interface WellnessView {
  days: number
  total_minutes: number
  categories: Array<{ category: string; title: string; minutes: number; share: number }>
  per_day: Array<{ day: string; minutes: number }>
  entries: Array<{ id: string; at: string; category: string; minutes: number; note: string }>
  tasks: Array<{ id: string; text: string; category: string; due: string | null; minutes: number | null; done: boolean; bucket: string }>
  do_first: WellnessView['tasks']
  done_recently: number
  prefs: TeacherHours & { share_hours_with_families: boolean; tz?: string; hold_family_messages?: boolean }
  category_titles: Record<string, string>
}

type H = Record<string, string> | undefined

const cls = (classId: string) => `/classes/${cseg(classId)}`
const stu = (classId: string, memberId: string) => `${cls(classId)}/students/${cseg(memberId)}`

export const supportApi = {
  roster: (b: string, classId: string, h?: H) => classroomFetch<SupportRoster>(b, `${cls(classId)}/students`, { extraHeaders: h }),
  passport: (b: string, classId: string, memberId: string, h?: H) =>
    classroomFetch<StaffPassport>(b, `${stu(classId, memberId)}/passport?${tzParam()}`, { extraHeaders: h }),
  saveSection: (b: string, classId: string, memberId: string, section: SectionKey, body: unknown, h?: H) =>
    send<PassportSection>(b, `${stu(classId, memberId)}/passport/${cseg(section)}`, 'PUT', { body }, h),
  share: (b: string, classId: string, memberId: string, section: SectionKey, v: { share_family?: boolean; share_student?: boolean }, h?: H) =>
    send<{ share_family: boolean; share_student: boolean }>(b, `${stu(classId, memberId)}/sharing/${cseg(section)}`, 'PUT', v, h),
  tallies: (b: string, classId: string, memberId: string, h?: H) =>
    classroomFetch<{ counters: Counter[]; log: MarkLog[]; pinned: string[] }>(b, `${stu(classId, memberId)}/tallies?${tzParam()}`, { extraHeaders: h }),
  addCounter: (b: string, classId: string, memberId: string, label: string, goalId: string | null, h?: H) =>
    send<Counter>(b, `${stu(classId, memberId)}/tallies`, 'POST', { label, goal_id: goalId }, h),
  archiveCounter: (b: string, classId: string, counterId: string, h?: H) =>
    send<{ archived: boolean }>(b, `${cls(classId)}/tallies/${cseg(counterId)}`, 'DELETE', undefined, h),
  mark: (b: string, classId: string, counterId: string, h?: H) =>
    send<{ mark_id: number; at: string; counter: Counter }>(b, `${cls(classId)}/tallies/${cseg(counterId)}/marks?${tzParam()}`, 'POST', {}, h),
  undo: (b: string, classId: string, counterId: string, markId: number, h?: H) =>
    send<{ counter: Counter }>(b, `${cls(classId)}/tallies/${cseg(counterId)}/marks/${markId}?${tzParam()}`, 'DELETE', undefined, h),
  pins: (b: string, classId: string, h?: H) => classroomFetch<{ tiles: Counter[] }>(b, `${cls(classId)}/pins?${tzParam()}`, { extraHeaders: h }),
  pin: (b: string, classId: string, counterId: string, on: boolean, h?: H) =>
    send<{ pinned: boolean }>(b, `${cls(classId)}/pins/${cseg(counterId)}`, on ? 'PUT' : 'DELETE', on ? {} : undefined, h),
  meetings: (b: string, classId: string, memberId: string, h?: H) =>
    classroomFetch<{ meetings: Meeting[]; kinds: Record<string, string> }>(b, `${stu(classId, memberId)}/meetings`, { extraHeaders: h }),
  saveMeeting: (b: string, classId: string, memberId: string, m: Meeting, h?: H) => {
    const { id, ...rest } = m
    return id
      ? send<Meeting>(b, `${stu(classId, memberId)}/meetings/${cseg(id)}`, 'PUT', { meeting: rest }, h)
      : send<Meeting>(b, `${stu(classId, memberId)}/meetings`, 'POST', { meeting: rest }, h)
  },
  deleteMeeting: (b: string, classId: string, memberId: string, id: string, h?: H) =>
    send<{ deleted: boolean }>(b, `${stu(classId, memberId)}/meetings/${cseg(id)}`, 'DELETE', undefined, h),
  subPlans: (b: string, classId: string, h?: H) => classroomFetch<SubPlans>(b, `${cls(classId)}/sub-plans`, { extraHeaders: h }),
  saveSubPlan: (b: string, classId: string, id: string | null, plan: SubPlanBody, h?: H) =>
    id ? send<SubPlan>(b, `${cls(classId)}/sub-plans/${cseg(id)}`, 'PUT', { plan }, h)
      : send<SubPlan>(b, `${cls(classId)}/sub-plans`, 'POST', { plan }, h),
  deleteSubPlan: (b: string, classId: string, id: string, h?: H) =>
    send<{ deleted: boolean }>(b, `${cls(classId)}/sub-plans/${cseg(id)}`, 'DELETE', undefined, h),
  mintSubLink: (b: string, classId: string, id: string, hours: number, h?: H) =>
    send<{ grant_id: string; token: string; expires_at: string }>(b, `${cls(classId)}/sub-plans/${cseg(id)}/links`, 'POST', { hours }, h),
  revokeSubLink: (b: string, classId: string, id: string, grantId: string, h?: H) =>
    send<{ revoked: boolean }>(b, `${cls(classId)}/sub-plans/${cseg(id)}/links/${cseg(grantId)}`, 'DELETE', undefined, h),
  /** The substitute's one call: the token rides a header, never the URL. */
  subView: (b: string, token: string) =>
    classroomFetch<SubView>(b, '/sub/plan', { extraHeaders: { 'X-Sub-Pass': token } }),
  familyChildren: (b: string, h?: H) => classroomFetch<{ children: FamilyChild[] }>(b, '/family/children', { extraHeaders: h }),
  familyPassport: (b: string, classId: string, memberId: string, h?: H) =>
    classroomFetch<FamilyPassport>(b, `/family/children/${cseg(classId)}/${cseg(memberId)}/passport?${tzParam()}`, { extraHeaders: h }),
  familyMeetings: (b: string, classId: string, memberId: string, h?: H) =>
    classroomFetch<{ meetings: FamilyMeeting[] }>(b, `/family/children/${cseg(classId)}/${cseg(memberId)}/meetings`, { extraHeaders: h }),
  glossary: (b: string, h?: H) => classroomFetch<{ terms: GlossaryTerm[]; note: string }>(b, '/family/glossary', { extraHeaders: h }),
  draftFamilyUpdate: (b: string, classId: string, memberId: string, v: { focus?: string; tone?: string }, h?: H) =>
    classroomFetch<Draft>(b, `${stu(classId, memberId)}/drafts/family-update`, { method: 'POST', body: JSON.stringify(v), extraHeaders: h, timeoutMs: DRAFT_TIMEOUT_MS }),
  draftMeetingPrep: (b: string, classId: string, memberId: string, meetingId: string, h?: H) =>
    classroomFetch<Draft>(b, `${stu(classId, memberId)}/meetings/${cseg(meetingId)}/prep`, { method: 'POST', body: '{}', extraHeaders: h, timeoutMs: DRAFT_TIMEOUT_MS }),
  /** The student's own view: no id in the path, the server resolves "me". */
  studentView: (b: string = STUDENT_SUPPORT_API, h?: H) =>
    classroomFetch<{ classes: StudentSupportClass[] }>(b, '/me/support-passport', { extraHeaders: h }),
  studentCheckin: (b: string, classId: string, feeling: string, h?: H) =>
    send<{ feeling: string; title: string; at: string }>(b, '/me/support-checkin', 'POST', { class_id: classId, feeling }, h),
  wellness: (b: string, h?: H) => classroomFetch<WellnessView>(b, '/wellness', { extraHeaders: h }),
  logTime: (b: string, v: { category: string; minutes: number; note?: string }, h?: H) => send<{ id: string }>(b, '/wellness/time', 'POST', v, h),
  deleteTime: (b: string, id: string, h?: H) => send<{ deleted: boolean }>(b, `/wellness/time/${cseg(id)}`, 'DELETE', undefined, h),
  savePrefs: (b: string, v: Partial<WellnessView['prefs']>, h?: H) => send<WellnessView['prefs']>(b, '/wellness/prefs', 'PUT', v, h),
  saveTask: (b: string, id: string | null, v: { text: string; category?: string; due?: string | null; minutes?: number | null; done?: boolean }, h?: H) =>
    id ? send<{ id: string }>(b, `/wellness/tasks/${cseg(id)}`, 'PUT', v, h) : send<{ id: string }>(b, '/wellness/tasks', 'POST', v, h),
  deleteTask: (b: string, id: string, h?: H) => send<{ deleted: boolean }>(b, `/wellness/tasks/${cseg(id)}`, 'DELETE', undefined, h),
}

/** The substitute link a teacher shares: the token in the FRAGMENT, so it never reaches a
 *  server log or a Referer header. */
export function subLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/classroom/sub#t=${encodeURIComponent(token)}`
}

/** The token a substitute's page reads from its own URL fragment, or null. */
export function subTokenFromHash(hash: string): string | null {
  const m = /(?:^#|&)t=([^&]+)/.exec(hash || '')
  if (!m) return null
  const t = decodeURIComponent(m[1])
  return /^sub_[A-Za-z0-9_-]{20,64}$/.test(t) ? t : null
}

export const OUTCOME_WORDS: Record<string, string> = {
  worked: 'worked', mixed: 'mixed', did_not: 'did not work', too_early: 'too early to tell', '': 'not judged yet',
}
export const SUPPORT_KIND_WORDS: Record<string, string> = {
  accommodation: 'accommodation', modification: 'modification', related_service: 'related service',
}
