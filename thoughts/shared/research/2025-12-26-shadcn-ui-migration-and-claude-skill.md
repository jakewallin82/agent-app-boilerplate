---
date: 2025-12-26T19:14:57Z
researcher: Claude
git_commit: 7dc3063d7cba3bafd46af910a11099f85235d866
branch: main
repository: agent-app-boilerplate
topic: "shadcn/ui Migration Strategy and Claude Skill Design"
tags: [research, shadcn-ui, component-library, claude-skill, frontend, design-system, migration]
status: complete
last_updated: 2025-12-26
last_updated_by: Claude
---

# Research: shadcn/ui Migration Strategy and Claude Skill Design

**Date**: 2025-12-26T19:14:57Z
**Researcher**: Claude
**Git Commit**: 7dc3063d7cba3bafd46af910a11099f85235d866
**Branch**: main
**Repository**: agent-app-boilerplate

## Research Question

1. How does the new shadcn create command and presets work?
2. How can the existing app transition to shadcn components and styling?
3. What is the best way to create a Claude skill for using shadcn components/presets?

## Summary

The shadcn/ui library has evolved significantly in December 2025, introducing a new `shadcn create` command with preset URLs that encode complete project configurations. The existing app uses a custom Tailwind-based dark theme with hand-built components. Migration to shadcn/ui is highly feasible given the existing Tailwind foundation. A Claude skill for shadcn usage should provide component documentation, design guidelines, and automated component installation patterns.

---

## Detailed Findings

### 1. shadcn Create Command and Preset System

#### Command Overview

The new command format:
```bash
pnpm dlx shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=mira&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=inter&menuAccent=bold&menuColor=default&radius=small&template=vite" --template vite
```

#### Key Differences: `shadcn init` vs `shadcn create`

| Feature | `shadcn init` | `shadcn create` |
|---------|---------------|-----------------|
| Purpose | Add to existing project | Create new customized project |
| Package | `shadcn@latest` | `shadcn@latest` |
| Customization | Basic (style, color) | Extensive (visual styles, fonts, icons) |
| Visual Styles | Default only | 5 options (Vega, Nova, Maia, Lyra, Mira) |
| Component Library | Radix UI only | Radix UI or Base UI |
| Code Generation | Default templates | **Rewrites component code** |

#### Preset URL Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `base` | `radix`, `base` | Component library foundation |
| `style` | `vega`, `nova`, `maia`, `lyra`, `mira` | Visual design preset (cannot change post-init) |
| `baseColor` | `neutral`, `gray`, `zinc`, `stone`, `slate` | Default color palette |
| `theme` | `neutral`, `zinc`, `stone`, `gray`, `slate` | Light/dark mode colors |
| `iconLibrary` | `lucide`, `tabler`, `hugeicons` | Icon package |
| `font` | `inter`, `geist-sans`, `roboto`, etc. | Typography family |
| `menuAccent` | `subtle`, `bold` | Menu emphasis |
| `menuColor` | `default`, etc. | Menu theming |
| `radius` | `small`, `default` | Border radius (`--radius` CSS var) |
| `template` | `next`, `vite`, `start` | Framework |

#### Mira Style (User's Choice)

**"Compact. Made for dense interfaces."**

