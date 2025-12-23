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
 * Props interface for all viewer components
 */
export interface ViewerProps<T = unknown> {
  /** Parsed JSON data */
  data: T;

  /** Raw content string (for fallback) */
  content: string;

  /** File metadata */
  file: AgentFile;

  /** Callback when data is modified (for editable viewers) */
  onChange?: (data: T) => void;

  /** Whether the component is in edit mode */
  isEditing?: boolean;

  /** Sub-component renderer for nested content */
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

#### 5. Editable Viewer Template

**Create `apps/web/src/components/templates/EditableViewerTemplate.tsx`:**

```typescript
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import type { ViewerProps } from '@/lib/viewerRegistry';

interface EditableViewerTemplateProps<T> extends ViewerProps<T> {
  /** Render the view mode */
  renderView: (data: T) => React.ReactNode;

  /** Render the edit mode */
  renderEdit: (
    data: T,
    onChange: (data: T) => void
  ) => React.ReactNode;

  /** Validate data before save */
  validate?: (data: T) => { valid: boolean; errors?: string[] };

  /** Auto-save delay in ms (0 to disable) */
  autoSaveDelay?: number;

  /** Save handler */
  onSave?: (data: T) => Promise<void>;
}

export function EditableViewerTemplate<T>({
  data,
  content,
  file,
  onChange,
  isEditing: externalIsEditing,
  renderView,
  renderEdit,
  validate,
  autoSaveDelay = 1000,
  onSave,
}: EditableViewerTemplateProps<T>) {
  const [isEditing, setIsEditing] = useState(externalIsEditing ?? false);
  const [localData, setLocalData] = useState<T>(data);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Sync external data
  useEffect(() => {
    if (!isDirty) {
      setLocalData(data);
    }
  }, [data, isDirty]);

  // Auto-save with debounce
  const debouncedSave = useDebouncedCallback(
    async (dataToSave: T) => {
      if (!onSave) return;

      // Validate first
      if (validate) {
        const result = validate(dataToSave);
        if (!result.valid) {
          setSaveError(result.errors?.join(', ') ?? 'Validation failed');
          return;
        }
      }

      setIsSaving(true);
      setSaveError(null);

      try {
        await onSave(dataToSave);
        setIsDirty(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed');
      } finally {
        setIsSaving(false);
      }
    },
    autoSaveDelay
  );

  // Handle local changes
  const handleChange = useCallback(
    (newData: T) => {
      setLocalData(newData);
      setIsDirty(true);
      onChange?.(newData);

      if (autoSaveDelay > 0) {
        debouncedSave(newData);
      }
    },
    [onChange, autoSaveDelay, debouncedSave]
  );

  // Manual save
  const handleManualSave = useCallback(async () => {
    if (!onSave) return;

    if (validate) {
      const result = validate(localData);
      if (!result.valid) {
        setSaveError(result.errors?.join(', ') ?? 'Validation failed');
        return;
      }
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      await onSave(localData);
      setIsDirty(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [localData, onSave, validate]);

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={`px-2 py-1 text-xs rounded ${
              isEditing
                ? 'bg-primary text-primary-foreground'
                : 'bg-card hover:bg-accent'
            }`}
          >
            {isEditing ? 'View' : 'Edit'}
          </button>

          {isDirty && (
            <span className="text-xs text-yellow-500">Unsaved changes</span>
          )}

          {isSaving && (
            <span className="text-xs text-muted-foreground">Saving...</span>
          )}
        </div>

        {isEditing && onSave && (
          <button
            onClick={handleManualSave}
            disabled={isSaving || !isDirty}
            className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>

      {/* Error display */}
      {saveError && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/50 rounded text-sm text-red-400">
          {saveError}
        </div>
      )}

      {/* Content */}
      {isEditing ? renderEdit(localData, handleChange) : renderView(localData)}
    </div>
  );
}
```

#### 6. Example Custom Viewer: NFL Predictions

**Create `apps/web/src/components/viewers/PredictionViewer.tsx`:**

```typescript
import React from 'react';
import type { ViewerProps } from '@/lib/viewerRegistry';
import { EditableViewerTemplate } from '../templates/EditableViewerTemplate';
import { MarkdownViewer } from '../MarkdownViewer';

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
 * View mode renderer
 */
function PredictionViewMode({
  data,
  renderSubComponent
}: {
  data: NFLPrediction;
  renderSubComponent?: ViewerProps['renderSubComponent'];
}) {
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

      {/* Summary (sub-component) */}
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

/**
 * Edit mode renderer
 */
function PredictionEditMode({
  data,
  onChange,
}: {
  data: NFLPrediction;
  onChange: (data: NFLPrediction) => void;
}) {
  const updateGame = (index: number, updates: Partial<GamePrediction>) => {
    const newObjects = [...data.objects];
    newObjects[index] = { ...newObjects[index], ...updates };
    onChange({ ...data, objects: newObjects });
  };

  return (
    <div className="space-y-4">
      {/* Title edit */}
      <div>
        <label className="block text-sm font-medium mb-1">Name</label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          className="w-full bg-input border border-border rounded px-3 py-2"
        />
      </div>

      {/* Games edit */}
      <div className="space-y-3">
        {data.objects.map((game, index) => (
          <div key={index} className="p-3 bg-card rounded-lg border border-border">
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label className="text-xs text-muted-foreground">Away Team</label>
                <input
                  type="text"
                  value={game.awayTeam}
                  onChange={(e) => updateGame(index, { awayTeam: e.target.value })}
                  className="w-full bg-input border border-border rounded px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Home Team</label>
                <input
                  type="text"
                  value={game.homeTeam}
                  onChange={(e) => updateGame(index, { homeTeam: e.target.value })}
                  className="w-full bg-input border border-border rounded px-2 py-1 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Spread</label>
                <input
                  type="number"
                  step="0.5"
                  value={game.spread}
                  onChange={(e) => updateGame(index, { spread: parseFloat(e.target.value) })}
                  className="w-full bg-input border border-border rounded px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Prediction</label>
                <select
                  value={game.prediction}
                  onChange={(e) => updateGame(index, { prediction: e.target.value as 'home' | 'away' | 'push' })}
                  className="w-full bg-input border border-border rounded px-2 py-1 text-sm"
                >
                  <option value="home">Home</option>
                  <option value="away">Away</option>
                  <option value="push">Push</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Confidence</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={game.confidence}
                  onChange={(e) => updateGame(index, { confidence: parseInt(e.target.value) })}
                  className="w-full bg-input border border-border rounded px-2 py-1 text-sm"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Main prediction viewer component
 */
export function PredictionViewer(props: ViewerProps<NFLPrediction>) {
  return (
    <EditableViewerTemplate
      {...props}
      renderView={(data) => (
        <PredictionViewMode
          data={data}
          renderSubComponent={props.renderSubComponent}
        />
      )}
      renderEdit={(data, onChange) => (
        <PredictionEditMode data={data} onChange={onChange} />
      )}
      validate={(data) => ({
        valid: data.name.length > 0 && data.objects.length > 0,
        errors: data.name.length === 0 ? ['Name is required'] : undefined,
      })}
      autoSaveDelay={1500}
    />
  );
}
```

#### 7. Component Registration and Initialization

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

#### 8. Hook for Agent Config Access

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

### Phase 1: Core Framework (2-3 days)
1. Add `viewMappings` types to `packages/shared/src/agentConfig.ts`
2. Create `viewerRegistry.ts` and `schemaMatcher.ts`
3. Create `SmartJsonViewer.tsx` component
4. Add API endpoint for agent config exposure
5. Update `FileViewerTabs.tsx` to use SmartJsonViewer

### Phase 2: Template System (1-2 days)
1. Create `EditableViewerTemplate.tsx`
2. Add auto-save hook with debounce
3. Create file save API endpoint
4. Add validation support

### Phase 3: Example Viewers (1-2 days)
1. Create `PredictionViewer.tsx` for NFL predictions
2. Create `WeeklyScheduleViewer.tsx` for schedules
3. Configure mappings in `sports-nfl` agent config

### Phase 4: Claude Skill (1 day)
1. Create `.claude/skills/generate-viewer.md`
2. Document template patterns
3. Test generation workflow

### Phase 5: Polish & Testing (1-2 days)
1. Add loading states and error handling
2. Test schema matching edge cases
3. Document component creation process

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

## Open Questions

1. **Schema Storage**: Should schemas be stored inline in `agents.json` or as separate `.schema.json` files referenced by path?

2. **Component Discovery**: Should the frontend auto-discover available viewers, or require explicit registration?

3. **Edit Permissions**: Should edit mode be gated by user role (admin only) or available to all users?

4. **File Reference Resolution**: For sub-components referencing external files (e.g., `summary: "./summary.md"`), should we:
   - Fetch the file on-demand when the viewer renders?
   - Pre-fetch and include content in the initial file event?
   - Show a link to open the file in a new tab?

5. **Schema Versioning**: How to handle schema evolution when agent output format changes?

---

## Related Research

- `thoughts/shared/plans/2025-12-22-multi-agent-filesystem-configuration.md` - Original implementation plan for agent configuration system
