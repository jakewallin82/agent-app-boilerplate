---
date: 2025-12-23T19:32:54Z
researcher: Claude
git_commit: 6287344788ef92251f2686728b557341b3a4a733
branch: main
repository: agent-app-boilerplate
topic: "Smart JSON Viewer Framework Design"
tags: [research, codebase, json-viewer, schema-matching, react-components, agent-config]
status: complete
last_updated: 2025-12-23
last_updated_by: Claude
---

# Research: Smart JSON Viewer Framework Design

**Date**: 2025-12-23T19:32:54Z
**Researcher**: Claude
**Git Commit**: 6287344788ef92251f2686728b557341b3a4a733
**Branch**: main
**Repository**: agent-app-boilerplate

## Research Question

Design a framework for creating a "Smart JSON Viewer" that:
1. Auto-matches JSON output against schemas defined in agent config
2. Renders matched JSON with custom React components instead of raw JSON
3. Supports modular, composable component templates
4. Enables easy editing with auto-save persistence
5. Handles nested references (e.g., markdown files referenced in JSON)
6. Provides a template system for rapid component creation

## Summary

This document proposes a comprehensive framework for Smart JSON Viewing with schema-based component matching. The design leverages the existing agent configuration system (`agents.json`) to define schema-component mappings per agent type. The framework uses a registry pattern for components, JSON Schema for matching, and a template system for rapid development.

**Key Design Decisions:**
- Schema definitions stored alongside agent configs
- Component registry pattern with lazy loading
- Discriminated union approach for content type resolution
- Debounced auto-save with optimistic UI updates
- Modular sub-component system for nested content (markdown, tables, etc.)

---

## Detailed Findings

### Current State Analysis

#### Existing File Viewer Architecture

The current file viewer system (`FileViewerTabs.tsx:35-46`) uses a simple switch statement:

```typescript
switch (activeTab.file.fileType) {
  case 'md':
    return <MarkdownViewer content={activeTab.content} />;
  case 'json':
    return <JsonViewer content={activeTab.content} />;
  default:
    return <pre>...</pre>;
}
```

**Limitations:**
- File type determined only by extension
- No content-based detection
- Single renderer per type
- No schema validation
- Read-only display

#### Agent Configuration System

Agents are configured in `apps/server/src/config/agents.json` with the following structure:

```json
{
  "version": "1.0.0",
  "defaultAgentId": "default",
  "agents": {
    "sports-nfl": {
      "id": "sports-nfl",
      "name": "NFL Sports Prediction Agent",
      "configDir": "sports-nfl",
      "fileLoading": {
        "sharedFiles": "copy-on-start",
        "includePatterns": ["predictions/**", "reflections/**"]
      }
    }
  }
}
```

**Extension Point:** Add `viewMappings` field for schema-component associations.

#### Existing Component Patterns

Current viewer components follow consistent patterns:
- Simple props interface (`{ content: string }`)
- Error handling for invalid data
- Syntax highlighting/formatting
- Tailwind-based styling

---

### Proposed Framework Architecture

#### 1. Schema-Component Mapping Configuration

**Extend AgentConfig in `packages/shared/src/agentConfig.ts`:**

```typescript
/**
 * Maps JSON schemas to viewer components
 */
export interface ViewMapping {
  /** Unique identifier for this mapping */
  id: string;

  /** Human-readable name */
  name: string;

  /** JSON Schema to match against file content */
  schema: JSONSchema7;

  /** Component identifier in the registry */
  component: string;

  /** File path patterns to apply this mapping (optional, faster than schema matching) */
  filePatterns?: string[];

  /** Priority when multiple schemas match (higher wins) */
  priority?: number;
}

/**
 * Sub-component configuration for nested content
 */
export interface SubComponentMapping {
  /** JSON path to the nested content (e.g., "$.summary") */
  path: string;

  /** How to resolve the content */
  type: 'inline' | 'file-reference';

  /** Component to render the content */
  component: string;
}

/**
 * Complete view mappings configuration
 */
export interface ViewMappingsConfig {
  /** Schema-to-component mappings */
  mappings: ViewMapping[];

  /** Sub-component configurations for nested content */
  subComponents?: SubComponentMapping[];

  /** Default component for unmatched JSON */
  defaultComponent?: string;
}

// Extend AgentConfig
export interface AgentConfig {
  // ... existing fields ...

  /** Schema-to-component mappings for smart JSON viewing */
  viewMappings?: ViewMappingsConfig;
}
```

