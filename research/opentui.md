# OpenTUI Research

## What is OpenTUI?

OpenTUI is a high-performance terminal UI (TUI) framework with a **native core written in Zig** and **TypeScript bindings**. It uses a component-based architecture powered by the **Yoga layout engine** (the same flexbox engine used by React Native) to provide CSS flexbox-style layouts in the terminal.

- **GitHub repo:** https://github.com/anomalyco/opentui
- **Website:** https://opentui.com/
- **npm package:** `@opentui/core`
- **Rust port:** https://github.com/Dicklesworthstone/opentui_rust

The Zig core exposes a C ABI, meaning it can theoretically be used from any language.

## Language/Runtime

- **Core:** Written in Zig (native, high performance)
- **Bindings:** TypeScript/Node.js — primary integration path
- **Packages:**
  - `@opentui/core` — Imperative TypeScript API with all primitives
  - `@opentui/react` — React reconciler for OpenTUI
  - `@opentui/solid` — SolidJS reconciler for OpenTUI

## Core Concepts

### Components / Renderables

OpenTUI uses a "Renderable" class hierarchy. Built-in renderables include:

- **Layout & Display:** `box`, `text`, `scrollbox`, `ascii_font`, `markdown`
- **Input:** `input`, `textarea`, `select`, `tab_select`
- **Code & Diff:** `code` (syntax-highlighted), `line_number`, `diff` (unified or split)
- **Text Modifiers** (inside `<text>`): `span`, `strong`/`b`, `em`/`i`, `u`, `br`, `a`

### Layout

Uses the **Yoga layout engine** — full CSS flexbox support including `flexDirection`, `justifyContent`, `alignItems`, `flexGrow`, `gap`, `padding`, etc.

### Rendering

Uses an `OptimizedBuffer` API for double-buffered cell composition with real RGBA alpha blending and scissor clipping. Custom renderables override a `renderSelf(buffer, deltaTime)` method to draw text, shapes, and effects directly to the terminal buffer.

### Three Integration Paths

1. **Imperative API** — direct TypeScript, granular control (create renderables manually, add to tree)
2. **React reconciler** — use JSX with React hooks (`useState`, `useEffect`, `useKeyboard`, `useRenderer`, `useTerminalDimensions`, `useTimeline`)
3. **SolidJS reconciler** — reactive UIs with Solid's intrinsic JSX elements

## Comparison to Alternatives

| Feature | OpenTUI | Ink (React for CLI) | Blessed | terminal-kit |
|---|---|---|---|---|
| **Core language** | Zig (native) + TS bindings | Pure JS/TS | Pure JS | Pure JS |
| **Layout engine** | Yoga (flexbox) | Yoga (flexbox) | Custom | Custom |
| **React support** | Yes (reconciler) | Yes (core paradigm) | No | No |
| **Solid support** | Yes (reconciler) | No | No | No |
| **Imperative API** | Yes | No (React only) | Yes | Yes |
| **Performance** | Native Zig core, RGBA blending, double-buffered | JS-level | JS-level | JS-level |
| **Built-in components** | Rich (markdown, diff viewer, code highlighting, inputs) | Basic (Box, Text) | Rich | Moderate |
| **Maintenance** | Active (powers opencode + terminal.shop) | Active | Largely unmaintained | Low activity |

**Key differentiators vs Ink:** OpenTUI has a native performance core, offers both React AND Solid bindings (plus a raw imperative API), and ships with much richer built-in components (diff viewer, syntax highlighting, markdown rendering, ASCII fonts). Ink is purely React-based and JS-only.

## API Examples

### Imperative API (no framework)

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable } from "@opentui/core"

const renderer = await createCliRenderer()

const panel = new BoxRenderable(renderer, {
  id: "panel",
  width: 40,
  height: 12,
  backgroundColor: "#333366",
  border: true,
  borderStyle: "double",
  borderColor: "#FFFFFF",
  title: "Settings Panel",
  padding: 2,
  flexDirection: "column",
  gap: 1,
})

const content = new TextRenderable(renderer, {
  id: "content",
  content: "Panel content goes here",
})

panel.add(content)
renderer.root.add(panel)
```

### React Integration

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useState, useEffect } from "react"

function App() {
  const [count, setCount] = useState(0)
  const { width, height } = useTerminalDimensions()
  const renderer = useRenderer()

  useKeyboard((key) => {
    if (key.name === "escape") renderer.destroy()
  })

  useEffect(() => {
    const timer = setInterval(() => setCount((c) => c + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <box style={{ flexDirection: "column", padding: 2, gap: 1 }}>
      <text fg="#00FF00">Terminal: {width}x{height}</text>
      <text>Counter: {count}</text>
      <box title="Username" style={{ border: true, height: 3 }}>
        <input placeholder="Enter username..." focused={true} />
      </box>
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

### Custom Component (extending base renderables)

```tsx
import { BoxRenderable, OptimizedBuffer, RGBA } from "@opentui/core"
import { extend } from "@opentui/react"

class ButtonRenderable extends BoxRenderable {
  private _label: string = "Button"

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)
    const centerX = this.x + Math.floor(this.width / 2 - this._label.length / 2)
    const centerY = this.y + Math.floor(this.height / 2)
    buffer.drawText(this._label, centerX, centerY, RGBA.fromInts(255, 255, 255, 255))
  }
}

extend({ consoleButton: ButtonRenderable })
// Then use in JSX:
// <consoleButton label="Click me!" style={{ backgroundColor: "blue" }} />
```

## Maintenance & Ecosystem

- **Actively maintained** — backed by the teams behind **opencode** (AI coding tool) and **terminal.shop** (SST's terminal coffee shop)
- npm org: `@opentui` with packages for `core`, `react`, `solid`
- `@opentui/ui` — higher-level component library (dialogs, toasts)
- **Rust port** exists: https://github.com/Dicklesworthstone/opentui_rust
- **MoonBit port** exists: https://github.com/Frank-III/onebit-tui
- Current version: v0.1.69 range — active pre-1.0 development

## Projects Using It

- **opencode** — AI-powered coding tool (primary production user)
- **terminal.shop** — SST's terminal-based coffee shop
- Community projects: Git clients, AI chat interfaces, monitoring dashboards
