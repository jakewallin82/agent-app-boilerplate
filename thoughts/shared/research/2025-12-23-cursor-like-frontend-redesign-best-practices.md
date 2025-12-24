---
date: 2025-12-23T10:30:00-08:00
researcher: Claude
git_commit: ec6d3093518d5223fb15ae4c1db719656e30c6da
branch: main
repository: agent-app-boilerplate
topic: "Cursor-Like Frontend Redesign: Best Practices for AI Chat Interfaces, shadcn/ui, Storybook, and Design Systems"
tags: [research, frontend, design-system, shadcn-ui, storybook, dark-mode, ai-chat-interface, cursor, mcp, figma]
status: complete
last_updated: 2025-12-23
last_updated_by: Claude
---

# Research: Cursor-Like Frontend Redesign Best Practices

**Date**: 2025-12-23T10:30:00-08:00
**Researcher**: Claude
**Git Commit**: ec6d3093518d5223fb15ae4c1db719656e30c6da
**Branch**: main
**Repository**: agent-app-boilerplate

## Research Question

How to redesign a frontend with a cursor-like agent chat interface, leveraging:
- Best practices for AI-assisted design with Claude
- shadcn/ui component library patterns
- Storybook integration
- Dark mode component library patterns
- Lightweight design workflows (with or without Figma)

---

## Executive Summary

This comprehensive research covers the complete landscape of building modern AI chat interfaces in 2025. Key findings:

1. **shadcn/ui dominates** the AI chat interface space with 103k+ GitHub stars, described as "the default UI lib of LLMs"
2. **assistant-ui** (400k+ monthly downloads) provides production-ready chat primitives built on shadcn/ui
3. **MCP servers** (Model Context Protocol) are game-changers for AI-assisted development
4. **Dark mode** requires semantic design tokens, CSS custom properties, and 4.5:1 WCAG contrast ratios
5. **Lightweight Figma alternatives** like Penpot, Excalidraw, and tldraw work well for developer-focused workflows
6. **Storybook 8/10** with Chromatic provides robust visual testing and documentation

---

## Current Frontend Architecture Analysis

### Your Codebase (`apps/web/`)

**Tech Stack:**
- React 18.2 + TypeScript + Vite
- Tailwind CSS 3.4.0 (dark mode only, hardcoded)
- Context API for state management (4 contexts)
- No external UI component library
- Custom SVG icon library

**Key Files:**
- `apps/web/src/components/` - 14 component files (flat structure)
- `apps/web/src/contexts/` - 4 context providers (Auth, Session, File, DevMode)
- `apps/web/tailwind.config.js` - Dark theme colors hardcoded (not CSS variables)
- `apps/web/src/components/ChatInterface.tsx` - 580 lines, main chat orchestrator

**Current Architecture Patterns:**
```
AuthContext (top-level)
└─→ DevModeProvider
     └─→ SessionProvider
          └─→ FileProvider
               └─→ App Components
```

**Styling Approach:**
- Utility-first Tailwind, no CSS modules
- Dark mode only (`class="dark"` on html)
- JetBrains Mono monospace font globally
- No light/dark toggle

**State Management:**
- Timeline + Maps pattern for messages (`messagesMap`, `subagentsMap`)
- LocalStorage for session persistence
- SSE streaming for real-time updates

### Gaps for Redesign

1. **No CSS custom properties** - Colors hardcoded in Tailwind config
2. **No theme toggle** - Dark mode only
3. **Flat component structure** - Could benefit from atomic design organization
4. **No Storybook** - Missing component documentation
5. **Custom icons** - Could use lucide-react for consistency

---

## Recommended Component Library: shadcn/ui

### Why shadcn/ui?

- **103k+ GitHub stars** - Dominant in the ecosystem
- **"Default UI lib of LLMs"** - v0, Bolt, Lovable all use it
- **Copy-paste ownership** - You own the code, no vendor lock-in
- **Built on Radix UI** - Excellent accessibility out of the box
- **Tailwind native** - Perfect for your existing setup
- **MCP server available** - Claude can access component specs directly

### Installation

```bash
npx shadcn@latest init
```

Configure for your project:
- Style: Default
- Base color: Slate (or customize)
- CSS variables: **Yes** (critical for theming)
- Tailwind CSS: Already have
- React Server Components: No (Vite project)

