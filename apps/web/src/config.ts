/**
 * Frontend configuration
 */

export interface AgentOption {
  id: string;
  name: string;
  description: string;
  isAdmin?: boolean;  // Only show to admin users
}

export const config = {
  defaultAgentId: 'sports-nba' as string,

  // Available agents for selection
  // Must match IDs in apps/server/src/config/agents.json
  agents: [
    {
      id: 'sports-nba',
      name: 'NBA Predictions',
      description: 'Get NBA game predictions and analysis',
    },
    {
      id: 'sports-nfl',
      name: 'NFL Predictions',
      description: 'Get NFL game predictions and analysis',
    },
    {
      id: 'sports-nhl',
      name: 'NHL Predictions',
      description: 'Get NHL game predictions and analysis',
    },
    {
      id: 'sports-mlb',
      name: 'MLB Predictions',
      description: 'Get MLB game predictions and analysis',
    },
    {
      id: 'sports-ncaab',
      name: 'College Basketball',
      description: 'Get NCAAB game predictions and analysis',
    },
    {
      id: 'sports-admin',
      name: 'Sports Admin',
      description: 'Generate predictions (admin only)',
      isAdmin: true,
    },
  ] as AgentOption[],
} as const;
