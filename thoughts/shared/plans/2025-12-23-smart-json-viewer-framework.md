# Smart JSON Viewer Framework Implementation Plan

## Overview

Implement a framework for "Smart JSON Viewing" that auto-matches JSON output against schemas defined in agent configuration and renders matched JSON with custom React components instead of raw JSON. This plan covers Phase 1: Read-Only Smart Viewers.

## Current State Analysis

### Existing File Viewing Architecture

**Entry Point**: `apps/web/src/components/FileViewerTabs.tsx:35-46`
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
- No content-based detection or schema matching
- Single renderer per type
- No custom viewers for specific JSON structures
- Read-only display only

### Existing Agent Configuration System

**Config Location**: `apps/server/src/config/agents.json`
**Types**: `packages/shared/src/agentConfig.ts`

The system already supports per-agent configuration for storage, security, and file loading. We will extend this with `viewMappings`.

### Key Discoveries

- No `viewers/` directory exists yet - needs creation: `apps/web/src/components/viewers/`
- No `hooks/` directory exists yet - needs creation: `apps/web/src/hooks/`
- No API endpoint exists for fetching agent config from frontend
- FileContext already handles file content fetching via signed URLs
- Existing JsonViewer at `apps/web/src/components/JsonViewer.tsx` provides good fallback
- Agent directory structure: `agent/configs/{agentId}/` with CLAUDE.md and .claude/

## Desired End State

After implementation:
1. JSON files can be rendered with custom React components based on schema matching
2. Agent configs define `viewMappings` with file patterns and JSON schemas
3. SmartJsonViewer component automatically matches and renders appropriate viewer
4. Component registry allows lazy-loaded viewer registration
5. Sub-components can render nested content (markdown files referenced in JSON)
6. Fallback to standard JsonViewer when no schema matches

### Verification

- Opening a predictions JSON file renders PredictionViewer instead of raw JSON
- File pattern matching works (e.g., `predictions/**/*.json`)
- JSON Schema validation works for content matching
- Sub-component references (markdown files) load and render inline
- Unknown JSON falls back to JsonViewer gracefully

## What We're NOT Doing

- **NO editable viewers** - Phase 1 is read-only
- **NO auto-save functionality** - Future phase
- **NO dynamic/declarative viewer generation** - Viewers are pre-built React components
- **NO schema persistence in database** - Schemas defined in config/files
- **NO agent-generated viewers** - All viewers coded and deployed with app

---

## Implementation Approach

We will extend the agent configuration system with `viewMappings`, create a component registry for viewer lookup, implement schema matching, and update FileViewerTabs to use the new SmartJsonViewer component.

**Design Decisions:**
1. **Schema-to-Viewer Mapping**: Use explicit mapping in agent config `viewMappings` (most flexible)
2. **Fallback Behavior**: Fall back to JsonViewer when no viewer matches
3. **Schema Storage**: External schema files in `agent/schemas/{agentId}/` referenced by path in config
4. **Matching Strategy**: File patterns first (fast), then JSON Schema validation (accurate)

---

## Phase 1: Types & Configuration Extension

### Overview
Extend the shared types and agent configuration to support view mappings.

### Changes Required:

#### 1. Add View Mapping Types
**File**: `packages/shared/src/agentConfig.ts`
**Changes**: Add new interfaces for view mappings after existing types

```typescript
// Add after line 116 (after AgentConfig interface)

import type { JSONSchema7 } from 'json-schema';

/**
 * Maps JSON schemas to viewer components
 */
export interface ViewMapping {
  /** Unique identifier for this mapping */
  id: string;

  /** Human-readable name */
  name: string;

  /** Path to JSON Schema file (relative to agent/schemas/{agentId}/) */
  schemaPath?: string;

  /** Inline JSON Schema (alternative to schemaPath) */
  schema?: JSONSchema7;

  /** Component identifier in the registry */
  component: string;

  /** File path patterns to apply this mapping (glob patterns) */
  filePatterns?: string[];

  /** Priority when multiple schemas match (higher wins, default 0) */
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
```

#### 2. Extend AgentConfig Interface
**File**: `packages/shared/src/agentConfig.ts`
**Changes**: Add `viewMappings` field to AgentConfig interface