### Key Components for Chat Interface

```bash
# Essential for chat UI
npx shadcn@latest add button input textarea
npx shadcn@latest add card dialog sheet
npx shadcn@latest add scroll-area separator
npx shadcn@latest add dropdown-menu tabs
npx shadcn@latest add avatar badge
npx shadcn@latest add skeleton # for loading states
```

### Theming System

shadcn/ui uses HSL CSS variables:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    /* ... more tokens */
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    /* ... dark overrides */
  }
}
```

**Migration from hardcoded colors:**

```javascript
// BEFORE (tailwind.config.js)
colors: {
  background: '#0a0a0a',
  foreground: '#fafafa',
}

// AFTER (tailwind.config.js + CSS variables)
colors: {
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
}
```

---

## Chat Interface Libraries & Patterns

### Top Recommendation: assistant-ui

**GitHub:** [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui)
**Downloads:** 400k+ monthly
**Adopters:** LangChain, Browser Use

**Features:**
- Composable primitives (like Radix UI for chat)
- Real-time streaming with auto-scroll
- Markdown + code syntax highlighting
- File attachment handling
- WCAG accessibility compliance
- Built on shadcn/ui theming

**Installation:**
```bash
npx assistant-ui@latest create
# or add to existing project
npm install @assistant-ui/react @assistant-ui/react-markdown
```

**Key Components:**
- `<Thread>` - Full chat interface
- `<ThreadMessages>` - Message list with auto-scroll
- `<ThreadInput>` - Input with attachments
- `<AssistantMessage>` - AI message with tool call rendering

### Cursor-Like Interface Patterns

**From Cursor's design philosophy:**

1. **Explain before tool calls** - Show reasoning before each tool execution
2. **Tool use visualization** - Display tools through UI components, not raw markdown
3. **Context summarization** - Smaller models summarize earlier messages
4. **Agent mode** - Unified chat + composer interface

**Key UI Patterns:**
- Left sidebar: File explorer / sessions
- Center: Chat interface with streaming
- Right panel: File viewer / tool results (conditional)
- Resizable panels with drag handles
- Tool calls as collapsible cards

### Open Source References

| Project | Stars | Best For |
|---------|-------|----------|
| [LobeChat](https://github.com/lobehub/lobe-chat) | High | Full-featured AI workspace |
| [Chatbot UI](https://github.com/mckaywrigley/chatbot-ui) | High | Multi-model chat |
| [Continue.dev](https://github.com/continuedev/continue) | High | IDE chat extension |
| [Agent UI](https://github.com/agno-agi/agent-ui) | Medium | Agent interface with tool viz |

---

## Dark Mode Implementation

### Recommended Pattern: CSS Variables + next-themes (or custom provider)

**Step 1: CSS Variable Setup**

```css
/* globals.css */
@layer base {
  :root {
    /* Semantic tokens */
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --border: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --border: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}
```

**Step 2: Theme Provider (for Vite/React)**

```typescript
// contexts/ThemeContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({ theme: 'system', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && systemDark);

    root.classList.toggle('dark', isDark);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        document.documentElement.classList.toggle('dark', mediaQuery.matches);
      }
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

**Step 3: Prevent FOUC (Flash of Unstyled Content)**

Add inline script to `index.html` `<head>`:

```html
<script>
  (function() {
    const theme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (!theme && prefersDark) || (theme === 'system' && prefersDark);
    if (isDark) document.documentElement.classList.add('dark');
  })();
</script>
```

### WCAG Contrast Requirements

- **Normal text:** 4.5:1 minimum (AA)
- **Large text (18pt+):** 3:1 minimum
- **UI components:** 3:1 minimum
- **Avoid pure black (#000):** Use `#121212` or similar (Material Design standard)
- **Avoid pure white (#FFF):** Use `#F1F1F1` for less eye strain

### Theme Toggle Animation (Optional)

Using View Transitions API:

```typescript
const toggleTheme = async () => {
  if (!document.startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setTheme(newTheme);
    return;
  }

  await document.startViewTransition(() => {
    flushSync(() => setTheme(newTheme));
  }).ready;

  // Circular reveal animation
  document.documentElement.animate({
    clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`]
  }, { duration: 500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' });
};
```

---

## Storybook Integration

### Setup for Vite + React + Tailwind

```bash
npx storybook@latest init
```

**Configure Tailwind in `.storybook/preview.js`:**

```javascript
import '../src/index.css'; // Your Tailwind imports

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: { expanded: true },
};
```

### Dark Mode in Storybook

Install theme addon:

```bash
npm install @storybook/addon-themes
```

Configure in `.storybook/preview.js`:

```javascript
import { withThemeByClassName } from '@storybook/addon-themes';

