import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SubagentViewer } from './SubagentViewer';
import { ToolUseDisplay } from './ToolUseDisplay';
import type { ChatMessage, Subagent, TimelineItem, ContentBlock, ToolUseBlock } from '@/types';

interface MessageListProps {
  timeline: TimelineItem[];
  messagesMap: Map<string, ChatMessage>;
  subagentsMap: Map<string, Subagent>;
}

function MessageContent({ message }: { message: ChatMessage }) {
  // If we have content blocks, render them
  if (message.contentBlocks && message.contentBlocks.length > 0) {
    return (
      <>
        {message.contentBlocks.map((block, index) => {
          if (block.type === 'text') {
            return (
              <div key={index} className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {block.text || ''}
                </ReactMarkdown>
              </div>
            );
          }

          if (block.type === 'tool_use') {
            // Skip Task tools - they're rendered as SubagentViewer
            if (block.name === 'Task') {
              return null;
            }
            return <ToolUseDisplay key={index} toolUse={block as ToolUseBlock} />;
          }

          if (block.type === 'thinking') {
            return (
              <div key={index} className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2 my-2">
                {block.thinking}
              </div>
            );
          }

          return null;
        })}
      </>
    );
  }

  // Fallback to simple content
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {message.content || (message.isStreaming ? '...' : '')}
      </ReactMarkdown>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const isUser = message.type === 'user';
  const isError = message.type === 'error';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : isError
            ? 'bg-red-900/20 border border-red-500/50'
            : 'bg-card border border-border'
        }`}
      >
        {message.isStreaming && !message.content && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="animate-pulse">●</span>
            <span>Thinking...</span>
          </div>
        )}
        <MessageContent message={message} />
      </div>
    </div>
  );
}

export function MessageList({ timeline, messagesMap, subagentsMap }: MessageListProps) {
  return (
    <div className="space-y-3 max-w-4xl mx-auto">
      {timeline.map((item) => {
        if (item.type === 'message') {
          const message = messagesMap.get(item.id);
          if (!message) return null;
          return <Message key={item.id} message={message} />;
        }

        if (item.type === 'subagent') {
          const subagent = subagentsMap.get(item.id);
          if (!subagent) return null;
          return <SubagentViewer key={item.id} subagent={subagent} />;
        }

        return null;
      })}
    </div>
  );
}
