// CSS Modules are resolved by the bundler at consume time, but `tsc` needs a type for
// the import or the build fails with TS2307 (D-1503). Ambient decl, no runtime effect.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
