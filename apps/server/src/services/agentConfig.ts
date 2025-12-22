import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig, AgentConfigFile } from '@agent-app/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../config/agents.json');

let configCache: AgentConfigFile | null = null;

/**
 * Load agent configurations from JSON file
 */
export function loadAgentConfigs(): AgentConfigFile {
  if (configCache) {
    return configCache;
  }

  const content = readFileSync(CONFIG_PATH, 'utf-8');
  configCache = JSON.parse(content) as AgentConfigFile;
  return configCache;
}

/**
 * Get configuration for a specific agent type
 */
export function getAgentConfig(agentId: string): AgentConfig {
  const configs = loadAgentConfigs();
  const config = configs.agents[agentId];

  if (!config) {
    console.warn(`[AGENT_CONFIG] Unknown agent ID: ${agentId}, using default`);
    return configs.agents[configs.defaultAgentId];
  }

  return config;
}

/**
 * Get the default agent configuration
 */
export function getDefaultAgentConfig(): AgentConfig {
  const configs = loadAgentConfigs();
  return configs.agents[configs.defaultAgentId];
}

/**
 * List all available agent IDs
 */
export function listAgentIds(): string[] {
  const configs = loadAgentConfigs();
  return Object.keys(configs.agents);
}

/**
 * Clear config cache (for testing or hot reload)
 */
export function clearConfigCache(): void {
  configCache = null;
}
