/**
 * `?app=<id>` in the AitherDesktop shell (aitherium.com/desktop?app=<id>).
 *
 * This shell's windows are manifest WIDGET ids (gobbonet, mediaforge, darkmatters),
 * while every other door on the site speaks Living Desktop app ids (elysium, media,
 * sprite, persona, desktop). Measured 2026-10-01 on aitherium.com: /desktop?app=elysium,
 * media, sprite, persona and desktop all landed on Files + Terminal and nothing else.
 *
 * So a link resolves in three steps: a widget this shell ships opens here; a known
 * alias opens its widget here (elysium IS the gobbonet widget); anything else that is
 * a well-formed id is handed to the host (`onUnresolvedApp`), which knows the Living
 * Desktop's ids and can take the visitor there. Pure, so it is testable without React.
 */

/** Living Desktop ids whose window this shell ships under another widget id. */
export const DESKTOP_DEEP_LINK_ALIASES: Readonly<Record<string, string>> = {
  elysium: 'gobbonet',
  'media-forge': 'mediaforge',
}

const APP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/

export type DesktopDeepLink =
  | { kind: 'widget'; widgetId: string }
  | { kind: 'handoff'; appId: string }
  | null

/** What `?app=` in `search` asks this shell to do. `hasWidget` = resolveWidget. */
export function resolveDesktopDeepLink(
  search: string,
  hasWidget: (id: string) => boolean,
): DesktopDeepLink {
  let wanted = ''
  try {
    wanted = (new URLSearchParams(search).get('app') || '').trim()
  } catch {
    return null
  }
  if (!wanted || !APP_ID_RE.test(wanted)) return null
  if (hasWidget(wanted)) return { kind: 'widget', widgetId: wanted }
  const alias = DESKTOP_DEEP_LINK_ALIASES[wanted]
  if (alias && hasWidget(alias)) return { kind: 'widget', widgetId: alias }
  return { kind: 'handoff', appId: wanted }
}
