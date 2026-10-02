// HOST SEAMS (deliberate): `@/` specifiers the package cannot own.
// neural-field lives in the CONSUMING app's dashboard (Veil ships it; the
// lazy import in neural-minimap.tsx resolves against the consumer's own
// bundler alias at RUNTIME). The emit config carries no `@/` mapping BY
// DESIGN (an unresolvable alias must fail the build rather than emit
// verbatim), so the seam is declared ambient instead of mapped -- this is
// what makes the lazy import compile while staying a runtime seam.
declare module '@/components/dashboard/infrastructure/neural-field' {
  export interface NeuralFieldProps {
    className?: string
    height?: number
    showControls?: boolean
    autoRefresh?: boolean
    isOpen?: boolean
    onClose?: () => void
  }
  export function NeuralField(props: NeuralFieldProps): JSX.Element
}
