# shadcn/ui Migration Implementation Plan

## Overview

Migrate the agent-app-boilerplate web frontend from hand-built Tailwind components to shadcn/ui, establishing a consistent design system with reusable components. This is an incremental migration that maintains existing functionality while progressively adopting shadcn/ui patterns.

## Current State Analysis

**Existing Infrastructure:**
- 14 React components in `apps/web/src/components/`
- Tailwind CSS v3.4 with custom dark theme
- Semantic color tokens already defined (bg-card, text-muted-foreground, etc.)
- Custom `Icons.tsx` with 12 SVG icons
- JetBrains Mono monospace font globally
- No third-party UI component library

**Key Patterns Found:**
- Repeated button styles across AuthPage, MessageInput, ChatInterface
- Card patterns with `bg-card border border-border rounded-lg`
- Custom expand/collapse logic in SubagentViewer, ToolUseDisplay
- Three-panel resizable layout in Layout.tsx
- Tab navigation in FileViewerTabs and RightPanel

## Desired End State

After completion:
1. shadcn/ui initialized with `new-york` style and `neutral` base color
2. CSS variables for theming in `index.css`
3. Core shadcn components installed in `src/components/ui/`
4. lucide-react replacing custom Icons.tsx
5. Inter font for UI, JetBrains Mono for code blocks only
6. Existing components migrated to use shadcn primitives
7. Claude skill for shadcn/ui usage documented

### Verification:
- `npm run build` succeeds with no errors
- All existing features work identically
- Components use shadcn patterns (Button, Input, Card, etc.)
- Design consistency across all views

## What We're NOT Doing

- Mobile responsiveness (deferred to future phase)
- Dark/light theme toggle (staying dark-only)
- Form validation library integration (react-hook-form + zod)
- Animation library (framer-motion)
- Additional shadcn components beyond core set

---

## Phase 1: Foundation Setup

### Overview
Initialize shadcn/ui in the project and set up the foundational utilities and CSS variables.

### Changes Required:

#### 1. Install Dependencies
**Command**:
```bash
cd apps/web
npm install clsx class-variance-authority
npm install lucide-react
npm install @radix-ui/react-slot
```

Note: `tailwind-merge` is already installed.

#### 2. Create components.json
**File**: `apps/web/components.json`
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

#### 3. Update tsconfig.json paths
**File**: `apps/web/tsconfig.json`
Add path alias if not present:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

#### 4. Update vite.config.ts for path alias
**File**: `apps/web/vite.config.ts`
```typescript
import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

#### 5. Create cn utility
**File**: `apps/web/src/lib/utils.ts`
```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

#### 6. Update index.css with CSS Variables
**File**: `apps/web/src/index.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 4%;
    --foreground: 0 0% 98%;
    --card: 240 6% 10%;
    --card-foreground: 0 0% 98%;
    --popover: 240 6% 10%;
    --popover-foreground: 0 0% 98%;
    --primary: 217 91% 60%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 5% 16%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 5% 16%;
    --muted-foreground: 240 5% 65%;
    --accent: 240 5% 16%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5% 16%;
    --input: 240 5% 16%;
    --ring: 217 91% 60%;
    --radius: 0.375rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: 'Inter', sans-serif;
  }
  code, pre, .font-mono {
    font-family: 'JetBrains Mono', monospace;
  }
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: hsl(var(--card));
}

::-webkit-scrollbar-thumb {
  background: hsl(var(--muted));
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.5);
}
```