export const decorators = [
  withThemeByClassName({
    themes: {
      light: '',
      dark: 'dark',
    },
    defaultTheme: 'dark',
  }),
];
```

### CSF3 Story Example

```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@/components/ui/button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { children: 'Button', variant: 'default' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};
```

### Visual Testing with Chromatic

```bash
npm install chromatic
npx chromatic --project-token=YOUR_TOKEN
```

**Features:**
- Captures screenshots of every story
- Detects visual changes
- Runs in CI/CD pipeline
- Free tier available (5,000 snapshots/month)

### AI-Assisted Story Generation

Use Claude with StorybookGPT patterns:

```
Create Storybook stories for this component using CSF3 format:
[paste component code]

Include stories for:
- Default state
- All variant options
- Loading state
- Error state
- Interactive example with play function
```

---

## MCP Servers for Design Workflows

### Essential MCP Servers

| Server | Purpose | Installation |
|--------|---------|--------------|
| **shadcn/ui** | Component specs, accurate props | `claude mcp add shadcn https://www.shadcn.io/api/mcp` |
| **Figma** | Design tokens, measurements | Via Figma plugin |
| **GitHub** | Code, issues, PRs | Official MCP server |
| **Sentry** | Error context, patches | For debugging |

### shadcn/ui MCP Setup

```bash
# Quick install for Claude Code
claude mcp add --transport http shadcn https://www.shadcn.io/api/mcp

# Or in .mcp.json
{
  "mcpServers": {
    "shadcn": {
      "url": "https://www.shadcn.io/api/mcp"
    }
  }
}
```

**Capabilities:**
- Browse available components
- Get accurate prop types
- Install components via conversation
- Access community registries

### Impact of MCP

**Without MCP:** Claude hallucinates props, uses outdated patterns, code fails at runtime
**With MCP:** Accurate, working components aligned with latest specs

---

## Lightweight Figma Alternatives

### For Developer-Focused Workflows

