/**
 * GuideTab -- the console's #/guide tab: AdminGuideSurface on the box's own guide.json.
 *
 * awnix-console serves the rendered guide at /guide.json (docs-output contract); the
 * variant comes from /api/session so the picker starts on (and is locked to) what this
 * box actually runs. Until the session answers, the guide shows every variant.
 *
 * One file, default export, props {client} -- the ApplianceTab contract.
 */
import { useEffect, useState } from 'react'
import AdminGuideSurface from '../surfaces/AdminGuide/AdminGuideSurface'
import type { AppliancePanelProps } from './types'

export default function GuideTab({ client }: AppliancePanelProps) {
  const [variant, setVariant] = useState<string | undefined>(undefined)
  useEffect(() => {
    let live = true
    void client.session().then((r) => {
      if (live && r.state === 'ok' && r.data?.variant) setVariant(r.data.variant)
    })
    return () => {
      live = false
    }
  }, [client])
  return (
    <AdminGuideSurface
      source="/guide.json"
      variant={variant}
      basePath="#/guide"
      lockVariant={Boolean(variant)}
    />
  )
}
