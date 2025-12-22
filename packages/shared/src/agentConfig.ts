/**
 * Storage mode for agent sessions
 */
export type StorageMode =
  | 'session-persistent'  // Files persist for session duration, deleted on session end
  | 'shared-persistent';  // Files shared across users (admin-generated)

/**
 * Isolation level for workspaces
 */
export type IsolationLevel =
  | 'strict'   // Each session completely isolated
  | 'user'     // Sessions share user's files
  | 'shared';  // Sessions can access shared files

/**
 * How shared files are loaded into session workspace
 */
export type SharedFileLoadingMode =
  | 'none'           // No shared files
  | 'copy-on-start'; // Copy shared files at session start

/**
 * Network access restrictions
 */
export type NetworkMode =
  | 'full'       // Unrestricted network access
  | 'allowlist'  // Only allowed domains
  | 'none';      // No network access (WebFetch/WebSearch disabled)

/**
 * Startup strategy for containers
 */
export type StartupStrategy =
  | 'on-demand'         // Load files when session starts (default)
  | 'pre-warm-on-login'; // Pre-load shared files on user login

/**
 * File loading configuration
 */
export interface FileLoadingConfig {
  /** How to load shared files */
  sharedFiles: SharedFileLoadingMode;

  /** Patterns to include when loading shared files (glob patterns) */
  includePatterns?: string[];

  /** Patterns to exclude when loading shared files */
  excludePatterns?: string[];

  /** Maximum total size of shared files to load (bytes) */
  maxSharedBytes?: number;
}

/**
 * Security/sandboxing configuration
 */
export interface SecurityConfig {
  /** Network access mode */
  network: NetworkMode;

  /** Allowed domains for WebFetch/WebSearch (when network='allowlist') */
  networkAllowlist?: string[];

  /** Allowed tools (subset of available tools) */
  allowedTools?: string[];

  /** Explicitly blocked tools */
  deniedTools?: string[];
}

/**
 * Startup configuration
 */
export interface StartupConfig {
  /** Container startup strategy */
  strategy: StartupStrategy;

  /** How long to keep warmed session (seconds) */
  warmupTTL?: number;
}

/**
 * Complete agent configuration
 */
export interface AgentConfig {
  /** Unique identifier for this agent type */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of this agent type */
  description?: string;

  /** Path to agent config directory containing CLAUDE.md and .claude/ folder (relative to agent/configs/) */
  configDir: string;

  /** Storage mode */
  storageMode: StorageMode;

  /** Isolation level */
  isolation: IsolationLevel;

  /** File loading configuration */
  fileLoading: FileLoadingConfig;

  /** Security configuration */
  security: SecurityConfig;

  /** Startup configuration */
  startup: StartupConfig;

  /** Whether this agent can write to shared storage (admin only) */
  canWriteShared: boolean;
}

/**
 * All agent configurations
 */
export interface AgentConfigFile {
  version: string;
  agents: Record<string, AgentConfig>;
  defaultAgentId: string;
}