```typescript
// Modify AgentConfig interface (lines 86-116)
// Add after line 115 (before closing brace):

  /** Schema-to-component mappings for smart JSON viewing */
  viewMappings?: ViewMappingsConfig;
```

#### 3. Add json-schema Types Package
**File**: `packages/shared/package.json`
**Changes**: Add dev dependency for JSON Schema types

```json
{
  "devDependencies": {
    "@types/json-schema": "^7.0.15"
  }
}
```

#### 4. Example Agent Config Update
**File**: `apps/server/src/config/agents.json`
**Changes**: Add viewMappings to sports-nfl agent (example configuration)

```json
{
  "sports-nfl": {
    "id": "sports-nfl",
    "name": "NFL Sports Prediction Agent",
    "description": "NFL game predictions and analysis for users",
    "configDir": "sports-nfl",
    "viewMappings": {
      "mappings": [
        {
          "id": "nfl-predictions",
          "name": "NFL Game Predictions",
          "filePatterns": ["predictions/**/*.json"],
          "schemaPath": "nfl-predictions.schema.json",
          "component": "PredictionViewer",
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

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors: `cd packages/shared && npm run build`
- [ ] Types are properly exported from shared package

#### Manual Verification:
- [ ] New types appear in IDE autocomplete when editing agents.json

---

## Phase 2: Schema Files & API Endpoint

### Overview
Create schema directory structure and API endpoint for frontend to access agent configurations.

### Changes Required:

#### 1. Create Schema Directory Structure
**Location**: `agent/schemas/`

```
agent/
├── schemas/
│   └── sports-nfl/
│       └── nfl-predictions.schema.json
└── configs/
    └── sports-nfl/
        └── CLAUDE.md
```

#### 2. Create Example Schema File
**File**: `agent/schemas/sports-nfl/nfl-predictions.schema.json`
**Changes**: Create new file

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "nfl-predictions",
  "title": "NFL Game Predictions",
  "type": "object",
  "required": ["name", "objects"],
  "properties": {
    "name": {
      "type": "string",
      "description": "Name of the predictions set"
    },
    "objects": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["homeTeam", "awayTeam"],
        "properties": {
          "homeTeam": { "type": "string" },
          "awayTeam": { "type": "string" },
          "spread": { "type": "number" },
          "prediction": {
            "type": "string",
            "enum": ["home", "away", "push"]
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 100
          },
          "reasoning": { "type": "string" }
        }
      }
    },
    "summary": {
      "type": "string",
      "description": "Path to summary markdown file"
    }
  }
}
```

#### 3. Create Agent Config API Route
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Add new endpoint after existing routes

```typescript
// Add new endpoint for fetching agent config (add after warmup endpoint ~line 355)

/**
 * GET /api/agent/configs/:agentId
 * Get agent configuration for frontend use
 */
router.get('/configs/:agentId', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const config = getAgentConfig(agentId);

    // Only expose necessary fields to frontend
    const publicConfig = {
      id: config.id,
      name: config.name,
      description: config.description,
      viewMappings: config.viewMappings,
    };

    res.json(publicConfig);
  } catch (error) {
    console.error('[AGENT_CONFIG] Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch agent config' });
  }
});
```

#### 4. Create Schema Loading Service
**File**: `apps/server/src/services/schemaLoader.ts`
**Changes**: Create new file for loading schema files

```typescript
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { JSONSchema7 } from 'json-schema';

const SCHEMAS_DIR = process.env.AGENT_SCHEMAS_DIR ||
  resolve(__dirname, '../../../../agent/schemas');

// Cache for loaded schemas
const schemaCache = new Map<string, JSONSchema7>();

/**
 * Load a schema file for an agent
 */
export function loadSchema(agentId: string, schemaPath: string): JSONSchema7 | null {
  const cacheKey = `${agentId}:${schemaPath}`;

  if (schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey)!;
  }

  const fullPath = resolve(SCHEMAS_DIR, agentId, schemaPath);

  if (!existsSync(fullPath)) {
    console.warn(`[SCHEMA_LOADER] Schema not found: ${fullPath}`);
    return null;
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const schema = JSON.parse(content) as JSONSchema7;
    schemaCache.set(cacheKey, schema);
    return schema;
  } catch (error) {
    console.error(`[SCHEMA_LOADER] Error loading schema ${fullPath}:`, error);
    return null;
  }
}

/**
 * Clear schema cache (for testing/hot-reload)
 */
export function clearSchemaCache(): void {
  schemaCache.clear();
}
```