- Optimized for information-dense UIs (admin dashboards, SaaS tools)
- Reduced padding and margins
- Efficient use of space
- Pairs well with Inter font (user's choice)

#### For Existing Projects (This App)

Use `shadcn init` instead of `create`:
```bash
npx shadcn@latest init -b neutral --css-variables
```

**Important**: Style and baseColor cannot be changed after initialization without reinstalling all components.

---

### 2. Current Application Architecture

#### File Structure
```
apps/web/
├── src/
│   ├── components/     # 14 React components (flat structure)
│   ├── contexts/       # 4 React Context providers
│   ├── lib/           # Utilities (api.ts, supabase.ts, etc.)
│   ├── types.ts       # Centralized TypeScript types
│   ├── config.ts      # Frontend configuration
│   ├── main.tsx       # Entry point
│   ├── App.tsx        # Root component with routing
│   └── index.css      # Global styles with Tailwind
├── tailwind.config.js  # Custom theme with dark colors
├── postcss.config.js   # Tailwind + Autoprefixer
└── vite.config.ts      # Vite bundler config
```

#### Current Styling System

**Tailwind CSS v3.4.0** with custom dark theme:

```javascript
// tailwind.config.js color system
colors: {
  background: '#0a0a0a',      // Near black
  foreground: '#fafafa',      // Off-white text
  card: '#18181b',            // Dark card background
  border: '#27272a',          // Border color
  primary: '#3b82f6',         // Blue accent
  muted: '#27272a',
  'muted-foreground': '#a1a1aa',
  // ... semantic colors
}
```

**Global Styles** (`index.css`):
- JetBrains Mono font family (monospace everywhere)
- Custom webkit scrollbar styling
- Tailwind directives (`@tailwind base/components/utilities`)

**Typography**:
- Google Fonts: JetBrains Mono (weights: 400, 500, 600)
- Prose styling: `prose prose-invert prose-sm max-w-none`

#### Current Component Patterns

**No third-party UI libraries** - all components are hand-built:

- `ChatInterface.tsx` - Main chat with streaming
- `Layout.tsx` - Three-panel resizable layout
- `MessageList.tsx` - User-facing message display
- `DevModeMessageList.tsx` - Admin/debug view
- `FileExplorer.tsx` - Session/file tree
- `Icons.tsx` - Custom SVG icon components
- `MarkdownViewer.tsx`, `JsonViewer.tsx` - Content viewers

**Component Patterns**:
- Named exports (`export function Component()`)
- Props interfaces defined inline
- Context hooks for state management
- Conditional rendering with ternaries

#### Responsive Design Status

**Desktop-focused with no mobile breakpoints**:
- Fixed three-panel layout with mouse-resizable dividers
- Flexbox-based layout (no CSS Grid)
- `h-screen` and `h-full` for full-height panels
- No Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) in use

---

### 3. Migration Strategy: Current App to shadcn/ui

#### Phase 1: Foundation Setup

