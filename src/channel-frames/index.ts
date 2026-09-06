/**
 * Channel-native artifact frames — public surface.
 *
 * CHANNEL_FRAMES is the registry consumers (Iris build panel, marketing canvas,
 * tenant portals) iterate to offer "render this artifact as it would ship".
 * Adding a channel = add the component + one registry row here; the gallery and
 * every consumer pick it up from the registry, not from per-channel imports.
 */
import type { ComponentType } from 'react'

import type { ChannelFrameProps, ChannelId } from './types'
import GmailFrame from './GmailFrame'
import InstagramFrame from './InstagramFrame'
import XPostFrame from './XPostFrame'
import LinkedInFrame from './LinkedInFrame'
import AppStoreFrame from './AppStoreFrame'
import IMessageFrame from './IMessageFrame'

export type {
  ChannelBrand,
  ChannelArtifactContent,
  ChannelFrameProps,
  ChannelId,
} from './types'
export { brandMonogram, brandAccent } from './types'

export { default as GmailFrame } from './GmailFrame'
export { default as InstagramFrame } from './InstagramFrame'
export { default as XPostFrame } from './XPostFrame'
export { default as LinkedInFrame } from './LinkedInFrame'
export { default as AppStoreFrame } from './AppStoreFrame'
export { default as IMessageFrame } from './IMessageFrame'
export { default as ChannelArtifactGallery } from './ChannelArtifactGallery'
export type { ChannelArtifactGalleryProps } from './ChannelArtifactGallery'

export interface ChannelFrameEntry {
  /** Human label for pickers, e.g. "Email — Gmail" */
  label: string
  Component: ComponentType<ChannelFrameProps>
  /** The channel's natural render width in px */
  naturalWidth: number
}

export const CHANNEL_FRAMES: Record<ChannelId, ChannelFrameEntry> = {
  gmail_email: { label: 'Email — Gmail', Component: GmailFrame, naturalWidth: 600 },
  instagram_post: { label: 'Social — Instagram', Component: InstagramFrame, naturalWidth: 400 },
  x_post: { label: 'Social — X', Component: XPostFrame, naturalWidth: 520 },
  linkedin_post: { label: 'Social — LinkedIn', Component: LinkedInFrame, naturalWidth: 552 },
  appstore_listing: { label: 'App Store — iOS', Component: AppStoreFrame, naturalWidth: 390 },
  imessage: { label: 'Messages — iMessage', Component: IMessageFrame, naturalWidth: 390 },
}

/** Canonical channel order for galleries and pickers */
export const CHANNEL_ORDER: ChannelId[] = [
  'gmail_email',
  'instagram_post',
  'x_post',
  'linkedin_post',
  'appstore_listing',
  'imessage',
]