#### 7. Update tailwind.config.js
**File**: `apps/web/tailwind.config.js`
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
```

#### 8. Update index.html for Inter font
**File**: `apps/web/index.html`
Add Inter font to the existing JetBrains Mono link:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `cd apps/web && npm run build`
- [ ] TypeScript compiles: `cd apps/web && npx tsc --noEmit`
- [ ] Dev server starts: `cd apps/web && npm run dev` (verify no console errors)
- [ ] Path alias works: Import from `@/lib/utils` resolves correctly

#### Manual Verification:
- [ ] App loads with same dark theme appearance
- [ ] Inter font visible on UI elements (buttons, labels)
- [ ] JetBrains Mono still used in message content
- [ ] No visual regressions in existing components

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Core shadcn Components

### Overview
Install and create the core shadcn/ui components that will be used across the application.

### Changes Required:

#### 1. Create Button Component
**File**: `apps/web/src/components/ui/button.tsx`
```typescript
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
```

#### 2. Create Input Component
**File**: `apps/web/src/components/ui/input.tsx`
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
```

#### 3. Create Textarea Component
**File**: `apps/web/src/components/ui/textarea.tsx`
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
```

#### 4. Create Card Component
**File**: `apps/web/src/components/ui/card.tsx`
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border border-border bg-card text-card-foreground shadow",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-4", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-4 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
```

#### 5. Create Badge Component
**File**: `apps/web/src/components/ui/badge.tsx`
```typescript
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
```

#### 6. Create ScrollArea Component
**File**: `apps/web/src/components/ui/scroll-area.tsx`

First install the Radix primitive:
```bash
npm install @radix-ui/react-scroll-area
```

```typescript
import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
```

#### 7. Create Collapsible Component
**File**: `apps/web/src/components/ui/collapsible.tsx`

First install:
```bash
npm install @radix-ui/react-collapsible
```

```typescript
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
```

#### 8. Create UI Components Index
**File**: `apps/web/src/components/ui/index.ts`
```typescript
export { Button, buttonVariants } from "./button"
export { Input } from "./input"
export { Textarea } from "./textarea"
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./card"
export { Badge, badgeVariants } from "./badge"
export { ScrollArea, ScrollBar } from "./scroll-area"
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./collapsible"
```

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `cd apps/web && npm run build`
- [ ] TypeScript compiles: `cd apps/web && npx tsc --noEmit`
- [ ] All UI components importable from `@/components/ui`

#### Manual Verification:
- [ ] App still functions normally (no component used yet)
- [ ] No console errors on page load

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Icon Migration

### Overview
Replace custom Icons.tsx with lucide-react icons across the application.

### Changes Required:

#### 1. Create Icon Mapping Reference
The following lucide-react icons replace the custom Icons.tsx:

| Old (Icons.tsx) | New (lucide-react) |
|-----------------|-------------------|
| FolderIcon | Folder |
| FolderOpenIcon | FolderOpen |
| FileIcon | File |
| FileTextIcon | FileText |
| FileJsonIcon | FileJson |
| FileSpreadsheetIcon | FileSpreadsheet |
| PlusIcon | Plus |
| XIcon | X |
| ChevronLeftIcon | ChevronLeft |
| ChevronRightIcon | ChevronRight |
| LoaderIcon | Loader2 |
| ArrowLeftIcon | ArrowLeft |

#### 2. Update FileExplorer.tsx
**File**: `apps/web/src/components/FileExplorer.tsx`

Replace imports:
```typescript
// Before
import { FolderIcon, FileIcon, ArrowLeftIcon, FolderOpenIcon } from './Icons';
import { getFileIcon } from './Icons';

// After
import { Folder, FolderOpen, File, FileText, FileJson, FileSpreadsheet, ArrowLeft } from 'lucide-react';
```

Replace icon usage and add helper function:
```typescript
function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
      return <FileText className="w-4 h-4 text-blue-400" />;
    case 'json':
      return <FileJson className="w-4 h-4 text-yellow-400" />;
    case 'csv':
      return <FileSpreadsheet className="w-4 h-4 text-green-400" />;
    default:
      return <File className="w-4 h-4 text-muted-foreground" />;
  }
}
```

#### 3. Update FileViewerTabs.tsx
**File**: `apps/web/src/components/FileViewerTabs.tsx`

