'use client'

/**
 * AppliancePanel -- manage the awnix box this product runs on, from the product's UI.
 *
 * The same console as https://<box>:9443 (ApplianceConsole + the feature panels) with
 * the setup tab left out: setup happens on the box. apiBase '' because the tenant
 * backend mounts the admin-gated proxy at /api/appliance/* (awkit-backend/appliance.py,
 * contract `appliance-web-api`), which forwards to the root awnix-console on loopback.
 * Off an appliance the proxy answers 501 {state: not-an-appliance} and the panels say so.
 */
import { ApplianceConsole, OverviewPanel, SurfacesPanel } from '../appliance'
import type { ApplianceTab } from '../appliance'
import ComponentsPanel from '../appliance/ComponentsPanel'
import EndpointsPanel from '../appliance/EndpointsPanel'
import GuideTab from '../appliance/GuideTab'
import LicensePanel from '../appliance/LicensePanel'
import UpdatesPanel from '../appliance/UpdatesPanel'

export const APPLIANCE_PANEL_TABS: ApplianceTab[] = [
  { id: 'overview', label: 'Overview', Component: OverviewPanel },
  { id: 'license', label: 'License', Component: LicensePanel },
  { id: 'updates', label: 'Updates', Component: UpdatesPanel },
  { id: 'components', label: 'Components', Component: ComponentsPanel },
  { id: 'endpoints', label: 'Endpoints', Component: EndpointsPanel },
  { id: 'surfaces', label: 'Surfaces', Component: SurfacesPanel },
  { id: 'guide', label: 'Guide', Component: GuideTab },
]

export interface AppliancePanelProps {
  /** Shown instead of the box's own brand (e.g. the product name). */
  brand?: string
}

export default function AppliancePanel({ brand }: AppliancePanelProps) {
  return <ApplianceConsole apiBase="" tabs={APPLIANCE_PANEL_TABS} brand={brand} />
}