**Example Configuration in `agents.json`:**

```json
{
  "sports-nfl": {
    "id": "sports-nfl",
    "viewMappings": {
      "mappings": [
        {
          "id": "nfl-predictions",
          "name": "NFL Game Predictions",
          "filePatterns": ["predictions/**/*.json"],
          "schema": {
            "type": "object",
            "required": ["name", "objects"],
            "properties": {
              "name": { "type": "string" },
              "objects": { "type": "array" },
              "summary": { "type": "string" }
            }
          },
          "component": "PredictionViewer",
          "priority": 10
        },
        {
          "id": "nfl-weekly-schedule",
          "name": "NFL Weekly Schedule",
          "schema": {
            "type": "object",
            "required": ["week", "games"],
            "properties": {
              "week": { "type": "number" },
              "season": { "type": "string" },
              "games": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["homeTeam", "awayTeam"],
                  "properties": {
                    "homeTeam": { "type": "string" },
                    "awayTeam": { "type": "string" },
                    "spread": { "type": "number" },
                    "prediction": { "type": "string" }
                  }
                }
              }
            }
          },
          "component": "WeeklyScheduleViewer",
          "priority": 10
        }
      ],
      "subComponents": [
        {
          "path": "$.summary",
          "type": "file-reference",
          "component": "MarkdownViewer"
        }
      ],
      "defaultComponent": "JsonViewer"
    }
  }
}
```

#### 2. Component Registry System

**Create `apps/web/src/lib/viewerRegistry.ts`:**

```typescript
import React from 'react';

/**
 * Props interface for all viewer components (Phase 1: Read-Only)
 */
export interface ViewerProps<T = unknown> {
  /** Parsed JSON data */
  data: T;

  /** Raw content string (for fallback) */
  content: string;

  /** File metadata */
  file: AgentFile;

  /** Sub-component renderer for nested content (e.g., file references) */
  renderSubComponent?: (path: string, content: string) => React.ReactNode;
}

/**
 * Component registration entry
 */
interface RegistryEntry {
  component: React.ComponentType<ViewerProps<any>>;
  lazy?: boolean;
}

/**
 * Component registry singleton
 */
class ViewerRegistry {
  private components = new Map<string, RegistryEntry>();
  private loadedComponents = new Map<string, React.ComponentType<ViewerProps<any>>>();

  /**
   * Register a viewer component
   */
  register(
    id: string,
    component: React.ComponentType<ViewerProps<any>>,
    options?: { lazy?: boolean }
  ) {
    this.components.set(id, { component, lazy: options?.lazy });
  }

  /**
   * Register a lazy-loaded viewer component
   */
  registerLazy(
    id: string,
    loader: () => Promise<{ default: React.ComponentType<ViewerProps<any>> }>
  ) {
    const LazyComponent = React.lazy(loader);
    this.components.set(id, { component: LazyComponent, lazy: true });
  }

  /**
   * Get a registered component
   */
  get(id: string): React.ComponentType<ViewerProps<any>> | null {
    const entry = this.components.get(id);
    return entry?.component ?? null;
  }

  /**
   * Check if a component is registered
   */
  has(id: string): boolean {
    return this.components.has(id);
  }

  /**
   * List all registered component IDs
   */
  list(): string[] {
    return Array.from(this.components.keys());
  }
}

export const viewerRegistry = new ViewerRegistry();

// Register built-in components
viewerRegistry.register('JsonViewer', JsonViewer);
viewerRegistry.register('MarkdownViewer', MarkdownViewer);
```

