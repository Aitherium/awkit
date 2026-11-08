# awkit

Render an agent panel from a tool result: one component, any React app.

Every agent surface ends up re-implementing the same panels by hand, and each copy
rots on its own. A catalogue lists an app the renderer cannot draw, or a tab is
declared with an id no component answers to, and nothing compares the two. awkit is
the single panel primitive: a typed registry of panels plus the React components that
draw them, so the list of panels and the code that renders them are one thing.

## What is in it

| Entry point | What you get |
|---|---|
| `@aitherium/awkit` | everything below, re-exported |
| `@aitherium/awkit/panels` | the panel components (one default export per panel) |
| `@aitherium/awkit/panels/registry` | `PANEL_REGISTRY`, `getPanelById`, `getPanelsByCategory`, `resolvePanelIds` |
| `@aitherium/awkit/surfaces` | page-level surfaces built from panels |

Each registry entry (`PanelMeta`) declares an `id`, `name`, `description`, `category`,
`icon`, the API prefix it expects and a readiness `state`
(`usable` / `demo` / `gated` / `unbuilt`). An entry is never a promise the renderer
cannot keep.

## Install

awkit is not on the npm registry yet. Use it from source:

```bash
git clone https://github.com/Aitherium/awkit
cd awkit
npm install
npm run build
```

Peer dependencies: `react` and `react-dom` 18 or 19, `next` 14+, `lucide-react`,
`framer-motion`, `sonner`. `@huggingface/transformers` is needed only for the in-browser
model panels.

## Use

```tsx
import { getPanelById, resolvePanelIds } from '@aitherium/awkit/panels/registry'

// Sort the panel ids a host declares into active / retired / dropped.
// `hasComponent` is your own lookup: does this app actually render that id?
const { active, retired, dropped } = resolvePanelIds(['chat', 'files'], (id) => Boolean(getPanelById(id)))
// `dropped` is a typo or an unbuilt panel: show it, never render nothing silently.
```

Start with one panel: point it at one MCP tool result and put it in your own page.

## License

Apache-2.0. See [LICENSE](LICENSE).