1. **Initialize shadcn**:
   ```bash
   cd apps/web
   npx shadcn@latest init
   ```

   Configuration choices:
   - Style: `new-york` (closest to Mira's density)
   - Base color: `neutral` (matches existing `#0a0a0a` palette)
   - CSS variables: Yes
   - Tailwind CSS: Already configured
   - Components directory: `src/components/ui`

2. **Update `components.json`**:
   ```json
   {
     "style": "new-york",
     "tailwind": {
       "baseColor": "neutral",
       "cssVariables": true
     },
     "iconLibrary": "lucide",
     "aliases": {
       "components": "@/components",
       "utils": "@/lib/utils"
     }
   }
   ```

3. **Add `cn()` utility** (`src/lib/utils.ts`):
   ```typescript
   import { clsx, type ClassValue } from "clsx"
   import { twMerge } from "tailwind-merge"

   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs))
   }
   ```

   Note: `clsx` and `tailwind-merge` already in dependencies.

4. **Update CSS Variables** (`index.css`):
   ```css
   @layer base {
     :root {
       --background: 0 0% 4%;      /* #0a0a0a */
       --foreground: 0 0% 98%;     /* #fafafa */
       --card: 240 6% 10%;         /* #18181b */
       --border: 240 5% 16%;       /* #27272a */
       --primary: 217 91% 60%;     /* #3b82f6 */
       --muted: 240 5% 16%;
       --muted-foreground: 240 5% 65%;
       --radius: 0.375rem;         /* small radius for Mira style */
     }
   }
   ```

#### Phase 2: Component Migration (Priority Order)

**High Priority - Interactive Elements**:
1. `Button` - Replace inline button styles
2. `Input` - Form inputs in `MessageInput.tsx`
3. `Dialog` - Potential future modals
4. `Tabs` - For `RightPanel.tsx` tab switching

**Medium Priority - Layout Components**:
5. `Card` - For message bubbles, panels
6. `ScrollArea` - Custom scrollbar replacement
7. `Resizable` - Panel resizers (shadcn/ui has `ResizablePanelGroup`)

**Lower Priority - Content Display**:
8. `Badge` - Status indicators
9. `Tooltip` - Tool call hints
10. `Collapsible` - Expandable tool details

#### Phase 3: Icon Migration

Replace custom `Icons.tsx` with lucide-react:

```bash
pnpm add lucide-react
```

```typescript
// Before (custom)
import { FolderIcon, FileIcon } from '@/components/Icons'

// After (lucide)
import { Folder, File, Plus, X, ChevronLeft, Loader2 } from 'lucide-react'
```

Mapping:
- `FolderIcon` → `Folder`
- `FileIcon` → `File`
- `PlusIcon` → `Plus`
- `XIcon` → `X`
- `LoaderIcon` → `Loader2` (with `animate-spin`)

#### Phase 4: Responsive Enhancements

Add responsive patterns for mobile:

```typescript
// Add useIsMobile hook (shadcn pattern)
const MOBILE_BREAKPOINT = 768;
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    setIsMobile(mql.matches);
    mql.addEventListener('change', (e) => setIsMobile(e.matches));
    return () => mql.removeEventListener('change', () => {});
  }, []);
  return isMobile;
};
```

```tsx
// Responsive layout example
<div className="flex flex-col md:flex-row h-screen">
  <aside className="w-full md:w-60 flex-shrink-0">
    {/* File explorer */}
  </aside>
  <main className="flex-1 min-w-0">
    {/* Chat */}
  </main>
  <aside className="hidden lg:block w-96 flex-shrink-0">
    {/* Right panel - hide on smaller screens */}
  </aside>
</div>
```

---

### 4. Claude Skill Design for shadcn/ui

#### Skill Purpose

Enable coding agents to efficiently use shadcn/ui components while maintaining design consistency and production quality.

#### Proposed Skill Structure

```
agent/configs/{agent}/
└── .claude/
    └── skills/
        └── shadcn-ui/
            ├── SKILL.md           # Skill definition
            ├── components.md      # Component documentation
            ├── patterns.md        # Usage patterns
            └── scripts/
                └── add_component.sh  # Component installation
```

#### SKILL.md Content

```yaml
---
name: shadcn-ui
description: Add and configure shadcn/ui components following project design standards
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# shadcn/ui Component Skill

## Purpose
Install and configure shadcn/ui components while maintaining design consistency.

## When to Use
- Adding new UI components to the application
- Implementing forms, modals, buttons, or interactive elements
- Building responsive layouts
- Creating accessible UI patterns

## Available Commands

### Add Component
```bash
npx shadcn@latest add <component-name>
```

Common components: button, input, dialog, tabs, card, badge, tooltip,
dropdown-menu, select, checkbox, radio-group, switch, textarea,
scroll-area, resizable, collapsible, accordion

### Add Multiple Components
```bash
npx shadcn@latest add button input dialog card
```

## Design Standards

### Color Usage
- Primary actions: `bg-primary text-primary-foreground`
- Destructive actions: `bg-destructive text-destructive-foreground`
- Secondary: `bg-secondary text-secondary-foreground`
- Muted text: `text-muted-foreground`
- Borders: `border-border`

### Spacing (Mira/Compact Style)
- Small padding: `p-2`, `px-3 py-1.5`
- Standard padding: `p-3`, `px-4 py-2`
- Gaps: `gap-2` (tight), `gap-4` (standard)

### Border Radius
- Small: `rounded-sm` (0.375rem)
- Default: `rounded-md`
- Use consistent radius across related elements

### Responsive Patterns
- Mobile-first: Start with mobile, add `md:` and `lg:` for larger screens
- Panel hiding: `hidden lg:block` for desktop-only panels
- Stack to row: `flex-col md:flex-row`

## Component Customization

Always check existing components before adding new shadcn components:
1. Read `src/components/ui/` for existing shadcn components
2. Check if component can be extended vs replaced
3. Maintain consistent naming conventions

## Accessibility Requirements
- All interactive elements must be keyboard navigable
- Use proper ARIA labels on buttons and inputs
- Maintain focus management in modals/dialogs
- Ensure WCAG 2.1 AA contrast ratios

## File Locations
- shadcn components: `src/components/ui/`
- Custom components: `src/components/`
- Utilities: `src/lib/utils.ts`
- Config: `components.json`
```

#### Component Documentation (components.md)

```markdown
# shadcn/ui Component Reference

## Button
```tsx
import { Button } from "@/components/ui/button"

// Variants: default, destructive, outline, secondary, ghost, link
// Sizes: default, sm, lg, icon
<Button variant="default" size="sm">Click me</Button>
```

## Input
```tsx
import { Input } from "@/components/ui/input"

<Input type="text" placeholder="Enter text..." className="h-9" />
```

## Dialog
```tsx
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog"

<Dialog>
  <DialogTrigger asChild>
    <Button>Open</Button>
  </DialogTrigger>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogHeader>
    {/* Content */}
  </DialogContent>
</Dialog>
```

## Tabs
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>
```

## Card
```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content</CardContent>
</Card>
```

## ScrollArea
```tsx
import { ScrollArea } from "@/components/ui/scroll-area"

<ScrollArea className="h-72">
  {/* Scrollable content */}
</ScrollArea>
```

## Resizable Panels
```tsx
import { ResizablePanelGroup, ResizablePanel, ResizableHandle }
  from "@/components/ui/resizable"

<ResizablePanelGroup direction="horizontal">
  <ResizablePanel defaultSize={25}>Left</ResizablePanel>
  <ResizableHandle />
  <ResizablePanel defaultSize={75}>Right</ResizablePanel>
</ResizablePanelGroup>
```
```

#### Usage Patterns (patterns.md)

```markdown
# shadcn/ui Usage Patterns

## Form Pattern
```tsx
<form onSubmit={handleSubmit} className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="email">Email</Label>
    <Input id="email" type="email" placeholder="email@example.com" />
  </div>
  <Button type="submit">Submit</Button>
</form>
```

## Responsive Dialog/Drawer Pattern
```tsx
const isMobile = useIsMobile();

return isMobile ? (
  <Drawer>
    <DrawerTrigger asChild>{trigger}</DrawerTrigger>
    <DrawerContent>{content}</DrawerContent>
  </Drawer>
) : (
  <Dialog>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent>{content}</DialogContent>
  </Dialog>
);
```

## Loading Button Pattern
```tsx
<Button disabled={isLoading}>
  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  {isLoading ? 'Loading...' : 'Submit'}
</Button>
```

## Status Badge Pattern
```tsx
const statusColors = {
  pending: 'bg-yellow-500/10 text-yellow-500',
  running: 'bg-blue-500/10 text-blue-500',
  completed: 'bg-green-500/10 text-green-500',
  failed: 'bg-red-500/10 text-red-500',
};

<Badge className={statusColors[status]}>{status}</Badge>
```
```

---

### 5. Existing Claude Skill Patterns in Codebase

#### Current Skill Structure

Located at `agent/configs/sports-nfl-admin/.claude/skills/`:

```
skills/
├── fetch-nfl/
│   ├── SKILL.md
│   └── scripts/nfl_odds_api.py
├── fetch-nba/
│   ├── SKILL.md
│   └── scripts/nba_odds_api.py
├── fetch-odds/
│   ├── SKILL.md
│   └── scripts/odds_api.py
└── fetch-play-by-play/
    ├── SKILL.md
    └── scripts/get_scores.py
```

#### SKILL.md Format (from existing skills)

```yaml
---
name: fetch-nfl
description: Fetch NFL odds and game data from The Odds API
allowed-tools:
  - Bash
  - Read
  - Write
---

# Skill instructions and documentation here...
```

#### Key Observations

1. **Minimal frontmatter**: `name`, `description`, `allowed-tools`
2. **Scripts directory**: Python/shell scripts for automation
3. **Tool restrictions**: Skills specify which tools they can use
4. **Self-contained documentation**: Each SKILL.md is comprehensive

---

## Code References

### Current Frontend Files
- `apps/web/src/components/` - All 14 React components
- `apps/web/tailwind.config.js:6-21` - Custom color theme
- `apps/web/src/index.css:1-26` - Global styles and scrollbar
- `apps/web/src/components/Layout.tsx:71-113` - Three-panel layout
- `apps/web/src/components/Icons.tsx:7-253` - Custom icon components

### Skill Pattern Files
- `agent/configs/sports-nfl-admin/.claude/skills/` - Existing skill examples
- `packages/shared/src/agentConfig.ts` - Agent configuration types

### Prior Research
- `thoughts/shared/research/2025-12-23-cursor-like-frontend-redesign-best-practices.md` - shadcn/ui recommendation

---

## Architecture Documentation

### Current Tech Stack
- **Frontend**: Vite v5 + React 18 + TypeScript
- **Styling**: Tailwind CSS v3.4 (custom dark theme)
- **State**: React Context (no Redux/Zustand)
- **Routing**: React Router v7
- **Build**: Vite with code splitting
- **Backend**: Hono + Claude Agent SDK

### Proposed shadcn/ui Integration
- **Components**: `src/components/ui/` (shadcn managed)
- **Custom**: `src/components/` (app-specific)
- **Icons**: lucide-react (replacing custom Icons.tsx)
- **Utilities**: `src/lib/utils.ts` (cn helper)
- **Config**: `components.json` (shadcn configuration)

### Design System Alignment
| Current | shadcn/ui Equivalent |
|---------|---------------------|
| `#0a0a0a` background | `--background: 0 0% 4%` |
| `#fafafa` foreground | `--foreground: 0 0% 98%` |
| `#3b82f6` primary | `--primary: 217 91% 60%` |
| JetBrains Mono | Inter (user preference) |
| Custom scrollbar | ScrollArea component |
| Manual resizers | ResizablePanelGroup |

---

## Historical Context (from thoughts/)

### Prior Decisions
- `2025-12-23-cursor-like-frontend-redesign-best-practices.md`: Recommended shadcn/ui as primary UI library (103k+ GitHub stars)
- `2025-12-19-agent-app-boilerplate.md`: Specified "Tailwind CSS + shadcn/ui" in tech stack
- `2025-11-29-claude-code-ui-redesign.md`: Outlined dark-mode-first styling approach

### Relevant Research
- `2025-12-23-cursor-like-frontend-redesign-best-practices.md` - Comprehensive shadcn/ui research
- `2025-12-19-sdk-ui-patterns.md` - Claude SDK message display patterns
- `2025-12-23-smart-json-viewer-framework.md` - Component registry patterns

---

## Open Questions

1. **Font Migration**: Should the app switch from JetBrains Mono (monospace) to Inter (sans-serif) as specified in the preset URL, or keep monospace for the code-centric interface?

2. **Mobile Priority**: How important is mobile responsiveness for the initial migration? The current app is desktop-focused.

3. **Skill Scope**: Should the shadcn/ui Claude skill also cover:
   - Theming/customization
   - Form validation patterns (react-hook-form + zod)
   - Animation patterns (framer-motion)

4. **Migration Approach**: Full rewrite vs incremental component replacement?

5. **Component Library Scope**: Which shadcn components are must-haves vs nice-to-haves for the current feature set?

---

## Sources

### shadcn/ui Documentation
- [shadcn/ui Homepage](https://ui.shadcn.com/)
- [CLI Documentation](https://ui.shadcn.com/docs/cli)
- [Theming Guide](https://ui.shadcn.com/docs/theming)
- [components.json Reference](https://ui.shadcn.com/docs/components-json)
- [Create Project Builder](https://ui.shadcn.com/create)
- [Changelog (Dec 2025)](https://ui.shadcn.com/docs/changelog)

### Installation Guides
- [Vite Installation](https://ui.shadcn.com/docs/installation/vite)

### Responsive Patterns
- [Responsive Dialog/Drawer](https://www.nextjsshop.com/resources/blog/responsive-dialog-drawer-shadcn-ui)
- [Credenza Component](https://github.com/redpangilinan/credenza)

### Community Resources
- [Awesome shadcn/ui](https://github.com/birobirobiro/awesome-shadcn-ui)
- [Cursor Rules Guide](https://cursorrules.org/article/shadcn-cursor-mdc-file)