#### 5. Enhance Config Endpoint with Resolved Schemas
**File**: `apps/server/src/routes/agent.ts`
**Changes**: Modify the config endpoint to resolve schemaPath to inline schemas

```typescript
// Update the configs endpoint to resolve schema paths
import { loadSchema } from '../services/schemaLoader';

router.get('/configs/:agentId', authMiddleware, async (req, res) => {
  try {
    const { agentId } = req.params;
    const config = getAgentConfig(agentId);

    // Resolve schema paths to inline schemas
    let resolvedMappings = config.viewMappings?.mappings;
    if (resolvedMappings) {
      resolvedMappings = resolvedMappings.map(mapping => {
        if (mapping.schemaPath && !mapping.schema) {
          const schema = loadSchema(config.id, mapping.schemaPath);
          return { ...mapping, schema: schema ?? undefined };
        }
        return mapping;
      });
    }

    const publicConfig = {
      id: config.id,
      name: config.name,
      description: config.description,
      viewMappings: config.viewMappings ? {
        ...config.viewMappings,
        mappings: resolvedMappings,
      } : undefined,
    };

    res.json(publicConfig);
  } catch (error) {
    console.error('[AGENT_CONFIG] Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch agent config' });
  }
});
```

### Success Criteria:

#### Automated Verification:
- [ ] Server starts without errors: `npm run dev`
- [ ] API endpoint returns config: `curl http://localhost:3001/api/agent/configs/sports-nfl`
- [ ] Schema is resolved and included in response

#### Manual Verification:
- [ ] Schema file is readable from the configured path
- [ ] API returns viewMappings with resolved schema

---

## Phase 3: Component Registry System

### Overview
Create the viewer registry for managing component registration and lookup.

### Changes Required:

#### 1. Create Viewer Registry
**File**: `apps/web/src/lib/viewerRegistry.ts`
**Changes**: Create new file

```typescript
import React from 'react';
import type { AgentFile } from '@/types';

/**
 * Props interface for all viewer components
 */
export interface ViewerProps<T = unknown> {
  /** Parsed JSON data */
  data: T;

  /** Raw content string (for fallback) */
  content: string;

  /** File metadata */
  file: AgentFile;

  /** Sub-component renderer for nested content */
  renderSubComponent?: (path: string, content: string) => React.ReactNode;
}

/**
 * Component registration entry
 */
interface RegistryEntry {
  component: React.ComponentType<ViewerProps<any>>;
  lazy: boolean;
}

/**
 * Component registry singleton
 */
class ViewerRegistry {
  private components = new Map<string, RegistryEntry>();

  /**
   * Register a viewer component
   */
  register(id: string, component: React.ComponentType<ViewerProps<any>>): void {
    this.components.set(id, { component, lazy: false });
  }

  /**
   * Register a lazy-loaded viewer component
   */
  registerLazy(
    id: string,
    loader: () => Promise<{ default: React.ComponentType<ViewerProps<any>> }>
  ): void {
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
   * Check if a component is lazy-loaded
   */
  isLazy(id: string): boolean {
    return this.components.get(id)?.lazy ?? false;
  }

  /**
   * List all registered component IDs
   */
  list(): string[] {
    return Array.from(this.components.keys());
  }
}

export const viewerRegistry = new ViewerRegistry();
```

#### 2. Create Viewer Registration Module
**File**: `apps/web/src/lib/registerViewers.ts`
**Changes**: Create new file

