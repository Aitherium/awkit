/**
 * @aitherium/awkit/appliance -- the customer appliance console (Vite-safe, no next/*).
 *
 * The shell, client, types and the two panels the console gap owns. Feature panels
 * (SetupWizard, LicensePanel, UpdatesPanel, ComponentsPanel, EndpointsPanel) are one
 * file each with a default export and props {client}; import them by subpath,
 * `@aitherium/awkit/appliance/LicensePanel`. The tab list is composed by the app
 * (awnix-web src/tabs.ts, panels/AppliancePanel.tsx), not here.
 */
export {
  ApplianceConsole,
  Badge,
  StateNotice,
  useApplianceCall,
} from './ApplianceConsole'
export type { ApplianceConsoleProps } from './ApplianceConsole'
export { createApplianceClient, stateForStatus, toEndpointsView } from './client'
export type { ApplianceClient, ApplianceClientOptions } from './client'
export { OverviewPanel } from './OverviewPanel'
export { SurfacesPanel } from './SurfacesPanel'
// EndpointsPanel's own names (EndpointRow, EndpointsClient, ...) stay on its subpath:
// types.ts already exports Endpoint/EndpointsResult for the wire shape.
export { default as EndpointsPanel } from './EndpointsPanel'
// The air-gap plane (wave 2): mesh join, the license renewal banner, the licence step.
export { default as MeshPanel } from './MeshPanel'
export type { MeshPanelProps } from './MeshPanel'
export { default as RenewalBanner, RenewalBannerView } from './RenewalBanner'
export type { RenewalBannerProps, RenewalLicenseSource } from './RenewalBanner'
export { AgreementStep } from './AgreementStep'
export type { AgreementStepData, AgreementStepProps, AgreementClient } from './AgreementStep'
export * from './types'
