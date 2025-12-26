/**
 * Frontend configuration
 *
 * This configures which agent the frontend uses by default.
 * Must match an agent ID in apps/server/src/config/agents.json
 */
export const config = {
  // The default agent to use for warmup and queries
  // Should be an agent with "strategy": "pre-warm-on-login" for warmup to work
  defaultAgentId: 'sports-nfl',
} as const;