```typescript
import { viewerRegistry } from './viewerRegistry';

// Import built-in viewers (these will be wrapped to match ViewerProps)
// We'll register them with adapters

/**
 * Adapter to wrap existing JsonViewer to match ViewerProps interface
 */
function createJsonViewerAdapter() {
  return function JsonViewerAdapter({ content }: { data: unknown; content: string }) {
    // Dynamically import to avoid circular dependency
    const { JsonViewer } = require('@/components/JsonViewer');
    return <JsonViewer content={content} />;
  };
}

/**
 * Adapter to wrap existing MarkdownViewer to match ViewerProps interface
 */
function createMarkdownViewerAdapter() {
  return function MarkdownViewerAdapter({ content }: { data: unknown; content: string }) {
    const { MarkdownViewer } = require('@/components/MarkdownViewer');
    return <MarkdownViewer content={content} />;
  };
}

/**
 * Initialize the viewer registry with built-in and custom viewers
 */
export function initializeViewerRegistry(): void {
  // Register built-in viewers with adapters
  viewerRegistry.register('JsonViewer', createJsonViewerAdapter());
  viewerRegistry.register('MarkdownViewer', createMarkdownViewerAdapter());

  // Register custom viewers lazily
  viewerRegistry.registerLazy(
    'PredictionViewer',
    () => import('@/components/viewers/PredictionViewer').then(m => ({ default: m.PredictionViewer }))
  );

  console.log('[VIEWER_REGISTRY] Initialized with:', viewerRegistry.list());
}

// Auto-initialize on import
initializeViewerRegistry();
```

#### 3. Create lib Directory Index
**File**: `apps/web/src/lib/index.ts`
**Changes**: Create or update to export registry

```typescript
export { viewerRegistry, type ViewerProps } from './viewerRegistry';
export { initializeViewerRegistry } from './registerViewers';
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `cd apps/web && npm run typecheck`
- [ ] No circular dependency errors

#### Manual Verification:
- [ ] Registry logs registered components on app load

---

## Phase 4: Schema Matching Service

### Overview
Create the schema matching logic for the frontend.

### Changes Required:

#### 1. Install Dependencies
**File**: `apps/web/package.json`
**Changes**: Add ajv for JSON Schema validation and minimatch for glob patterns

```json
{
  "dependencies": {
    "ajv": "^8.12.0",
    "minimatch": "^9.0.3"
  }
}
```

#### 2. Create Schema Matcher
**File**: `apps/web/src/lib/schemaMatcher.ts`
**Changes**: Create new file

```typescript
import Ajv from 'ajv';
import { minimatch } from 'minimatch';
import type { JSONSchema7 } from 'json-schema';

/**
 * Public config type (subset exposed to frontend)
 */
export interface PublicAgentConfig {
  id: string;
  name: string;
  description?: string;
  viewMappings?: ViewMappingsConfig;
}

export interface ViewMapping {
  id: string;
  name: string;
  schema?: JSONSchema7;
  component: string;
  filePatterns?: string[];
  priority?: number;
}

export interface SubComponentMapping {
  path: string;
  type: 'inline' | 'file-reference';
  component: string;
}

export interface ViewMappingsConfig {
  mappings: ViewMapping[];
  subComponents?: SubComponentMapping[];
  defaultComponent?: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });

// Cache compiled validators
const validatorCache = new Map<string, ReturnType<typeof ajv.compile>>();

/**
 * Result of schema matching
 */
export interface MatchResult {
  mapping: ViewMapping;
  confidence: 'pattern' | 'schema' | 'none';
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
    if (mapping.filePatterns && mapping.filePatterns.length > 0) {
      const patternMatch = mapping.filePatterns.some(pattern =>
        minimatch(filePath, pattern, { matchBase: true })
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

    // Check schema match (slower, more accurate)
    if (mapping.schema) {
      const cacheKey = mapping.id;
      let validate = validatorCache.get(cacheKey);

      if (!validate) {
        try {
          validate = ajv.compile(mapping.schema);
          validatorCache.set(cacheKey, validate);
        } catch (error) {
          console.error(`[SCHEMA_MATCHER] Failed to compile schema ${mapping.id}:`, error);
          continue;
        }
      }

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

  // Sort by priority (descending), then by confidence (pattern > schema)
  matches.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    const confidenceOrder = { pattern: 2, schema: 1, none: 0 };
    return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
  });

  return matches[0];
}

/**
 * Extract sub-component content from JSON using simple path notation
 * Supports paths like "$.summary" or "$.objects[0].name"
 */
export function extractSubComponentPath(data: unknown, path: string): unknown | null {
  // Remove $. prefix if present
  const normalizedPath = path.replace(/^\$\.?/, '');
  if (!normalizedPath) return data;

  const parts = normalizedPath.split('.');
  let current: any = data;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return null;
    }

