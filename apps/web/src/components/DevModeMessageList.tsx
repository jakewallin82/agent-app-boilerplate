import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DevModeMessageListProps {
  messages: unknown[];
  onSubagentClick?: (toolUseId: string, description: string) => void;
}

// Extract tool result content from a tool_result block
function extractToolResultContent(block: unknown): string {
  const b = block as { type?: string; content?: unknown };
  if (b.type !== 'tool_result') return '';

  const content = b.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item: unknown) => {
        const i = item as { type?: string; text?: string };
        if (i.type === 'text' && i.text) return i.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// Build a map of tool_use_id -> result content
function buildToolResultsMap(messages: unknown[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const msg of messages) {
    const m = msg as { type?: string; message?: { content?: unknown[] } };
    if (m.type !== 'user') continue;

    const content = m.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      const b = block as { type?: string; tool_use_id?: string };
      if (b.type === 'tool_result' && b.tool_use_id) {
        map.set(b.tool_use_id, extractToolResultContent(block));
      }
    }
  }

  return map;
}

// Check if a user message is only tool results (should be hidden)
function isToolResultOnlyMessage(message: unknown): boolean {
  const m = message as { type?: string; message?: { content?: unknown[] } };
  if (m.type !== 'user') return false;

  const content = m.message?.content;
  if (!Array.isArray(content)) return false;

  // Check if ALL content blocks are tool_result type
  return content.every((block: unknown) => {
    const b = block as { type?: string };
    return b.type === 'tool_result';
  });
}

// Extract text content from SDK message
function extractText(message: unknown): string {
  const msg = message as { type?: string; message?: { content?: unknown[] } };
  if (msg.type !== 'assistant') return '';
  const content = msg.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: unknown) => (b as { type?: string }).type === 'text')
    .map((b: unknown) => (b as { text?: string }).text || '')
    .join('');
}

// Get one-liner for tool call
function getToolOneLiner(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
      return (input.file_path as string)?.split('/').pop() || '';
    case 'Write':
    case 'Edit':
      return (input.file_path as string)?.split('/').pop() || '';
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
    }
    case 'Grep':
      return input.pattern ? `"${input.pattern}"` : '';
    case 'Glob':
      return (input.pattern as string) || '';
    case 'WebSearch':
      return input.query ? `"${input.query}"` : '';
    case 'WebFetch':
      try {
        return input.url ? new URL(input.url as string).hostname : '';
      } catch {
        return (input.url as string)?.substring(0, 30) || '';
      }
    case 'Task':
      return (input.description as string) || (input.subagent_type as string) || '';
    default:
      return '';
  }
}

// Message type badge
function MessageBadge({ type, subtype }: { type: string; subtype?: string }) {
  const colors: Record<string, string> = {
    user: 'bg-blue-500/20 text-blue-400',
    assistant: 'bg-green-500/20 text-green-400',
    system: 'bg-gray-500/20 text-gray-400',
    result: 'bg-purple-500/20 text-purple-400',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors[type] || 'bg-gray-500/20'}`}>
      {type}{subtype ? `:${subtype}` : ''}
    </span>
  );
}

// Expandable tool call display
function ToolCallItem({
  name,
  input,
  id,
  result,
  onSubagentClick
}: {
  name: string;
  input: Record<string, unknown>;
  id: string;
  result?: string;
  onSubagentClick?: (id: string, desc: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const oneLiner = getToolOneLiner(name, input);
  const isTask = name === 'Task';
  const hasResult = result && result.length > 0;

  const handleClick = () => {
    if (isTask) {
      onSubagentClick?.(id, (input.description as string) || (input.subagent_type as string) || 'Subagent');
    } else if (hasResult) {
      setExpanded(!expanded);
    }
  };

  return (
    <div className="border-l-2 border-orange-500/50">
      <div
        className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
          isTask
            ? 'border-l-2 border-purple-500 -ml-0.5 cursor-pointer hover:bg-purple-500/10'
            : hasResult ? 'cursor-pointer hover:bg-accent' : ''
        }`}
        onClick={handleClick}
      >
        {hasResult && !isTask && (
          <span className="text-muted-foreground text-xs">
            {expanded ? '▼' : '▶'}
          </span>
        )}
        <span className={`font-medium ${isTask ? 'text-purple-400' : 'text-orange-400'}`}>
          {name}
        </span>
        {oneLiner && (
          <span className="text-muted-foreground truncate">
            ({oneLiner})
          </span>
        )}
        {isTask && (
          <span className="ml-auto text-xs text-muted-foreground">
            Click to view
          </span>
        )}
      </div>
      {expanded && hasResult && (
        <div className="px-3 py-2 bg-card/50 text-xs text-muted-foreground border-t border-border/50 whitespace-pre-wrap">
          {result.length > 500 ? result.substring(0, 500) + '...' : result}
        </div>
      )}
    </div>
  );
}