#### 3. Schema Matching Service

**Create `apps/web/src/lib/schemaMatcher.ts`:**

```typescript
import Ajv from 'ajv';
import { minimatch } from 'minimatch';
import type { ViewMapping, ViewMappingsConfig } from '@agent-app/shared';

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Result of schema matching
 */
export interface MatchResult {
  mapping: ViewMapping;
  confidence: 'exact' | 'schema' | 'pattern' | 'none';
}

/**
 * Match JSON content against configured schemas
 */
export function matchSchema(
  content: string,
  filePath: string,
  config: ViewMappingsConfig
): MatchResult | null {
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(content);
  } catch {
    return null; // Not valid JSON
  }

  const matches: Array<MatchResult & { priority: number }> = [];

  for (const mapping of config.mappings) {
    // Check file patterns first (fast path)
    if (mapping.filePatterns) {
      const patternMatch = mapping.filePatterns.some(pattern =>
        minimatch(filePath, pattern)
      );
      if (patternMatch) {
        matches.push({
          mapping,
          confidence: 'pattern',
          priority: mapping.priority ?? 0,
        });
        continue;
      }
    }

    // Check schema match
    if (mapping.schema) {
      const validate = ajv.compile(mapping.schema);
      if (validate(parsedData)) {
        matches.push({
          mapping,
          confidence: 'schema',
          priority: mapping.priority ?? 0,
        });
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Sort by priority (descending), then by confidence
  matches.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    const confidenceOrder = { exact: 3, pattern: 2, schema: 1, none: 0 };
    return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
  });

  return matches[0];
}

/**
 * Extract sub-component content from JSON
 */
export function extractSubComponent(
  data: unknown,
  path: string
): unknown | null {
  // Simple JSONPath-like extraction ($.field.subfield)
  const parts = path.replace(/^\$\.?/, '').split('.');
  let current: any = data;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return null;
    }
    current = current[part];
  }

  return current;
}
```

#### 4. Smart JSON Viewer Component

**Create `apps/web/src/components/SmartJsonViewer.tsx`:**

```typescript
import React, { Suspense, useMemo, useState, useCallback } from 'react';
import { viewerRegistry, type ViewerProps } from '@/lib/viewerRegistry';
import { matchSchema, extractSubComponent } from '@/lib/schemaMatcher';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { JsonViewer } from './JsonViewer';
import { LoaderIcon } from './Icons';
import type { AgentFile } from '@/types';

interface SmartJsonViewerProps {
  content: string;
  file: AgentFile;
  agentId?: string;
  onSave?: (content: string) => Promise<void>;
}

export function SmartJsonViewer({
  content,
  file,
  agentId = 'default',
  onSave,
}: SmartJsonViewerProps) {
  const { config, isLoading: configLoading } = useAgentConfig(agentId);
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<unknown>(null);

  // Parse and match schema
  const { parsedData, matchResult, Component } = useMemo(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { parsedData: null, matchResult: null, Component: JsonViewer };
    }

    if (!config?.viewMappings) {
      return { parsedData: parsed, matchResult: null, Component: JsonViewer };
    }

    const match = matchSchema(content, file.filePath, config.viewMappings);

    if (!match) {
      const defaultId = config.viewMappings.defaultComponent ?? 'JsonViewer';
      return {
        parsedData: parsed,
        matchResult: null,
        Component: viewerRegistry.get(defaultId) ?? JsonViewer,
      };
    }

    const Comp = viewerRegistry.get(match.mapping.component);
    return {
      parsedData: parsed,
      matchResult: match,
      Component: Comp ?? JsonViewer,
    };
  }, [content, file.filePath, config]);

  // Sub-component renderer
  const renderSubComponent = useCallback(
    (path: string, rawContent: string) => {
      const subConfig = config?.viewMappings?.subComponents?.find(
        (sc) => sc.path === path
      );

      if (!subConfig) {
        return <pre className="text-sm">{rawContent}</pre>;
      }

      const SubComponent = viewerRegistry.get(subConfig.component);
      if (!SubComponent) {
        return <pre className="text-sm">{rawContent}</pre>;
      }

      // Handle file references
      if (subConfig.type === 'file-reference') {
        // Content is a file path - would need to fetch
        return (
          <div className="border rounded p-2">
            <p className="text-xs text-muted-foreground mb-2">
              Referenced file: {rawContent}
            </p>
            {/* FileReferenceLoader component would go here */}
          </div>
        );
      }

      return <SubComponent data={rawContent} content={rawContent} file={file} />;
    },
    [config, file]
  );

  // Handle data changes (for editable mode)
  const handleDataChange = useCallback(
    (newData: unknown) => {
      setEditedData(newData);
      // Auto-save with debounce would be triggered here
    },
    []
  );

  if (configLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        <LoaderIcon size={14} />
        <span>Loading viewer configuration...</span>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-4 text-muted-foreground">
          <LoaderIcon size={14} />
          <span>Loading viewer component...</span>
        </div>
      }
    >
      <div className="relative">
        {/* Match indicator (development/debug) */}
        {matchResult && (
          <div className="absolute top-2 right-2 text-xs bg-card px-2 py-1 rounded border border-border">
            <span className="text-muted-foreground">Matched: </span>
            <span className="text-primary">{matchResult.mapping.name}</span>
          </div>
        )}

        <Component
          data={isEditing ? editedData ?? parsedData : parsedData}
          content={content}
          file={file}
          onChange={handleDataChange}
          isEditing={isEditing}
          renderSubComponent={renderSubComponent}
        />
      </div>
    </Suspense>
  );
}
```