    // Handle array notation like "items[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]]?.[parseInt(arrayMatch[2], 10)];
    } else {
      current = current[part];
    }
  }

  return current;
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Dependencies install: `cd apps/web && npm install`
- [ ] TypeScript compiles: `npm run typecheck`

#### Manual Verification:
- [ ] Schema matching returns correct result for test JSON

---

## Phase 5: useAgentConfig Hook

### Overview
Create the React hook for fetching and caching agent configuration.

### Changes Required:

#### 1. Create Hooks Directory and Hook
**File**: `apps/web/src/hooks/useAgentConfig.ts`
**Changes**: Create new file

```typescript
import { useState, useEffect } from 'react';
import type { PublicAgentConfig } from '@/lib/schemaMatcher';
import { getAuthHeaders } from '@/lib/api';

// Cache for agent configs
const configCache = new Map<string, PublicAgentConfig>();

/**
 * Fetch agent config from API
 */
async function fetchAgentConfig(agentId: string): Promise<PublicAgentConfig> {
  const cached = configCache.get(agentId);
  if (cached) return cached;

  const headers = await getAuthHeaders();
  const res = await fetch(`/api/agent/configs/${agentId}`, { headers });

  if (!res.ok) {
    throw new Error(`Failed to fetch agent config: ${res.status}`);
  }

  const config = await res.json();
  configCache.set(agentId, config);
  return config;
}

/**
 * Clear config cache (for testing/logout)
 */
export function clearAgentConfigCache(): void {
  configCache.clear();
}

/**
 * Hook to access agent configuration
 */
export function useAgentConfig(agentId: string) {
  const [config, setConfig] = useState<PublicAgentConfig | null>(
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
    setError(null);

    fetchAgentConfig(agentId)
      .then((c) => {
        setConfig(c);
        setError(null);
      })
      .catch((e) => {
        setError(e);
        console.error('[USE_AGENT_CONFIG] Error:', e);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [agentId]);

  return { config, isLoading, error };
}
```

#### 2. Create Hooks Index
**File**: `apps/web/src/hooks/index.ts`
**Changes**: Create new file

```typescript
export { useAgentConfig, clearAgentConfigCache } from './useAgentConfig';
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npm run typecheck`

#### Manual Verification:
- [ ] Hook fetches config and caches it

---

## Phase 6: SmartJsonViewer Component

### Overview
Create the main SmartJsonViewer component that orchestrates schema matching and component rendering.

### Changes Required:

#### 1. Create SmartJsonViewer Component
**File**: `apps/web/src/components/SmartJsonViewer.tsx`
**Changes**: Create new file

