import type { AgentConfig } from '@agent-app/shared';

// All available tools in the system
const ALL_TOOLS = [
  // File Operations
  'Read', 'Write', 'Edit', 'Glob', 'Grep',
  // Shell & Execution
  'Bash',
  // Web & Search
  'WebSearch', 'WebFetch',
  // Task Management
  'Task', 'TaskOutput', 'TodoWrite',
  // User Interaction
  'AskUserQuestion', 'Skill',
];

// Network-related tools
const NETWORK_TOOLS = ['WebSearch', 'WebFetch'];

/**
 * Get the list of allowed tools based on agent configuration
 */
export function getAllowedTools(config: AgentConfig): string[] {
  let tools: string[];

  // Start with explicitly allowed tools, or all tools
  if (config.security.allowedTools && config.security.allowedTools.length > 0) {
    tools = [...config.security.allowedTools];
  } else {
    tools = [...ALL_TOOLS];
  }

  // Remove denied tools
  if (config.security.deniedTools && config.security.deniedTools.length > 0) {
    tools = tools.filter(tool => !config.security.deniedTools!.includes(tool));
  }

  // Remove network tools if network is disabled
  if (config.security.network === 'none') {
    tools = tools.filter(tool => !NETWORK_TOOLS.includes(tool));
  }

  return tools;
}

/**
 * Check if a URL is allowed by the network allowlist
 */
export function isUrlAllowed(url: string, config: AgentConfig): boolean {
  if (config.security.network === 'full') {
    return true;
  }

  if (config.security.network === 'none') {
    return false;
  }

  // network === 'allowlist'
  const allowlist = config.security.networkAllowlist || [];

  if (allowlist.length === 0) {
    // Empty allowlist means block everything in allowlist mode
    return false;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check if hostname matches any allowed domain
    return allowlist.some(allowed => {
      const allowedLower = allowed.toLowerCase();
      // Exact match or subdomain match
      return hostname === allowedLower || hostname.endsWith('.' + allowedLower);
    });
  } catch {
    // Invalid URL
    return false;
  }
}

/**
 * Generate system prompt additions for network sandboxing
 * Note: Tool restrictions are handled by passing allowedTools to the SDK
 */
export function getSandboxSystemPrompt(config: AgentConfig): string {
  const parts: string[] = [];

  // Network restrictions only
  if (config.security.network === 'none') {
    parts.push('IMPORTANT: Network access is disabled. Do not attempt to use WebFetch or WebSearch tools.');
  } else if (config.security.network === 'allowlist' && config.security.networkAllowlist) {
    parts.push(`IMPORTANT: Network access is restricted to these domains only: ${config.security.networkAllowlist.join(', ')}`);
    parts.push('Do not attempt to access any other domains.');
  }

  return parts.join('\n');
}