#### 5. Example Custom Viewer: NFL Predictions (Read-Only)

**Create `apps/web/src/components/viewers/PredictionViewer.tsx`:**

```typescript
import React from 'react';
import type { ViewerProps } from '@/lib/viewerRegistry';

/**
 * Schema for NFL predictions
 */
interface NFLPrediction {
  name: string;
  objects: GamePrediction[];
  summary?: string;
}

interface GamePrediction {
  homeTeam: string;
  awayTeam: string;
  spread: number;
  prediction: 'home' | 'away' | 'push';
  confidence: number;
  reasoning?: string;
}

/**
 * Read-only prediction viewer component
 */
export function PredictionViewer({
  data,
  renderSubComponent,
}: ViewerProps<NFLPrediction>) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{data.name}</h2>
        <span className="text-sm text-muted-foreground">
          {data.objects.length} predictions
        </span>
      </div>

      {/* Predictions Grid */}
      <div className="grid gap-3">
        {data.objects.map((game, index) => (
          <div
            key={index}
            className="p-3 bg-card rounded-lg border border-border hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{game.awayTeam}</span>
                <span className="text-muted-foreground">@</span>
                <span className="font-medium">{game.homeTeam}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Spread: {game.spread > 0 ? '+' : ''}{game.spread}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    game.prediction === 'home'
                      ? 'bg-green-500/20 text-green-400'
                      : game.prediction === 'away'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}
                >
                  {game.prediction === 'home'
                    ? game.homeTeam
                    : game.prediction === 'away'
                    ? game.awayTeam
                    : 'PUSH'}
                </span>
              </div>

              {/* Confidence bar */}
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${game.confidence}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-8">
                  {game.confidence}%
                </span>
              </div>
            </div>

            {game.reasoning && (
              <p className="mt-2 text-sm text-muted-foreground">
                {game.reasoning}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Summary (sub-component via file reference) */}
      {data.summary && renderSubComponent && (
        <div className="mt-6 pt-4 border-t border-border">
          <h3 className="text-sm font-medium mb-2 text-muted-foreground">
            Summary
          </h3>
          {renderSubComponent('$.summary', data.summary)}
        </div>
      )}
    </div>
  );
}
```

#### 6. Component Registration and Initialization

**Create `apps/web/src/lib/registerViewers.ts`:**