```typescript
import React, { Suspense, useMemo, useCallback } from 'react';
import { viewerRegistry } from '@/lib/viewerRegistry';
import { matchSchema, extractSubComponentPath } from '@/lib/schemaMatcher';
import { useAgentConfig } from '@/hooks/useAgentConfig';
import { JsonViewer } from './JsonViewer';
import { LoaderIcon } from './Icons';
import type { AgentFile } from '@/types';

interface SmartJsonViewerProps {
  content: string;
  file: AgentFile;
  agentId?: string;
}

export function SmartJsonViewer({
  content,
  file,
  agentId = 'default',
}: SmartJsonViewerProps) {
  const { config, isLoading: configLoading } = useAgentConfig(agentId);

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

    if (!Comp) {
      console.warn(`[SMART_JSON_VIEWER] Component not found: ${match.mapping.component}`);
      return {
        parsedData: parsed,
        matchResult: match,
        Component: JsonViewer,
      };
    }

    return {
      parsedData: parsed,
      matchResult: match,
      Component: Comp,
    };
  }, [content, file.filePath, config]);

  // Sub-component renderer for nested content
  const renderSubComponent = useCallback(
    (path: string, rawContent: string) => {
      const subConfig = config?.viewMappings?.subComponents?.find(
        (sc) => sc.path === path
      );

      if (!subConfig) {
        return <pre className="text-sm font-mono">{rawContent}</pre>;
      }

      const SubComponent = viewerRegistry.get(subConfig.component);
      if (!SubComponent) {
        return <pre className="text-sm font-mono">{rawContent}</pre>;
      }

      // Handle file references - for now, show as reference
      // Full file loading will be implemented in FileReferenceLoader
      if (subConfig.type === 'file-reference') {
        return (
          <div className="border border-border rounded p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground mb-2">
              Referenced file: {rawContent}
            </p>
            <p className="text-xs text-muted-foreground italic">
              (File reference loading not yet implemented)
            </p>
          </div>
        );
      }

      // Inline content
      return <SubComponent data={rawContent} content={rawContent} file={file} />;
    },
    [config, file]
  );

  if (configLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        <LoaderIcon size={14} />
        <span>Loading viewer configuration...</span>
      </div>
    );
  }

  // Wrap lazy components in Suspense
  const needsSuspense = matchResult && viewerRegistry.isLazy(matchResult.mapping.component);

  const viewerContent = (
    <div className="relative">
      {/* Match indicator (for debugging) */}
      {matchResult && (
        <div className="absolute top-0 right-0 text-xs bg-card/90 px-2 py-1 rounded-bl border-l border-b border-border">
          <span className="text-muted-foreground">Viewer: </span>
          <span className="text-primary font-medium">{matchResult.mapping.name}</span>
        </div>
      )}

      <Component
        data={parsedData}
        content={content}
        file={file}
        renderSubComponent={renderSubComponent}
      />
    </div>
  );

  if (needsSuspense) {
    return (
      <Suspense
        fallback={
          <div className="flex items-center gap-2 p-4 text-muted-foreground">
            <LoaderIcon size={14} />
            <span>Loading viewer component...</span>
          </div>
        }
      >
        {viewerContent}
      </Suspense>
    );
  }

  return viewerContent;
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npm run typecheck`

#### Manual Verification:
- [ ] SmartJsonViewer renders with match indicator when schema matches
- [ ] Falls back to JsonViewer when no match

---

## Phase 7: Update FileViewerTabs Integration

### Overview
Update FileViewerTabs to use SmartJsonViewer for JSON files.

### Changes Required:

#### 1. Update FileViewerTabs Component
**File**: `apps/web/src/components/FileViewerTabs.tsx`
**Changes**: Import and use SmartJsonViewer for JSON files

```typescript
// Add import at top
import { SmartJsonViewer } from './SmartJsonViewer';

// Update switch statement in renderContent() (around line 35-39)
// Replace:
//   case 'json':
//     return <JsonViewer content={activeTab.content} />;
// With:
case 'json':
  return (
    <SmartJsonViewer
      content={activeTab.content}
      file={activeTab.file}
      agentId="sports-nfl" // TODO: Get from session context
    />
  );
```

#### 2. Initialize Viewer Registry on App Load
**File**: `apps/web/src/App.tsx`
**Changes**: Import registerViewers to initialize registry

```typescript
// Add import at top (side-effect import)
import '@/lib/registerViewers';
```

### Success Criteria:

#### Automated Verification:
- [ ] App builds without errors: `cd apps/web && npm run build`
- [ ] TypeScript compiles: `npm run typecheck`

#### Manual Verification:
- [ ] Opening a JSON file shows SmartJsonViewer
- [ ] Match indicator appears for matched files

---

## Phase 8: Example Custom Viewer - PredictionViewer

### Overview
Create an example custom viewer component for NFL predictions.

### Changes Required:

#### 1. Create Viewers Directory
**Location**: `apps/web/src/components/viewers/`

#### 2. Create PredictionViewer Component
**File**: `apps/web/src/components/viewers/PredictionViewer.tsx`
**Changes**: Create new file

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
  spread?: number;
  prediction?: 'home' | 'away' | 'push';
  confidence?: number;
  reasoning?: string;
}

/**
 * Read-only prediction viewer component
 */
