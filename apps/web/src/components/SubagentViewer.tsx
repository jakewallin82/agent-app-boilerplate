import { useState } from 'react';
import type { Subagent, SubagentToolCall } from '@/types';

interface SubagentViewerProps {
  subagent: Subagent;
}

// Get one-liner summary for tool call
function getToolOneLiner(toolCall: SubagentToolCall): string {
  const input = toolCall.input;
  switch (toolCall.name) {
    case 'Read':
      return input.file_path ? input.file_path.split('/').pop() || '' : '';
    case 'Write':
    case 'Edit':
      return input.file_path ? input.file_path.split('/').pop() || '' : '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
    case 'Grep':
      return input.pattern ? `"${input.pattern}"` : '';
    case 'Glob':
      return input.pattern ? input.pattern : '';
    case 'WebSearch':
      return input.query ? `"${input.query}"` : '';
    case 'WebFetch':
      try {
        return input.url ? new URL(input.url).hostname : '';
      } catch {
        return input.url?.substring(0, 30) || '';
      }
    case 'Task':
      return input.description || input.subagent_type || '';
    default:
      return '';
  }
}

// Status color
function getStatusColor(status: Subagent['status']): string {
  switch (status) {
    case 'running':
      return '#3b82f6'; // blue
    case 'completed':
      return '#22c55e'; // green
    case 'failed':
      return '#ef4444'; // red
  }
}

// Format time
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function SubagentViewer({ subagent }: SubagentViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const statusColor = getStatusColor(subagent.status);

  return (
    <div
      className="my-2 rounded-sm overflow-hidden border-l-2"
      style={{ borderLeftColor: statusColor }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 bg-card cursor-pointer hover:bg-card/80"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {/* Expand/Collapse */}
          {subagent.toolCalls.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {isExpanded ? '▼' : '▶'}
            </span>
          )}

          {/* Status dot */}
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: statusColor }}
          />

          {/* Label */}
          <span className="text-xs font-medium text-muted-foreground uppercase">
            SUBAGENT:
          </span>

          {/* Type */}
          <span className="text-sm font-medium" style={{ color: statusColor }}>
            {subagent.type}
          </span>

          <span className="text-muted-foreground">›</span>

          {/* Description */}
          <span className="text-sm truncate flex-1">{subagent.description}</span>

          {/* Status icon */}
          {subagent.status === 'running' && (
            <span className="animate-pulse">●</span>
          )}
          {subagent.status === 'completed' && (
            <span className="text-green-500">✓</span>
          )}
          {subagent.status === 'failed' && (
            <span className="text-red-500">✗</span>
          )}
        </div>

        {/* Second row */}
        <div className="flex items-center gap-3 mt-1 ml-4 text-xs text-muted-foreground">
          <span>{formatTime(subagent.startTime)}</span>
          {subagent.toolCalls.length > 0 && (
            <span>⚡ {subagent.toolCalls.length} tool calls</span>
          )}
          {subagent.endTime && (
            <span>
              ({Math.round((subagent.endTime.getTime() - subagent.startTime.getTime()) / 1000)}s)
            </span>
          )}
        </div>
      </div>

      {/* Tool Calls List */}
      {isExpanded && subagent.toolCalls.length > 0 && (
        <div className="border-t border-border bg-background/50">
          <div className="px-3 py-1 text-xs font-medium text-muted-foreground border-b border-border">
            Tool Calls ({subagent.toolCalls.length})
          </div>
          <div className="py-1">
            {subagent.toolCalls.map((toolCall, index) => {
              const oneLiner = getToolOneLiner(toolCall);
              return (
                <div
                  key={toolCall.id || index}
                  className="flex items-center gap-2 px-3 py-1 text-xs"
                >
                  {/* Indent line */}
                  <div className="w-3 border-l border-b border-border h-2" />

                  {/* Tool name */}
                  <span className="text-primary font-medium">{toolCall.name}</span>

                  {/* One-liner */}
                  {oneLiner && (
                    <span className="text-muted-foreground truncate">
                      ({oneLiner})
                    </span>
                  )}

                  {/* Status */}
                  <span className="ml-auto">
                    {toolCall.status === 'completed' && '✓'}
                    {toolCall.status === 'running' && '●'}
                    {toolCall.status === 'failed' && '✗'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