export function DevModeMessageList({ messages, onSubagentClick }: DevModeMessageListProps) {
  // Build tool results map for expandable tool calls
  const toolResultsMap = useMemo(() => buildToolResultsMap(messages), [messages]);

  return (
    <div className="space-y-2 text-sm">
      {messages.map((msg, index) => {
        const message = msg as {
          type?: string;
          subtype?: string;
          session_id?: string;
          message?: { content?: unknown[] } | string;
        };

        // Skip user messages that only contain tool_results (they're shown in tool call expansion)
        if (message.type === 'user' && isToolResultOnlyMessage(msg)) {
          return null;
        }

        // User message (actual user prompts, not tool results)
        if (message.type === 'user') {
          const userMsg = message as { message?: string | { content?: unknown[] } };

          // Extract text content from user message
          let displayContent = '';
          if (typeof userMsg.message === 'string') {
            displayContent = userMsg.message;
          } else if (Array.isArray(userMsg.message?.content)) {
            // Find text blocks in user message
            const textBlocks = userMsg.message.content
              .filter((b: unknown) => {
                const block = b as { type?: string };
                return block.type === 'text';
              })
              .map((b: unknown) => (b as { text?: string }).text || '');
            displayContent = textBlocks.join('\n');
          }

          if (!displayContent) return null;

          return (
            <div key={index} className="p-3 bg-blue-500/10 rounded border border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <MessageBadge type="user" />
              </div>
              <div className="text-foreground whitespace-pre-wrap">
                {displayContent}
              </div>
            </div>
          );
        }

        // Assistant message with content blocks
        if (message.type === 'assistant') {
          const assistantMsg = message as { message?: { content?: unknown[] } };
          const content = assistantMsg.message?.content;
          const text = extractText(message);
          const toolUses = Array.isArray(content)
            ? content.filter((b: unknown) => (b as { type?: string }).type === 'tool_use')
            : [];

          // Skip if no text and no tool calls
          if (!text && toolUses.length === 0) return null;

          return (
            <div key={index} className="p-3 bg-card rounded border border-border">
              <div className="flex items-center gap-2 mb-2">
                <MessageBadge type="assistant" />
              </div>

              {/* Text content */}
              {text && (
                <div className="prose prose-invert prose-sm max-w-none mb-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                </div>
              )}

              {/* Tool calls */}
              {toolUses.length > 0 && (
                <div className="space-y-1 mt-2">
                  {toolUses.map((tool: unknown, i: number) => {
                    const t = tool as { id?: string; name?: string; input?: Record<string, unknown> };
                    const toolId = t.id || '';
                    return (
                      <ToolCallItem
                        key={toolId || i}
                        id={toolId}
                        name={t.name || 'Unknown'}
                        input={t.input || {}}
                        result={toolResultsMap.get(toolId)}
                        onSubagentClick={onSubagentClick}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        // System message
        if (message.type === 'system') {
          return (
            <div key={index} className="p-2 bg-gray-500/10 rounded text-xs text-muted-foreground">
              <MessageBadge type="system" subtype={message.subtype} />
              {message.session_id && (
                <span className="ml-2 font-mono">Session: {message.session_id.slice(0, 8)}...</span>
              )}
            </div>
          );
        }

        // Result message
        if (message.type === 'result') {
          return (
            <div key={index} className="p-2 bg-purple-500/10 rounded border border-purple-500/20">
              <div className="flex items-center gap-2">
                <MessageBadge type="result" subtype={message.subtype} />
                {message.subtype === 'success' && (
                  <span className="text-green-400">Done</span>
                )}
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
