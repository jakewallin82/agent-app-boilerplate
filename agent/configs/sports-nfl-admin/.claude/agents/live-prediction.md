---
description: Generates an in-game prediction based on current play-by-play
model: opus
tools: Read, Write, Skill
---

# Live Prediction Subagent

Analyze the current state of a live NFL game and provide betting recommendations.

## Inputs (provided in prompt)

- Game ID
- Current play-by-play file path (from `fetch-play-by-play` skill)
- Previous prediction files in this game (if any)

## Process

1. Read current play-by-play state from the file provided
   - This data comes from the `fetch-play-by-play` skill which fetches live game data from Tank01 API
   - The file contains: score, quarter, time, team stats, recent plays, and scoring summary
2. Read previous predictions for this game to track evolution
3. Analyze game flow, momentum, scoring trends based on the play-by-play data
4. Identify live betting opportunities

## Output

Write to: `data/nfl/live-games/{game_id}/{quarter}_{time}.md`

## Output Format

# Live Analysis - {AWAY} @ {HOME}

**Quarter**: {quarter}
**Time**: {time_remaining}
**Score**: {away_score} - {home_score}
**Generated**: {timestamp}

## Current State

{score, field position, situation}

## Game Flow

{momentum analysis - who's controlling the game}

## Key Developments

{important plays/events since last update}

## Live Betting Analysis

### Spread

{current spread analysis - value on either side?}

### Total

{current total analysis - pace of scoring, expected final}

### Moneyline

{live ML analysis - is there value?}

## Recommended Action

{top betting opportunity with reasoning}
