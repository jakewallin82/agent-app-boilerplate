import type { ChatMessage, TimelineItem, Subagent, SubagentToolCall, ContentBlock } from '@/types';

interface UserViewState {
  timeline: TimelineItem[];
  messagesMap: Map<string, ChatMessage>;
  subagentsMap: Map<string, Subagent>;
}

/**
 * Derives user-mode view state from raw SDK messages.
 * This allows us to display the same data in both modes
 * and works for both live and historical sessions.
 */
export function deriveUserView(rawMessages: unknown[]): UserViewState {
  const timeline: TimelineItem[] = [];
  const messagesMap = new Map<string, ChatMessage>();
  const subagentsMap = new Map<string, Subagent>();
  const addedSubagentIds = new Set<string>();

  let currentAssistantMessageId: string | null = null;
  let assistantContent = '';

  for (const raw of rawMessages) {
    const msg = raw as {
      type?: string;
      subtype?: string;
      uuid?: string;
      message?: { content?: unknown[] } | string;
      parent_tool_use_id?: string;
    };

    // Skip subagent messages (they're handled separately in subagentRawMessages)
    if (msg.parent_tool_use_id) {
      continue;
    }

    // User message
    if (msg.type === 'user') {
      // Skip synthetic messages (e.g., skill documentation injected by SDK)
      if ((msg as { isSynthetic?: boolean }).isSynthetic) continue;

      const id = msg.uuid || crypto.randomUUID();

      // Extract text from user message
      let content = '';
      if (typeof msg.message === 'string') {
        content = msg.message;
      } else if (Array.isArray((msg.message as { content?: unknown[] })?.content)) {
        const textBlocks = ((msg.message as { content?: unknown[] }).content || [])
          .filter((b: unknown) => (b as { type?: string }).type === 'text')
          .map((b: unknown) => (b as { text?: string }).text || '');
        content = textBlocks.join('\n');
      }

      // Skip tool_result only messages (no text content)
      if (!content) continue;

      const chatMessage: ChatMessage = {
        id,
        type: 'user',
        content,
        timestamp: new Date(),
      };

      messagesMap.set(id, chatMessage);
      timeline.push({ type: 'message', id, timestamp: new Date() });

      // Reset assistant accumulator for next assistant response
      assistantContent = '';
      currentAssistantMessageId = null;
    }

    // Assistant message
    if (msg.type === 'assistant') {
      const content = (msg.message as { content?: unknown[] })?.content;
      if (!Array.isArray(content)) continue;

      // Extract text content
      const textContent = content
        .filter((b: unknown) => (b as { type?: string }).type === 'text')
        .map((b: unknown) => (b as { text?: string }).text || '')
        .join('');

      // Extract Task tool calls (subagent spawning)
      const taskCalls = content.filter((b: unknown) =>
        (b as { type?: string; name?: string }).type === 'tool_use' &&
        (b as { name?: string }).name === 'Task'
      );

      // Create subagents for Task calls
      for (const task of taskCalls) {
        const t = task as { id?: string; input?: { subagent_type?: string; description?: string; prompt?: string } };
        const taskId = t.id || '';

        if (!addedSubagentIds.has(taskId)) {
          const subagent: Subagent = {
            id: taskId,
            type: t.input?.subagent_type || 'unknown',
            description: t.input?.description || t.input?.prompt?.substring(0, 50) || 'Task',
            status: 'completed', // Assume completed for historical data
            startTime: new Date(),
            toolCalls: [],
          };

          subagentsMap.set(taskId, subagent);
          addedSubagentIds.add(taskId);
          timeline.push({ type: 'subagent', id: taskId, timestamp: new Date() });
        }
      }

      // Accumulate assistant text
      if (textContent) {
        assistantContent += textContent;

        if (!currentAssistantMessageId) {
          currentAssistantMessageId = msg.uuid || crypto.randomUUID();
          timeline.push({ type: 'message', id: currentAssistantMessageId, timestamp: new Date() });
        }

        messagesMap.set(currentAssistantMessageId, {
          id: currentAssistantMessageId,
          type: 'assistant',
          content: assistantContent,
          contentBlocks: content as ContentBlock[],
          timestamp: new Date(),
        });
      }
    }
  }

  return { timeline, messagesMap, subagentsMap };
}

/**
 * Process subagent raw messages to populate subagent tool calls.
 * Used in conjunction with deriveUserView.
 */
export function processSubagentMessages(
  subagentRawMessages: Map<string, unknown[]>,
  subagentsMap: Map<string, Subagent>
): Map<string, Subagent> {
  const updatedMap = new Map(subagentsMap);

  for (const [parentId, messages] of subagentRawMessages) {
    const subagent = updatedMap.get(parentId);
    if (!subagent) continue;

    const toolCalls: SubagentToolCall[] = [];
    let completed = false;

    for (const msg of messages) {
      const m = msg as {
        type?: string;
        message?: { content?: unknown[] };
      };

      // Check for result message (marks completion)
      if (m.type === 'result') {
        completed = true;
        continue;
      }

      // Extract tool calls from assistant messages
      if (m.type === 'assistant') {
        const content = m.message?.content;
        if (!Array.isArray(content)) continue;

        const toolUses = content.filter((b: unknown) =>
          (b as { type?: string }).type === 'tool_use' &&
          (b as { name?: string }).name !== 'Task'
        );

        for (const tc of toolUses) {
          const t = tc as { id?: string; name?: string; input?: Record<string, unknown> };
          toolCalls.push({
            id: t.id || '',
            name: t.name || 'Unknown',
            input: t.input || {},
            status: 'completed' as const,
            timestamp: new Date(),
          });
        }
      }
    }

    updatedMap.set(parentId, {
      ...subagent,
      toolCalls,
      status: completed ? 'completed' : subagent.status,
      endTime: completed ? new Date() : subagent.endTime,
    });
  }

  return updatedMap;
}
