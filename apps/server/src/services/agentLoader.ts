import * as fs from 'fs';
import * as path from 'path';

/**
 * Type for agent definition - matches Claude SDK expected format
 */
export interface AgentDefinition {
  description: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  tools?: string[];
  prompt: string;
}

/**
 * Load a single agent file from markdown with YAML frontmatter
 */
function loadAgentFile(filePath: string, relativePath: string): AgentDefinition | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      console.warn(`[AGENT_LOADER] No frontmatter found in ${relativePath}`);
      return null;
    }

    const [, frontmatter, body] = frontmatterMatch;

    // Parse frontmatter fields
    const descMatch = frontmatter.match(/description:\s*(.+)/);
    const modelMatch = frontmatter.match(/model:\s*(.+)/);
    const toolsMatch = frontmatter.match(/tools:\s*(.+)/);

    if (!descMatch) {
      console.warn(`[AGENT_LOADER] No description found in ${relativePath}`);
      return null;
    }

    const agent: AgentDefinition = {
      description: descMatch[1].trim(),
      prompt: body.trim(),
    };

    if (modelMatch) {
      agent.model = modelMatch[1].trim() as 'opus' | 'sonnet' | 'haiku';
    }

    if (toolsMatch) {
      agent.tools = toolsMatch[1].split(',').map((t) => t.trim());
    }

    return agent;
  } catch (err) {
    console.error(`[AGENT_LOADER] Error loading agent from ${relativePath}:`, err);
    return null;
  }
}

/**
 * Recursively load agents from markdown files in .claude/agents directory
 * Returns a Record<string, AgentDefinition> to pass to query({ options: { agents } })
 */
export function loadAgentsFromDirectory(agentsDir: string): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};

  if (!fs.existsSync(agentsDir)) {
    console.log(`[AGENT_LOADER] Agents directory not found: ${agentsDir}`);
    return agents;
  }

  // Recursive function to walk directory tree
  function walkDirectory(dir: string, relativeDir: string = ''): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Recursively process subdirectories
        walkDirectory(fullPath, relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Load agent file
        const agent = loadAgentFile(fullPath, relativePath);
        if (agent) {
          // Use relative path as agent name (e.g., "nba/predict-nba" or just "predict-nba")
          const agentName = relativePath.replace(/\.md$/, '').replace(/\\/g, '/');
          agents[agentName] = agent;
          console.log(`[AGENT_LOADER] Loaded agent: ${agentName}`);
        }
      }
    }
  }

  walkDirectory(agentsDir);
  console.log(`[AGENT_LOADER] Loaded ${Object.keys(agents).length} agents from ${agentsDir}`);
  return agents;
}