```typescript
// Before
import { XIcon, LoaderIcon } from './Icons';

// After
import { X, Loader2 } from 'lucide-react';
```

Replace `<LoaderIcon className="animate-spin" />` with `<Loader2 className="w-4 h-4 animate-spin" />`.
Replace `<XIcon />` with `<X className="w-3 h-3" />`.

#### 4. Update ChatInterface.tsx
**File**: `apps/web/src/components/ChatInterface.tsx`

```typescript
// Before
import { PlusIcon, LoaderIcon } from './Icons';

// After
import { Plus, Loader2 } from 'lucide-react';
```

#### 5. Update SubagentViewer.tsx
**File**: `apps/web/src/components/SubagentViewer.tsx`

```typescript
// Before
import { ChevronRightIcon } from './Icons';

// After
import { ChevronRight, ChevronDown } from 'lucide-react';
```

#### 6. Update ToolUseDisplay.tsx
**File**: `apps/web/src/components/ToolUseDisplay.tsx`

```typescript
// Before
import { ChevronRightIcon } from './Icons';

// After
import { ChevronRight, ChevronDown } from 'lucide-react';
```

#### 7. Update RightPanel.tsx
**File**: `apps/web/src/components/RightPanel.tsx`

```typescript
// Before
import { XIcon, ArrowLeftIcon } from './Icons';

// After
import { X, ArrowLeft } from 'lucide-react';
```

#### 8. Delete Icons.tsx
**File**: `apps/web/src/components/Icons.tsx`
Delete this file after all imports have been updated.

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `cd apps/web && npm run build`
- [ ] No imports from `./Icons` remain: `grep -r "from './Icons'" apps/web/src/`

#### Manual Verification:
- [ ] All icons display correctly in FileExplorer
- [ ] Loading spinners work in FileViewerTabs
- [ ] Expand/collapse chevrons work in SubagentViewer
- [ ] Close buttons work in tabs

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Migrate AuthPage Component

### Overview
Migrate AuthPage.tsx to use shadcn/ui Button, Input, and Card components.

### Changes Required:

#### 1. Update AuthPage.tsx
**File**: `apps/web/src/components/AuthPage.tsx`

