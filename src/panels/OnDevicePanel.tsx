// Public build of awkit: this module is a stub. The in-browser model
// runtime is part of the Aitherium platform and is not published here.
export type OnDevicePanelProps = Record<string, unknown>

export default function OnDevicePanel(_props: OnDevicePanelProps) {
  return (
    <div role="note" style={{ padding: 16, opacity: 0.8 }}>
      On-device inference is part of the Aitherium platform and is not
      included in the open-source build of awkit.
    </div>
  )
}