```typescript
import { viewerRegistry } from './viewerRegistry';
import { JsonViewer } from '@/components/JsonViewer';
import { MarkdownViewer } from '@/components/MarkdownViewer';

// Register built-in viewers
viewerRegistry.register('JsonViewer', JsonViewer);
viewerRegistry.register('MarkdownViewer', MarkdownViewer);

// Register custom viewers lazily
viewerRegistry.registerLazy(
  'PredictionViewer',
  () => import('@/components/viewers/PredictionViewer').then(m => ({ default: m.PredictionViewer }))
);

viewerRegistry.registerLazy(
  'WeeklyScheduleViewer',
  () => import('@/components/viewers/WeeklyScheduleViewer').then(m => ({ default: m.WeeklyScheduleViewer }))
);

// Export for initialization
export function initializeViewerRegistry() {
  // Registry is populated on import
  console.log('[VIEWER_REGISTRY] Initialized with:', viewerRegistry.list());
}
```

#### 7. Hook for Agent Config Access

**Create `apps/web/src/hooks/useAgentConfig.ts`:**

```typescript
import { useState, useEffect } from 'react';
import type { AgentConfig } from '@agent-app/shared';

// Cache for agent configs
const configCache = new Map<string, AgentConfig>();

/**
 * Fetch agent config from API
 */
async function fetchAgentConfig(agentId: string): Promise<AgentConfig> {
  const cached = configCache.get(agentId);
  if (cached) return cached;

  const res = await fetch(`/api/agent/configs/${agentId}`, {
    headers: await getAuthHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch agent config: ${res.status}`);
  }

  const config = await res.json();
  configCache.set(agentId, config);
  return config;
}

/**
 * Hook to access agent configuration
 */