```typescript
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">
            {isLogin ? 'Sign In' : 'Create Account'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Loading...' : isLogin ? 'Sign In' : 'Sign Up'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <Button
            variant="link"
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `cd apps/web && npm run build`
- [ ] No old button/input classes in AuthPage: `grep "bg-primary text-primary-foreground" apps/web/src/components/AuthPage.tsx` returns nothing

#### Manual Verification:
- [ ] Auth page displays correctly with card styling
- [ ] Form inputs are styled consistently
- [ ] Submit button works
- [ ] Error messages display properly
- [ ] Toggle between login/signup works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5: Migrate MessageInput Component

### Overview
Migrate MessageInput.tsx to use shadcn/ui Button and Textarea components.

### Changes Required:

#### 1. Update MessageInput.tsx
**File**: `apps/web/src/components/MessageInput.tsx`

```typescript
import { useState, KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';

interface MessageInputProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageInput({ onSubmit, disabled, placeholder = 'Type a message...' }: MessageInputProps) {
  const [message, setMessage] = useState('');

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSubmit(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex gap-2 p-3 border-t border-border bg-card">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-[40px] max-h-[200px] resize-none font-mono"
        rows={1}
      />
      <Button
        onClick={handleSubmit}
        disabled={disabled || !message.trim()}
        size="icon"
        className="shrink-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `cd apps/web && npm run build`

#### Manual Verification:
- [ ] Message input displays correctly
- [ ] Send button is styled as icon button
- [ ] Enter to send works
- [ ] Shift+Enter creates new line
- [ ] Disabled state works correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 6: Migrate Expand/Collapse Components

### Overview
Migrate SubagentViewer.tsx and ToolUseDisplay.tsx to use shadcn/ui Collapsible component.

### Changes Required:

#### 1. Update SubagentViewer.tsx
**File**: `apps/web/src/components/SubagentViewer.tsx`

Replace the manual expand/collapse state with Collapsible:

```typescript
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronDown } from 'lucide-react';
// ... rest of imports

export function SubagentViewer({ subagent, onClick }: SubagentViewerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // ... status color logic stays same

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 p-2 hover:bg-card/80 rounded text-left">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <Badge className={statusColor}>{subagent.status}</Badge>
          <span className="text-sm text-muted-foreground truncate">
            {getOneLiner(subagent)}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-6">
        {/* existing expanded content */}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

#### 2. Update ToolUseDisplay.tsx
**File**: `apps/web/src/components/ToolUseDisplay.tsx`

Apply similar pattern with Collapsible for tool call expansion.

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `cd apps/web && npm run build`

#### Manual Verification:
- [ ] Subagent cards expand/collapse smoothly
- [ ] Tool calls expand/collapse correctly
- [ ] Chevron icons rotate appropriately
- [ ] Click handling still works for navigation

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 7: Create Claude Skill for shadcn/ui

### Overview
Create a Claude skill that provides guidance for using shadcn/ui components in this project.

### Changes Required:

#### 1. Create Skill Directory Structure
```bash
mkdir -p apps/web/.claude/skills/shadcn-ui
```

#### 2. Create SKILL.md
**File**: `apps/web/.claude/skills/shadcn-ui/SKILL.md`

```markdown
---
name: shadcn-ui
description: Add and use shadcn/ui components following project design standards
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# shadcn/ui Component Skill

## Purpose
Install and configure shadcn/ui components while maintaining design consistency in the agent-app-boilerplate project.

## When to Use
- Adding new UI components to the application
- Implementing forms, modals, buttons, or interactive elements
- Building layouts with cards, panels, or containers
- Creating accessible, consistent UI patterns

## Project Configuration

This project uses:
- **Style**: new-york (compact, information-dense)
- **Base Color**: neutral
- **CSS Variables**: Yes
- **Icon Library**: lucide-react
- **Typography**: Inter (UI) + JetBrains Mono (code)

## Available Commands

### Add Component
```bash
cd apps/web && npx shadcn@latest add <component-name>
```

### Common Components
- `button` - Primary interactive element
- `input` - Form text inputs
- `textarea` - Multi-line text inputs
- `card` - Container with border and padding
- `badge` - Status indicators and labels
- `dialog` - Modal dialogs
- `tabs` - Tabbed navigation
- `scroll-area` - Custom scrollable containers
- `collapsible` - Expand/collapse sections
- `dropdown-menu` - Context menus
- `select` - Dropdown selectors
- `tooltip` - Hover information

### Add Multiple Components
```bash
npx shadcn@latest add dialog tabs dropdown-menu
```

## Design Standards

### Color Usage
- Primary actions: `bg-primary text-primary-foreground`
- Destructive: `bg-destructive text-destructive-foreground`
- Secondary: `bg-secondary text-secondary-foreground`
- Muted text: `text-muted-foreground`
- Borders: `border-border`

### Status Colors (Project Convention)
- Running/Active: `bg-blue-500/10 text-blue-400 border-blue-500/20`
- Success/Complete: `bg-green-500/10 text-green-400 border-green-500/20`
- Error/Failed: `bg-red-500/10 text-red-400 border-red-500/20`
- Warning: `bg-yellow-500/10 text-yellow-400 border-yellow-500/20`
- Tool calls: `bg-orange-500/10 text-orange-400 border-orange-500/20`
- Subagents: `bg-purple-500/10 text-purple-400 border-purple-500/20`

### Spacing (Compact Style)
- Tight padding: `p-2`, `px-3 py-1.5`
- Standard padding: `p-3`, `px-4 py-2`
- Gaps: `gap-2` (tight), `gap-3` (standard), `gap-4` (relaxed)

### Typography
- UI text: Uses Inter (default via body styles)
- Code/monospace: Add `font-mono` class

## Component Patterns

### Button Variants
```tsx
import { Button } from "@/components/ui/button"

<Button>Primary Action</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outlined</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link Style</Button>
<Button size="sm">Small</Button>
<Button size="icon"><Icon /></Button>
```

### Loading Button
```tsx
import { Loader2 } from "lucide-react"

<Button disabled={isLoading}>
  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  {isLoading ? 'Loading...' : 'Submit'}
</Button>
```

### Form Pattern
```tsx
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

<form onSubmit={handleSubmit} className="space-y-4">
  <div className="space-y-2">
    <label htmlFor="field" className="text-sm font-medium">Label</label>
    <Input id="field" placeholder="Enter value..." />
  </div>
  <Button type="submit">Submit</Button>
</form>
```

### Card Pattern
```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content here</CardContent>
</Card>
```

### Collapsible Pattern
```tsx
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { ChevronRight, ChevronDown } from "lucide-react"

<Collapsible open={isOpen} onOpenChange={setIsOpen}>
  <CollapsibleTrigger className="flex items-center gap-2">
    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    <span>Click to expand</span>
  </CollapsibleTrigger>
  <CollapsibleContent>
    Expanded content here
  </CollapsibleContent>
</Collapsible>
```

### Status Badge Pattern
```tsx
import { Badge } from "@/components/ui/badge"

const statusStyles = {
  running: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
};

<Badge className={statusStyles[status]}>{status}</Badge>
```

## File Locations

- shadcn components: `src/components/ui/`
- Custom components: `src/components/`
- Utilities: `src/lib/utils.ts`
- Config: `components.json`

## Before Adding Components

1. Check if component already exists: `ls src/components/ui/`
2. Check if similar pattern exists in codebase
3. Consider extending existing components vs adding new ones
4. Maintain consistent naming conventions

## Accessibility Requirements

- All interactive elements must be keyboard navigable
- Use proper ARIA labels on buttons and inputs
- Maintain focus management in modals/dialogs
- Ensure sufficient color contrast
```

### Success Criteria:

#### Automated Verification:
- [ ] Skill file exists: `test -f apps/web/.claude/skills/shadcn-ui/SKILL.md`

#### Manual Verification:
- [ ] Skill provides helpful guidance when referenced
- [ ] Component patterns match project conventions
- [ ] Color/spacing values align with existing design

**Implementation Note**: After completing this phase and all automated verification passes, the migration is complete!

---

## Testing Strategy

### Unit Tests
No new unit tests required for this migration - existing functionality is preserved.

### Integration Tests
- Verify build completes without errors
- Verify dev server starts correctly
- Verify no TypeScript errors

### Manual Testing Steps
1. Navigate through all pages (Auth, Chat, File Explorer)
2. Verify all buttons are clickable and styled
3. Verify all inputs accept text
4. Verify expand/collapse interactions work
5. Verify icons display correctly
6. Verify Inter font is used for UI, JetBrains Mono for code

## Performance Considerations

- lucide-react uses tree-shaking, only imported icons are bundled
- shadcn/ui components are copied locally, no external dependencies at runtime
- CSS variables are computed once, efficient for theming

## Migration Notes

### Breaking Changes
- Icons.tsx is deleted - any external imports will break
- Direct Tailwind button classes may look different with CVA variants

### Rollback Strategy
- Git history preserves previous state
- `npm install` will restore previous dependencies
- CSS variables can be removed to revert to hardcoded colors

## References

- Research document: `thoughts/shared/research/2025-12-26-shadcn-ui-migration-and-claude-skill.md`
- shadcn/ui docs: https://ui.shadcn.com/docs
- lucide-react icons: https://lucide.dev/icons
