/**
 * ChannelArtifactGallery — renders one brand's artifacts across all channels
 * in a campaign-preview grid (the "canvas view" in Iris).
 *
 * Renders each channel's frame in a 2-column grid (configurable). Empty artifacts
 * show a placeholder. Only channels present in the artifacts object are rendered
 * unless an explicit channels list is provided.
 */

import type { ComponentType } from 'react'
import type {
  ChannelId,
  ChannelBrand,
  ChannelArtifactContent,
  ChannelFrameProps,
} from './types'
import GmailFrame from './GmailFrame'
import InstagramFrame from './InstagramFrame'
import XPostFrame from './XPostFrame'
import LinkedInFrame from './LinkedInFrame'
import AppStoreFrame from './AppStoreFrame'
import IMessageFrame from './IMessageFrame'

export interface ChannelArtifactGalleryProps {
  /** The brand being previewed across channels */
  brand: ChannelBrand
  /** Artifacts keyed by channel ID; only present channels are rendered */
  artifacts: Partial<Record<ChannelId, ChannelArtifactContent>>
  /**
   * Explicit channel order/filter. If omitted, uses canonical order
   * and only includes channels present in artifacts.
   */
  channels?: ChannelId[]
  /** Number of grid columns (default 2) */
  columns?: number
  /** Callback when a frame is clicked; enables interactive selection */
  onSelect?: (channel: ChannelId) => void
  /** CSS class applied to the outer wrapper */
  className?: string
}

const CANONICAL_CHANNEL_ORDER: ChannelId[] = [
  'gmail_email',
  'instagram_post',
  'x_post',
  'linkedin_post',
  'appstore_listing',
  'imessage',
]

const FRAME_OF: Record<ChannelId, ComponentType<ChannelFrameProps>> = {
  gmail_email: GmailFrame,
  instagram_post: InstagramFrame,
  x_post: XPostFrame,
  linkedin_post: LinkedInFrame,
  appstore_listing: AppStoreFrame,
  imessage: IMessageFrame,
}

const CHANNEL_LABELS: Record<ChannelId, string> = {
  gmail_email: 'Gmail Email',
  instagram_post: 'Instagram Post',
  x_post: 'X Post',
  linkedin_post: 'LinkedIn Post',
  appstore_listing: 'App Store Listing',
  imessage: 'iMessage',
}

export default function ChannelArtifactGallery({
  brand,
  artifacts,
  channels,
  columns = 2,
  onSelect,
  className,
}: ChannelArtifactGalleryProps) {
  const isEmpty = Object.keys(artifacts).length === 0

  // Determine which channels to render: use provided list or default to canonical order
  const channelsToRender = channels || CANONICAL_CHANNEL_ORDER

  // Filter to only channels present in artifacts
  const visibleChannels = channelsToRender.filter(ch => ch in artifacts)

  // Render empty state placeholder
  if (isEmpty) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
          background: 'var(--bg-elevated, #1A2A40)',
          padding: 16,
        }}
      >
        <div
          style={{
            textAlign: 'center',
            color: 'var(--text-muted, #4A6A8A)',
            fontSize: '0.875rem',
          }}
        >
          <p style={{ margin: 0, marginBottom: 8, fontWeight: 500 }}>
            No artifacts yet
          </p>
          <p style={{ margin: 0, fontSize: '0.8125rem' }}>
            Ask Iris to draft a campaign
          </p>
        </div>
      </div>
    )
  }

  // Render gallery grid
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 16,
      }}
    >
      {visibleChannels.map(channelId => {
        const Frame = FRAME_OF[channelId]
        const content = artifacts[channelId]!

        return (
          <div
            key={channelId}
            onClick={() => onSelect?.(channelId)}
            style={{
              cursor: onSelect ? 'pointer' : 'default',
            }}
          >
            {/* Channel label */}
            <div
              style={{
                marginBottom: 6,
                fontSize: '0.7rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-muted, #4A6A8A)',
                fontWeight: 600,
              }}
            >
              {CHANNEL_LABELS[channelId]}
            </div>

            {/* Frame wrapper with portal-kit styling */}
            <div
              style={{
                borderRadius: 'var(--radius-lg, 12px)',
                border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
                background: 'var(--bg-elevated, #1A2A40)',
                padding: 10,
              }}
            >
              <Frame brand={brand} content={content} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