export function PredictionViewer({
  data,
  renderSubComponent,
}: ViewerProps<NFLPrediction>) {
  const predictions = data as NFLPrediction;

  return (
    <div className="space-y-4 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">{predictions.name}</h2>
        <span className="text-sm text-muted-foreground">
          {predictions.objects?.length || 0} predictions
        </span>
      </div>

      {/* Predictions Grid */}
      <div className="grid gap-3">
        {predictions.objects?.map((game, index) => (
          <div
            key={index}
            className="p-3 bg-card rounded-lg border border-border hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{game.awayTeam}</span>
                <span className="text-muted-foreground">@</span>
                <span className="font-medium text-foreground">{game.homeTeam}</span>
              </div>
              {game.spread !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Spread: {game.spread > 0 ? '+' : ''}{game.spread}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {game.prediction && (
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
                )}
              </div>

              {/* Confidence bar */}
              {game.confidence !== undefined && (
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${game.confidence}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8">
                    {game.confidence}%
                  </span>
                </div>
              )}
            </div>

            {game.reasoning && (
              <p className="mt-2 text-sm text-muted-foreground">
                {game.reasoning}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Summary (sub-component) */}
      {predictions.summary && renderSubComponent && (
        <div className="mt-6 pt-4 border-t border-border">
          <h3 className="text-sm font-medium mb-2 text-muted-foreground">
            Summary
          </h3>
          {renderSubComponent('$.summary', predictions.summary)}
        </div>
      )}
    </div>
  );
}
```

#### 3. Create Viewers Index
**File**: `apps/web/src/components/viewers/index.ts`
**Changes**: Create new file

```typescript
export { PredictionViewer } from './PredictionViewer';
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] App builds: `npm run build`

#### Manual Verification:
- [ ] PredictionViewer renders predictions with styled cards
- [ ] Confidence bars display correctly
- [ ] Team names and spreads show properly

---

## Phase 9: End-to-End Testing

### Overview
Test the complete flow from agent output to custom viewer rendering.

### Test Scenarios:

#### 1. Create Test Prediction File
Create a test predictions file in an agent session to verify the flow.

#### 2. Verify Schema Matching
- File pattern matching: `predictions/week-15.json` → PredictionViewer
- JSON Schema validation: Verify data structure matches schema
- Priority ordering: Higher priority mappings take precedence

#### 3. Verify Component Rendering
- PredictionViewer displays with styled cards
- Match indicator shows "NFL Game Predictions"
- Fallback to JsonViewer for non-matching files

#### 4. Verify Fallback Behavior
- Unknown JSON files render with JsonViewer
- Invalid JSON shows error state
- Missing component falls back to JsonViewer with warning

### Success Criteria:

#### Automated Verification:
- [ ] All TypeScript compiles: `npm run typecheck` in web and shared
- [ ] App builds successfully: `npm run build`
- [ ] Server starts: `npm run dev`

#### Manual Verification:
- [ ] Create prediction file via agent → shows in PredictionViewer
- [ ] Open non-prediction JSON → shows in JsonViewer
- [ ] Match indicator displays correct viewer name
- [ ] Sub-component reference shows placeholder text

---

## Testing Strategy

### Unit Tests:
- Schema matching logic with various patterns
- Component registry registration and lookup
- Path extraction from JSON data

### Integration Tests:
- API endpoint returns correct config
- SmartJsonViewer renders correct component
- Lazy loading of custom viewers

### Manual Testing Steps:
1. Start server and web app
2. Create session with sports-nfl agent
3. Have agent create a predictions JSON file
4. Open file in FileExplorer
5. Verify PredictionViewer renders instead of raw JSON
6. Verify match indicator shows "NFL Game Predictions"
7. Open a non-prediction JSON file
8. Verify it falls back to JsonViewer

---

## Performance Considerations

1. **Schema Validation**: JSON Schema validation is cached per mapping ID
2. **Config Caching**: Agent configs are cached on first fetch
3. **Lazy Loading**: Custom viewers are lazy-loaded to reduce initial bundle
4. **File Pattern Fast Path**: File patterns checked before schema validation

---

## Migration Notes

- Existing sessions will work - SmartJsonViewer falls back to JsonViewer
- No database migrations required
- Agent config changes are additive (viewMappings optional)

---

## References

- Original research: `thoughts/shared/research/2025-12-23-smart-json-viewer-framework.md`
- Agent config types: `packages/shared/src/agentConfig.ts`
- Current file viewer: `apps/web/src/components/FileViewerTabs.tsx`
- Current JSON viewer: `apps/web/src/components/JsonViewer.tsx`
- File context: `apps/web/src/contexts/FileContext.tsx`