export function useAgentConfig(agentId: string) {
  const [config, setConfig] = useState<AgentConfig | null>(
    configCache.get(agentId) ?? null
  );
  const [isLoading, setIsLoading] = useState(!configCache.has(agentId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (configCache.has(agentId)) {
      setConfig(configCache.get(agentId)!);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchAgentConfig(agentId)
      .then((c) => {
        setConfig(c);
        setError(null);
      })
      .catch((e) => {
        setError(e);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [agentId]);

  return { config, isLoading, error };
}
```

---

## Architecture Insights

### Design Patterns Used

1. **Registry Pattern**: Component registry allows dynamic registration and lazy loading of viewer components.

2. **Strategy Pattern**: Schema matching uses pluggable strategies (file pattern, JSON Schema) with priority-based resolution.

3. **Template Method Pattern**: `EditableViewerTemplate` provides the skeleton for editable viewers while allowing customization of view/edit rendering.

4. **Composition Pattern**: Sub-components are composed into parent viewers via `renderSubComponent` callback.

5. **Observer Pattern**: Auto-save uses debounced callbacks to observe data changes.

### Data Flow

```
Agent Output JSON
       │
       ▼
┌──────────────────┐
│  SmartJsonViewer │
│  - Parse JSON    │
│  - Match Schema  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Schema Matcher  │
│  - File patterns │
│  - JSON Schema   │
│  - Priority sort │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Component Registry│
│  - Lookup by ID  │
│  - Lazy load     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Custom Viewer    │
│  - View mode     │
│  - Edit mode     │
│  - Sub-components│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Auto-Save       │
│  - Debounce      │
│  - Validation    │
│  - Persist       │
└──────────────────┘
```

### Integration Points

1. **FileViewerTabs.tsx**: Replace switch statement with SmartJsonViewer for JSON files
2. **agents.json**: Add viewMappings configuration per agent
3. **API Routes**: Add `/api/agent/configs/:agentId` endpoint
4. **File Save API**: Add endpoint for persisting edited files

---

## Trade-off Analysis

### Approach 1: Configuration-Driven (Recommended)

**Pros:**
- Schemas and mappings defined in agent config (single source of truth)
- Easy to add new viewers without code changes
- Supports file pattern matching for fast path
- JSON Schema validation is well-established

**Cons:**
- Requires API endpoint to expose configs to frontend
- Schema definitions can be verbose
- Runtime schema compilation has performance cost

### Approach 2: Convention-Based

**Pros:**
- Zero configuration for standard patterns
- File naming conventions determine viewer (e.g., `*.predictions.json`)
- Simple to understand

**Cons:**
- Less flexible
- Requires consistent file naming
- No schema validation

### Approach 3: Inline Type Markers

**Pros:**
- Self-describing JSON with `$type` or `$schema` field
- No external configuration needed
- Works with any file name

**Cons:**
- Requires agent to include type markers
- Pollutes data with metadata
- Not compatible with external JSON sources

### Recommendation

Use **Approach 1 (Configuration-Driven)** with file patterns as fast path:

1. First check file patterns (fast, no parsing)
2. Fall back to JSON Schema matching (accurate, slower)
3. Use default viewer if no match

---

## Claude Skill Integration

### Skill Definition for Component Generation

**Create `.claude/skills/generate-viewer.md`:**

```markdown
# Generate Smart JSON Viewer Component

When asked to create a new viewer component for a JSON schema:

1. **Analyze the Schema**
   - Identify required and optional fields
   - Determine data types and nested structures
   - Note any arrays that need iteration

2. **Generate Component Files**
   - Create viewer in `apps/web/src/components/viewers/`
   - Follow naming convention: `{SchemaName}Viewer.tsx`
   - Use EditableViewerTemplate for editable viewers

3. **Register Component**
   - Add lazy registration in `apps/web/src/lib/registerViewers.ts`
   - Add mapping in agent's `viewMappings` config

4. **Template Structure**

```tsx
import React from 'react';
import type { ViewerProps } from '@/lib/viewerRegistry';
import { EditableViewerTemplate } from '../templates/EditableViewerTemplate';

interface {SchemaName} {
  // Define interface from schema
}

function {SchemaName}ViewMode({ data }: { data: {SchemaName} }) {
  return (
    <div className="space-y-4">
      {/* Render view */}
    </div>
  );
}

function {SchemaName}EditMode({
  data,
  onChange,
}: {
  data: {SchemaName};
  onChange: (data: {SchemaName}) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Render editable form */}
    </div>
  );
}

export function {SchemaName}Viewer(props: ViewerProps<{SchemaName}>) {
  return (
    <EditableViewerTemplate
      {...props}
      renderView={(data) => <{SchemaName}ViewMode data={data} />}
      renderEdit={(data, onChange) => (
        <{SchemaName}EditMode data={data} onChange={onChange} />
      )}
      autoSaveDelay={1500}
    />
  );
}
```

5. **Common UI Patterns**
   - Cards for list items: `p-3 bg-card rounded-lg border border-border`
   - Status badges: `px-2 py-0.5 rounded text-xs font-medium`
   - Confidence bars: Progress bar with percentage
   - Grid layouts: `grid grid-cols-2 gap-3`
   - Section headers: `text-sm font-medium text-muted-foreground`
```

---

## Implementation Roadmap

### Phase 1: MVP - Read-Only Smart Viewers

**Scope**: Pre-built, read-only viewer components that match JSON against schemas and render custom UIs. All components must be coded and deployed with the app.

**What's IN Phase 1:**
- Schema files stored in `agent/schemas/*.schema.json`
- Viewer mappings in agent config pointing to pre-built components
- Component registry with lazy loading
- Schema matching (file patterns + JSON Schema validation)
- Sub-component rendering for nested content (e.g., markdown in JSON)
- On-demand file reference fetching
- Auto-discovery of schemas from `agent/schemas/` directory

**What's NOT in Phase 1:**
- Dynamic/declarative viewer generation
- Editable viewers or edit mode
- Auto-save functionality
- Schema persistence in Supabase
- Agent generating viewers mid-run

#### Phase 1 Implementation Steps

**Step 1: Types & Configuration (1 day)**
1. Add `ViewMapping` and `ViewMappingsConfig` types to `packages/shared/src/agentConfig.ts`
2. Create `agent/schemas/` directory structure
3. Update `agents.json` with `viewMappings` pointing to schema files
4. Add API endpoint `GET /api/agent/configs/:agentId` to expose config to frontend

**Step 2: Schema Matching (1 day)**
1. Create `apps/web/src/lib/schemaMatcher.ts` with:
   - File pattern matching (fast path)
   - JSON Schema validation via Ajv
   - Priority-based resolution
2. Create `apps/web/src/lib/viewerRegistry.ts` for component registration

**Step 3: SmartJsonViewer Component (1 day)**
1. Create `apps/web/src/components/SmartJsonViewer.tsx`
2. Create `apps/web/src/hooks/useAgentConfig.ts` for config fetching
3. Update `FileViewerTabs.tsx` to use SmartJsonViewer for JSON files
4. Add sub-component rendering support with `renderSubComponent` callback

**Step 4: File Reference Loading (0.5 day)**
1. Create `apps/web/src/components/FileReferenceLoader.tsx`
2. Resolve relative paths from parent file's directory
3. Fetch content on-demand via existing file API
4. Render with appropriate sub-component (MarkdownViewer, etc.)

**Step 5: Example Viewers (1 day)**
1. Create `apps/web/src/components/viewers/PredictionViewer.tsx`
2. Create `apps/web/src/components/viewers/WeeklyScheduleViewer.tsx`
3. Create corresponding schemas in `agent/schemas/`
4. Register viewers in `apps/web/src/lib/registerViewers.ts`
5. Configure mappings in `sports-nfl` agent config

**Step 6: Polish & Testing (0.5 day)**
1. Add loading states for schema matching
2. Fallback to JsonViewer when no match
3. Error handling for invalid schemas
4. Test with various JSON structures

**Total Phase 1: ~5 days**

---

### Phase 2: Editable Viewers (Future)

**Scope**: Add edit mode for admin users with auto-save.

1. Create `EditableViewerTemplate.tsx` with view/edit toggle
2. Add auto-save with debounce (`use-debounce` library)
3. Create file save API endpoint `POST /api/files/:fileId/save`
4. Gate edit mode behind admin role check
5. Add validation before save
6. Update example viewers to support edit mode

---

### Phase 3: Dynamic Viewer Generation (Future)

**Scope**: Allow agent to generate viewer specifications mid-run.

1. Define declarative viewer specification format (`.viewer.json`)
2. Create `ViewerInterpreter.tsx` to render declarative specs
3. Build primitive component library:
   - `table`, `cards`, `accordion`, `badge`, `header`, `row`, `text`
4. Auto-discover viewer specs from `agent/viewers/` directory
5. Agent can create schema + viewer spec + data in single run

---

### Phase 4: Claude Skill for Component Generation (Future)

**Scope**: Claude skill to help developers create new viewer components.

1. Create `.claude/skills/generate-viewer.md`
2. Document component patterns and templates
3. Skill generates TypeScript code for new viewers
4. Skill updates registry and config automatically

---

## Code References

- `apps/web/src/components/FileViewerTabs.tsx:35-46` - Current file type dispatch
- `apps/web/src/components/JsonViewer.tsx` - Existing JSON viewer
- `apps/web/src/components/MarkdownViewer.tsx` - Existing markdown viewer
- `apps/server/src/config/agents.json` - Agent configuration
- `packages/shared/src/agentConfig.ts` - Agent config types
- `apps/web/src/contexts/FileContext.tsx` - File state management
- `apps/web/src/components/SubagentViewer.tsx` - Expandable viewer pattern
- `apps/web/src/components/ToolUseDisplay.tsx` - Tool display pattern

---

## Phase 1 Happy Path Scenario

**Context**: NFL agent outputs predictions, frontend renders with custom viewer.

### Setup (Before Runtime)

```
agent/
├── schemas/
│   └── nfl-predictions.schema.json    # JSON Schema for predictions
│
└── configs/
    └── sports-nfl/
        └── CLAUDE.md

apps/server/src/config/agents.json     # viewMappings config
apps/web/src/components/viewers/
    └── PredictionViewer.tsx           # Pre-built React component
apps/web/src/lib/registerViewers.ts    # Component registration
```

### Runtime Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ User: "Generate predictions for Week 15"                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Agent writes: predictions/week-15.json                          │
│ {                                                               │
│   "name": "Week 15 Predictions",                                │
│   "objects": [                                                  │
│     { "homeTeam": "Bills", "awayTeam": "Chiefs",                │
│       "spread": -2.5, "prediction": "home", "confidence": 78 }  │
│   ],                                                            │
│   "summary": "./week-15-summary.md"                             │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Agent writes: predictions/week-15-summary.md                    │
│ # Week 15 Analysis                                              │
│ Home teams favored in cold weather...                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Server: SSE file_events sent to frontend                        │
│ - predictions/week-15.json (created)                            │
│ - predictions/week-15-summary.md (created)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ User clicks: predictions/week-15.json in FileExplorer           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FileViewerTabs detects JSON, delegates to SmartJsonViewer       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ SmartJsonViewer:                                                │
│ 1. Parse JSON content                                           │
│ 2. Load agent config (sports-nfl) with viewMappings             │
│ 3. Check file pattern: "predictions/**/*.json" ✓ MATCH          │
│ 4. OR validate against nfl-predictions.schema.json ✓ MATCH      │
│ 5. Lookup component: "PredictionViewer" from registry           │
│ 6. Render PredictionViewer with parsed data                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PredictionViewer renders:                                       │
│ - Detects data.summary = "./week-15-summary.md"                 │
│ - Calls renderSubComponent('$.summary', './week-15-summary.md') │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FileReferenceLoader:                                            │
│ 1. Resolve relative path from predictions/ directory            │
│    → predictions/week-15-summary.md                             │
│ 2. Fetch file content via signed URL                            │
│ 3. Render MarkdownViewer with fetched content                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Final rendered output:                                          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Week 15 Predictions                          1 prediction   │ │
│ │                                                             │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ Chiefs @ Bills                     Spread: -2.5         │ │ │
│ │ │ [BILLS]                            ████████░░ 78%       │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │                                                             │ │
│ │ ── Summary ──────────────────────────────────────────────── │ │
│ │ # Week 15 Analysis                                          │ │
│ │ Home teams favored in cold weather...                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### No Viewer Match → Fallback to JsonViewer

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent writes: research/random-analysis.json                     │
│ { "topic": "Weather impact", "findings": [...] }                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ SmartJsonViewer:                                                │
│ 1. Parse JSON                                                   │
│ 2. Check file patterns: no match                                │
│ 3. Validate against all schemas: no match                       │
│ 4. Use defaultComponent: "JsonViewer"                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ JsonViewer renders with syntax highlighting (existing behavior) │
└─────────────────────────────────────────────────────────────────┘
```

---

## Resolved Questions

1. **Schema Storage**: Store schemas in `agent/schemas/*.schema.json` files, agent config references by path.

2. **Component Discovery**: Auto-discovery from `agent/schemas/` directory.

3. **Edit Permissions**: Admin-only (Phase 2 feature).

4. **File Reference Resolution**: Fetch on-demand when viewer renders.

5. **Schema Versioning**: Not addressing in Phase 1.

## Remaining Open Questions

1. **Schema-to-Viewer Mapping**: How should schemas associate with viewer components?
   - Option A: Naming convention (`nfl-predictions.schema.json` → `PredictionViewer`)
   - Option B: Explicit mapping in agent config `viewMappings`
   - Option C: Schema file includes `$viewer` field pointing to component

2. **Fallback Behavior**: When schema matches but no viewer component exists, should we:
   - Show raw JSON with JsonViewer?
   - Show error message?
   - Show schema-aware generic viewer (auto-table for arrays, etc.)?

---

## Related Research

- `thoughts/shared/plans/2025-12-22-multi-agent-filesystem-configuration.md` - Original implementation plan for agent configuration system