| Tool | Best For | Key Feature |
|------|----------|-------------|
| **[Penpot](https://penpot.app/)** | Full design with code export | Native design tokens, SVG-based |
| **[Excalidraw](https://excalidraw.com/)** | Quick wireframes, ideation | Hand-drawn aesthetic, real-time collab |
| **[tldraw](https://tldraw.com/)** | Infinite canvas, diagrams | Also a React library |
| **[Lunacy](https://icons8.com/lunacy)** | Offline native app | Imports Figma files |

### Recommended Workflow (No Figma)

1. **Ideation:** Excalidraw for quick wireframes
2. **Component Design:** Claude + frontend-design skill for variants
3. **Documentation:** Storybook for live component library
4. **Iteration:** v0.dev for rapid UI generation

### v0.dev Integration

```bash
# Generate component
# Visit v0.dev, describe your UI

# Install generated code
npx v0 add [component-url]
```

**Best for:**
- Rapid prototyping
- Exploring design variations
- Getting production-ready shadcn/ui code

---

## AI-Assisted Design Workflows

### Claude Skills for Frontend Design

**Built-in `frontend-design` skill:**
- Generates distinctive, non-generic interfaces
- Focuses on bold aesthetic direction
- Considers typography, color, motion, backgrounds

**Invoke:**
```
/skill frontend-design
Create a dashboard for [your use case] with a [aesthetic direction] vibe
```

### Custom Design System Skill (30 min setup)

1. Request 5 design variants from Claude
2. Pick and refine preferred design
3. Generate documentation markdown
4. Package into reusable skill
5. Apply across all future components

### Practical Prompts

```
"Create a chat message component with:
- User/assistant variants
- Streaming state with pulse animation
- Markdown content support
- Tool call expansion
- Use shadcn/ui primitives and Tailwind
- Dark mode support via CSS variables"
```

---

## Recommended Redesign Architecture

### Folder Structure

```
apps/web/src/
├── components/
│   ├── ui/                    # shadcn/ui primitives
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   └── ...
│   ├── chat/                  # Chat-specific components
│   │   ├── ChatInterface.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageInput.tsx
│   │   ├── ToolCallCard.tsx
│   │   └── SubagentViewer.tsx
│   ├── layout/                # Layout components
│   │   ├── Layout.tsx
│   │   ├── Sidebar.tsx
│   │   ├── RightPanel.tsx
│   │   └── ResizablePanel.tsx
│   └── shared/                # Shared/reusable
│       ├── MarkdownViewer.tsx
│       ├── JsonViewer.tsx
│       └── FileIcon.tsx
├── contexts/                  # Same structure, add ThemeContext
├── lib/
│   ├── api.ts
│   ├── supabase.ts
│   └── utils.ts               # cn() helper for classnames
├── styles/
│   └── globals.css            # CSS variables, Tailwind imports
└── stories/                   # Storybook stories (co-located or separate)
```

### Migration Priority

1. **Phase 1: Foundation**
   - Add CSS custom properties for colors
   - Install shadcn/ui CLI and core components
   - Add `cn()` utility
   - Setup ThemeProvider

2. **Phase 2: Core Components**
   - Replace buttons with shadcn Button
   - Replace inputs with shadcn Input/Textarea
   - Add Card components for messages
   - Add ScrollArea for chat

3. **Phase 3: Chat UI**
   - Consider assistant-ui integration OR
   - Build custom with shadcn primitives
   - Add streaming states, tool call cards

4. **Phase 4: Documentation**
   - Setup Storybook
   - Create stories for each component
   - Add Chromatic for visual testing

---

## Code References

### Open Source Repositories

- **shadcn/ui:** https://github.com/shadcn-ui/ui (103k stars)
- **assistant-ui:** https://github.com/assistant-ui/assistant-ui (400k monthly downloads)
- **LobeChat:** https://github.com/lobehub/lobe-chat (full AI workspace)
- **Chatbot UI:** https://github.com/mckaywrigley/chatbot-ui (multi-model)
- **awesome-shadcn-ui:** https://github.com/birobirobiro/awesome-shadcn-ui (curated resources)

### Documentation

- **shadcn/ui Docs:** https://ui.shadcn.com/docs
- **shadcn/ui Dark Mode:** https://ui.shadcn.com/docs/dark-mode
- **shadcn/ui MCP:** https://ui.shadcn.com/docs/mcp
- **Tailwind Dark Mode:** https://tailwindcss.com/docs/dark-mode
- **Storybook 8:** https://storybook.js.org/docs

### Tools

- **v0.dev:** https://v0.dev (AI UI generator)
- **Chromatic:** https://www.chromatic.com (visual testing)
- **Penpot:** https://penpot.app (Figma alternative)
- **Excalidraw:** https://excalidraw.com (whiteboarding)

---

## Open Questions

1. **assistant-ui vs custom build?** - assistant-ui provides significant time savings but adds dependency. Custom build gives full control.

2. **Storybook hosting?** - Chromatic, Vercel, or self-hosted? Chromatic integrates best but has usage limits.

3. **Design token format?** - CSS variables (recommended), JSON (W3C format), or both for tooling?

4. **Migration strategy?** - Incremental (component by component) or big bang? Recommend incremental.

5. **Light mode support?** - Currently dark-only. Adding light mode requires testing all components in both themes.

---

## Summary Recommendations

| Area | Recommendation | Priority |
|------|----------------|----------|
| Component Library | shadcn/ui | High |
| Chat Primitives | assistant-ui or custom | High |
| Theming | CSS variables + ThemeProvider | High |
| Documentation | Storybook 8 + Chromatic | Medium |
| Design Workflow | v0.dev + Claude skills | Medium |
| Figma Alternative | Penpot or Excalidraw | Low |
| MCP Integration | shadcn/ui MCP server | High |

**Estimated Effort:**
- Phase 1 (Foundation): 1-2 days
- Phase 2 (Core Components): 2-3 days
- Phase 3 (Chat UI): 3-5 days
- Phase 4 (Documentation): 2-3 days

**Total:** ~2 weeks for full redesign with documentation
