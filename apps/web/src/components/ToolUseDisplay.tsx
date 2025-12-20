import { useState } from 'react';
import type { ToolUseBlock } from '@/types';

interface ToolUseDisplayProps {
  toolUse: ToolUseBlock;
}

// Get one-liner for tool
function getOneLiner(toolUse: ToolUseBlock): string {
  const input = toolUse.input;
  switch (toolUse.name) {
    case 'Read':
      return input.file_path || '';
    case 'Write':
    case 'Edit':
      return input.file_path || '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
    case 'Grep':
      return input.pattern ? `"${input.pattern}"` : '';
    case 'Glob':
      return input.pattern || '';
    case 'WebSearch':
      return input.query ? `"${input.query}"` : '';
    case 'WebFetch':
      return input.url || '';
    case 'Task':
      return input.description || input.subagent_type || '';
    default:
      const keys = Object.keys(input);
      if (keys.length > 0) {
        const firstVal = String(input[keys[0]] || '');
        return firstVal.length > 50 ? firstVal.substring(0, 50) + '...' : firstVal;
      }
      return '';
  }
}

// Format parameter name
function getFriendlyName(key: string): string {
  const names: Record<string, string> = {
    file_path: 'File',
    command: 'Command',
    pattern: 'Pattern',
    query: 'Query',
    url: 'URL',
    content: 'Content',
    old_string: 'Find',
    new_string: 'Replace',
    description: 'Description',
    prompt: 'Prompt',
    subagent_type: 'Type',
  };
  return names[key] || key;
}

export function ToolUseDisplay({ toolUse }: ToolUseDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const oneLiner = getOneLiner(toolUse);
  const params = Object.entries(toolUse.input).filter(
    ([_, v]) => v !== undefined && v !== null && v !== ''
  );
  const hasParams = params.length > 0;

  return (
    <div className="my-2 rounded-sm overflow-hidden border-l-2 border-orange-500/50">
      {/* Header */}
      <div
        className={`px-3 py-2 bg-card flex items-center gap-2 ${
          hasParams ? 'cursor-pointer hover:bg-card/80' : ''
        }`}
        onClick={() => hasParams && setIsExpanded(!isExpanded)}
      >
        {/* Expand indicator */}
        {hasParams && (
          <span className="text-xs text-muted-foreground">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}

        {/* Tool name */}
        <span className="text-sm font-medium text-orange-400">{toolUse.name}</span>

        {/* One-liner */}
        {oneLiner && (
          <span className="text-sm text-muted-foreground truncate">
            {oneLiner}
          </span>
        )}
      </div>

      {/* Expanded parameters */}
      {isExpanded && hasParams && (
        <div className="border-t border-border bg-background/50">
          {params.map(([key, value]) => (
            <div
              key={key}
              className="px-3 py-2 border-b border-border last:border-b-0"
            >
              <div className="text-xs font-medium text-muted-foreground mb-1">
                {getFriendlyName(key)}
              </div>
              <div className="text-sm">
                {typeof value === 'string' && value.includes('\n') ? (
                  <pre className="bg-background rounded p-2 overflow-x-auto text-xs">
                    <code>{value}</code>
                  </pre>
                ) : (
                  <code className="bg-background rounded px-2 py-1 text-xs break-all">
                    {typeof value === 'object'
                      ? JSON.stringify(value, null, 2)
                      : String(value)}
                  </code>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
