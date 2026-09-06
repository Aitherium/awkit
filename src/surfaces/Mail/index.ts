export { default as MailSurface } from './MailSurface'
export { useMail, type MailMessage } from './useMail'
export type { MailSurfaceProps } from './MailSurface'

// CSS is imported by the consuming app; mail-surface components should nest within
// a container that has access to the room CSS custom properties or equivalent theming.
// To use this surface, import the CSS in your main entry:
//   import 'awkit/src/surfaces/Mail/mail.css'
