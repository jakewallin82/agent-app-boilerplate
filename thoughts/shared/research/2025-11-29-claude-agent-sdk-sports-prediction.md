---
date: 2025-11-29T12:00:00-08:00
researcher: Claude
git_commit: e5d75075ac90a798f2e626ffdb25d31f7748c521
branch: master
repository: claude-sports
topic: "Translating NFL LLM Pipelines to Claude Agents SDK Electron App"
tags:
  [
    research,
    codebase,
    claude-agent-sdk,
    nfl-predictions,
    electron,
    sub-agents,
    skills,
  ]
status: complete
last_updated: 2025-11-29
last_updated_by: Claude
last_updated_note: "Simplified to CLAUDE.md-driven approach, removed explicit commands, answered open questions"
---

# Research: Translating NFL LLM Pipelines to Claude Agents SDK Electron App

**Date**: 2025-11-29T12:00:00-08:00
**Researcher**: Claude
**Git Commit**: e5d75075ac90a798f2e626ffdb25d31f7748c521
**Branch**: master
**Repository**: claude-sports

## Research Question

How to translate the current NFL LLM agent applications (nflagent live-play-by-play and oddsui prediction app) into a flexible Electron app built on the Claude Agents SDK, converting rigid LLM pipelines into a flexible set of commands and sub-agents.

## Summary

The research analyzed three codebases and the Claude Agents SDK documentation to understand how to build a sports prediction Electron app. Key findings:

1. **Current nflagent Pipeline**: Uses Tank01 API for live play-by-play, Odds API for betting lines, Jinja2 templates for prompt rendering, and GPT-5 for predictions. Saves predictions with quarter/time filenames.

2. **Current oddsui App**: Full-stack React/FastAPI app with 8 Jinja2 prompt templates, JSON-based storage organized by week, and a reflection feedback loop that informs future predictions.

3. **Excel Demo Reference**: Provides complete template for Electron + Claude SDK architecture with streaming responses, skill definitions, and React UI components.

4. **Claude Agents SDK**: Supports sub-agents for parallel specialized tasks, skills for API integrations, and slash commands for workflow triggers. All configured via `.claude/` directory structure.

## Detailed Findings

### Current nflagent Live Play-by-Play System

**Location**: `/Users/jakewallin/nflagent/live-play-by-play/`

#### Architecture

- **Main Script**: `live_tracker.py` (812 lines)
- **Template**: `prompts/analyze-live-play-by-play.j2`
- **Outputs**:
  - `rendered-templates/{game_id}_{timestamp}.txt`
  - `predictions/{game_id}/{quarter}_{time}.md`
  - `output/{game_id}.md`

#### API Integrations

| API          | Endpoint                               | Purpose                                        |
| ------------ | -------------------------------------- | ---------------------------------------------- |
| Tank01 NFL   | `getNFLBoxScore`                       | Live play-by-play, player stats, scoring plays |
| The Odds API | `/v4/sports/americanfootball_nfl/odds` | Moneyline, spreads, totals                     |

#### Data Flow

```
Tank01 API (every 60s) → Extract game data → Fetch odds
                                    ↓
                        Render Jinja2 template
                                    ↓
                        GPT-5 LLM analysis
                                    ↓
                        Save to predictions/{game_id}/{quarter}_{time}.md
```

#### Key Code Patterns

**Odds Extraction** (`live_tracker.py:622-667`):

```python
{
    'bookmaker': str,
    'moneyline': {'away': int, 'home': int},
    'spread': {'away': {'price': int, 'point': float}, 'home': {...}},
    'total': {'over': {'price': int, 'point': float}, 'under': {...}}
}
```

**Prediction Filename Convention**: `{quarter}_{MM}{SS}.md`

- Example: `3rd_036.md` = 3rd quarter, 0:36 remaining

#### Prompt Template Structure (analyze-live-play-by-play.j2)

- **Sections**: Market Snapshot, Game Flow Analysis, Recent Drives, Spread/Moneyline/Total Analysis, Betting Plan
- **Variables**: `{{ game_id }}`, `{{ team_info }}`, `{{ current_score }}`, `{{ live_play_by_play }}`, `{{ analysis_time }}`

---

### Current oddsui Prediction App

**Location**: `/Users/jakewallin/oddsui/`

#### Architecture

- **Backend**: FastAPI (`main.py`)
- **Frontend**: React/TypeScript (`src/`)
- **Prompts**: 8 Jinja2 templates in `prompts/`
- **Data Storage**: JSON files in `data/` organized by week

#### Prompt Templates

| Template                    | Purpose                                |
| --------------------------- | -------------------------------------- |
| `game_prediction.j2`        | Main prediction generation             |
| `game_reflection.j2`        | Post-game analysis and learning        |
| `routine_traversal.j2`      | DAG-based decision-making              |
| `game_summary.j2`           | Brief game summary                     |
| `detailed_game_summary.j2`  | Comprehensive analysis (400-600 words) |
| `nfl_injury_analysis.j2`    | Official injury report analysis        |
| `injury_report_analysis.j2` | Historical injury synthesis            |
| `injury_depth_analysis.j2`  | Injury + depth chart integration       |

#### Prediction JSON Structure

```json
{
  "game_id": "53d4369464c66630f03a5d128cd39b08",
  "home_team": "Carolina Panthers",
  "away_team": "Buffalo Bills",
  "winner": "Buffalo Bills",
  "spread_pick": "Carolina Panthers",
  "spread_line": -7.0,
  "total_pick": "Under 46.5",
  "confidence": 6,
  "analysis": "...",
  "created_at": "2025-10-24T15:28:48.900950",
  "model_used": "gpt-5",
  "nfl_week": 8
}
```

#### Reflection JSON Structure

```json
{
  "game_id": "...",
  "prediction": { "winner": "...", "spread_pick": "...", "confidence": 6 },
  "evaluation": {
    "final_score": "BAL 40, BUF 41",
    "winner_correct": false,
    "spread_correct": true,
    "total_correct": false
  },
  "reflection": {
    "raw_response": "**ACCURACY REVIEW:** ...\n**LESSONS LEARNED:** ..."
  }
}
```

#### Feedback Loop Pattern

```
Week N Prediction → Game Result → Reflection → Week N+1 Prediction
                                      ↓
                          _load_past_reflections()
                          (up to 5 most recent)
```

**Key Code**: `prediction_service.py:314-377` loads reflections involving either team from previous weeks.

---

### Excel Demo Electron App (Reference Implementation)

**Location**: `/Users/jakewallin/claude-agent-sdk-demos/excel-demo/`

#### Project Structure

```
excel-demo/
├── agent/                           # Claude Agent workspace
│   ├── CLAUDE.MD                    # Main agent instructions
│   └── .claude/skills/xlsx/         # Excel skill
│       ├── SKILL.md                 # Skill documentation
│       └── recalc.py                # Formula recalculation
├── src/
│   ├── main/main.ts                 # Electron main process + Claude SDK
│   ├── main/preload.ts              # IPC bridge
│   └── renderer/                    # React UI
│       ├── components/ChatInterface.tsx
│       ├── components/Message.tsx
│       ├── components/ToolUseDisplay.tsx
│       └── components/ThinkingDisplay.tsx
└── package.json
```

#### CLAUDE.MD Structure

```markdown
# Core Responsibilities

- Spreadsheet operations (create, read, modify, analyze)
- Data analysis and understanding
- Formula management

# Task Scope

- ACCEPT: Excel/spreadsheet tasks
- REFUSE: General coding, non-spreadsheet tasks

# Skill Usage

- Use the `xlsx` skill for all spreadsheet operations
```

#### Skill Definition (SKILL.md)

```yaml
---
name: xlsx
description: "Comprehensive spreadsheet creation, editing, and analysis..."
license: Proprietary
---
```

Key sections:

- Requirements for outputs (color coding, number formatting)
- Workflow instructions (use pandas for analysis, openpyxl for formulas)
- Code examples
- Error verification checklist

#### TypeScript Backend Streaming (`main.ts:87-254`)

```typescript
ipcMain.handle("claude-code:query", async (event, input) => {
  const result = query({
    prompt: input,
    options: {
      cwd: agentFolder,
      maxTurns: 100,
      settingSources: ["local", "project"],
      allowedTools: ["Bash", "Read", "Write", "Edit", "Skill", "TodoWrite"],
    },
  });

  for await (const message of result) {
    mainWindow.webContents.send("claude-code:response", message);
  }
});
```

#### IPC Communication Pattern

```
User Input → Renderer → IPC → Main Process → Claude SDK
                                    ↓
                            Streaming Responses
                                    ↓
                            IPC → Renderer → UI Update
```

---

### Claude Agents SDK Patterns

#### Sub-Agents Configuration

**Programmatic Definition**:

```typescript
agents: {
  'injury-analyzer': {
    description: 'Analyzes injury reports and their game impact',
    prompt: 'You analyze NFL injury reports...',
    tools: ['Read', 'Grep', 'WebSearch'],
    model: 'sonnet'
  },
  'odds-fetcher': {
    description: 'Fetches current betting odds from APIs',
    prompt: 'You fetch and format betting odds...',
    tools: ['Bash', 'Read', 'Write'],
    model: 'haiku'
  }
}
```

**Filesystem Definition** (`.claude/agents/injury-analyzer.md`):

```markdown
---
description: Analyzes injury reports and their game impact
model: sonnet
tools: Read, Grep, WebSearch
---

# Injury Analyzer Agent

You analyze NFL injury reports and assess their impact on game outcomes...
```

#### Skills for API Integration

**Directory Structure**:

```
.claude/skills/fetch-odds/
├── SKILL.md                    # Core instructions
├── scripts/
│   └── fetch_odds.py          # API calling script
└── references/
    └── api_docs.md            # API documentation
```

**SKILL.md Pattern**:

```markdown
---
name: fetch-odds
description: Fetches NFL betting odds from The Odds API
allowed-tools: Bash, Read, Write
---

# Fetch Odds Skill

## Instructions

1. Call the API script: `python {baseDir}/scripts/fetch_odds.py`
2. Parse the JSON response
3. Format for agent consumption
```

#### Slash Commands for Workflows

**File**: `.claude/commands/predict.md`

```markdown
---
allowed-tools: Read, Grep, Bash, Skill
description: Generate prediction for an NFL game
argument-hint: <team1> <team2> <week>
---

# Predict Command

Generate a prediction for $1 vs $2 in week $3.

## Steps

1. Fetch current odds using fetch-odds skill
2. Load injury reports
3. Search for past reflections involving these teams
4. Generate prediction analysis
5. Save to predictions/week$3/
```

---

## Architecture Insights

### Recommended Sports Agent Structure

```
sports-agent/
├── agent/
│   ├── CLAUDE.md                    # Main agent instructions
│   ├── .claude/
│   │   ├── agents/
│   │   │   ├── odds-fetcher.md      # Fetches betting odds
│   │   │   ├── injury-analyzer.md   # Analyzes injury reports
│   │   │   ├── game-researcher.md   # Web search for previews
│   │   │   └── reflection-writer.md # Post-game analysis
│   │   ├── skills/
│   │   │   ├── fetch-odds/
│   │   │   │   ├── SKILL.md
│   │   │   │   └── scripts/odds_api.py
│   │   │   ├── fetch-play-by-play/
│   │   │   │   ├── SKILL.md
│   │   │   │   └── scripts/tank01_api.py
│   │   │   └── fetch-injuries/
│   │   │       ├── SKILL.md
│   │   │       └── scripts/injury_api.py
│   │   └── commands/
│   │       ├── predict.md           # Pregame prediction
│   │       ├── live.md              # Live game tracking
│   │       └── reflect.md           # Post-game reflection
│   ├── data/
│   │   ├── predictions/week_{N}/
│   │   ├── reflections/week_{N}/
│   │   ├── live-games/{game_id}/
│   │   └── injury-reports/
│   └── requirements.txt
├── src/
│   ├── main/main.ts                 # Electron main + Claude SDK
│   └── renderer/                    # React UI
└── package.json
```

### Key Design Decisions

1. **Sub-Agent Specialization**

   - `odds-fetcher`: Read-only, uses Bash to call API scripts
   - `injury-analyzer`: Read-only, combines API data with web search
   - `game-researcher`: Web search for analyst predictions and news
   - `reflection-writer`: Writes reflections to file system

2. **Skills for External APIs**

   - Wrap all API calls in skills with Python scripts
   - Skills handle authentication, error handling, rate limiting
   - Main agent consumes formatted output, not raw API responses

3. **File Organization for Agent Navigation**

   - Consistent naming: `{AWAY}_vs_{HOME}_week{N}.json`
   - Team-based search: `grep` for team abbreviations
   - Week-based filtering: Directory structure by week

4. **Feedback Loop Implementation**
   - Reflections stored with team identifiers
   - Prediction command loads relevant reflections automatically
   - Max 5 recent reflections to manage context

### Translation Mapping

| Current System                 | Claude Agent SDK Equivalent                |
| ------------------------------ | ------------------------------------------ |
| `live_tracker.py` polling loop | `/live` slash command with continuous mode |
| `game_prediction.j2` template  | Main agent + sub-agent prompts             |
| `prediction_service.py`        | Skills + sub-agents                        |
| `reflection_service.py`        | `/reflect` slash command                   |
| JSON file storage              | Same, with standardized naming             |
| FastAPI endpoints              | IPC handlers in Electron main process      |
| React frontend                 | React renderer with streaming display      |

---

## Code References

- `/Users/jakewallin/nflagent/live-play-by-play/live_tracker.py:87-254` - Main tracking loop
- `/Users/jakewallin/nflagent/live-play-by-play/prompts/analyze-live-play-by-play.j2` - LLM prompt template
- `/Users/jakewallin/oddsui/services/prediction_service.py:314-377` - Reflection loading
- `/Users/jakewallin/oddsui/services/llm_client.py:39-84` - Template rendering pattern
- `/Users/jakewallin/claude-agent-sdk-demos/excel-demo/src/main/main.ts:87-254` - Claude SDK streaming
- `/Users/jakewallin/claude-agent-sdk-demos/excel-demo/agent/CLAUDE.MD` - Agent definition
- `/Users/jakewallin/claude-agent-sdk-demos/excel-demo/agent/.claude/skills/xlsx/SKILL.md` - Skill definition

---

## Open Questions

1. **Live Game Mode**: How to implement continuous polling within Claude Agent SDK? Options:

   - Slash command that loops internally
   - External scheduler that triggers agent
   - Background sub-agent with state persistence

2. **Context Window Management**: With 3-hour games, how to manage context?

   - Use compaction (`/compact`) between quarters
   - Sub-agents return summaries, not full data
   - Store intermediate analysis in files

3. **Model Selection**: Which models for which tasks?

   - Main agent: Opus/Sonnet for complex reasoning
   - Sub-agents: Haiku for API fetching, Sonnet for analysis

4. **Authentication**: How to handle multiple API keys (Tank01, Odds API, OpenAI)?

   - Environment variables in agent workspace
   - Skills read from `.env` file

5. **UI Design**: What information to display during live games?
   - Current score and odds
   - Recent predictions timeline
   - Sub-agent activity indicators
   - Streaming analysis text

---

## Next Steps

1. **Phase 1: Project Setup**

   - Copy excel-demo as starting template
   - Set up agent/ directory structure
   - Configure package.json dependencies

2. **Phase 2: Skills Development**

   - Create fetch-odds skill with Odds API script
   - Create fetch-play-by-play skill with Tank01 API script
   - Create fetch-injuries skill

3. **Phase 3: Sub-Agents**

   - Define odds-fetcher agent
   - Define injury-analyzer agent
   - Define game-researcher agent (web search)
   - Define reflection-writer agent

4. **Phase 4: Commands**

   - Implement /predict command
   - Implement /reflect command
   - Implement /live command (advanced)

5. **Phase 5: UI**
   - Adapt React components for sports context
   - Add game selection interface
   - Add prediction/reflection display components

---

## Follow-up Research: Final Simplified Architecture (2025-11-29)

Based on user feedback, the architecture has been significantly simplified. **No explicit slash commands** - the main CLAUDE.md handles all requests flexibly through natural language.

### Core Design Principle: Flexible CLAUDE.md

The main agent understands natural language requests and dynamically:

- Spawns parallel subagents when needed (e.g., "predict all week 13 games")
- Uses skills for API calls
- Writes all outputs as markdown files

### Final Project Structure

```
sports-agent/
├── agent/
│   ├── CLAUDE.md                        # Main agent - handles ALL requests flexibly
│   ├── .claude/
│   │   ├── agents/
│   │   │   ├── predict.md               # Single game prediction subagent
│   │   │   ├── reflect.md               # Single game reflection subagent
│   │   │   ├── live-prediction.md       # Live game prediction subagent
│   │   │   └── injury-researcher.md     # Web-based injury research subagent
│   │   └── skills/
│   │       ├── fetch-odds/
│   │       │   ├── SKILL.md
│   │       │   └── scripts/odds_api.py
│   │       └── fetch-play-by-play/
│   │           ├── SKILL.md
│   │           └── scripts/tank01_api.py
│   ├── data/
│   │   ├── predictions/week_{N}/
│   │   │   └── {AWAY}_vs_{HOME}_week{N}.md
│   │   ├── reflections/week_{N}/
│   │   │   └── {AWAY}_vs_{HOME}_week{N}.md
│   │   ├── live-games/{game_id}/
│   │   │   └── {quarter}_{time}.md
│   │   └── injury-reports/
│   │       └── {TEAM}_{date}.md
│   ├── .env                             # API keys (copied from nflagent/.env)
│   └── requirements.txt
├── src/
│   ├── main/main.ts                     # Electron main + Claude SDK (copy from excel-demo)
│   └── renderer/                        # React UI (copy from excel-demo)
│       ├── components/
│       │   ├── ChatInterface.tsx
│       │   ├── Message.tsx
│       │   ├── ToolUseDisplay.tsx       # Reuse for showing tool calls
│       │   └── ThinkingDisplay.tsx      # Reuse for showing thinking
└── package.json
```

### Main CLAUDE.md (Complete)

```markdown
# NFL Sports Prediction Agent

You are an NFL betting analysis agent. You help users make pregame predictions, track live games, and reflect on past predictions to improve.

## Your Capabilities

### Pregame Predictions

When the user asks to predict a game or multiple games:

**Single game** (e.g., "Predict the Bills vs Jets game"):

1. Use the `fetch-odds` skill to get current odds
2. Spawn the `injury-researcher` subagent for both teams
3. Search for past reflections involving either team (check `data/reflections/` for last 3 weeks)
4. Web search for analyst predictions and game previews
5. Write prediction to `data/predictions/week_{N}/{AWAY}_vs_{HOME}_week{N}.md`

**All games in a week** (e.g., "Predict all week 13 games"):

1. Use the `fetch-odds` skill to get all games for the week
2. Spawn **parallel** `predict` subagents for each game
3. After all complete, read each prediction file from `data/predictions/week_{N}/`
4. Generate a summary based on what the user wants:
   - Default: List all picks with confidence
   - "Top 5": Highest confidence picks
   - "Best bets": Confidence >= 7
   - "Upset watch": Underdog picks
5. Write summary to `data/predictions/week_{N}/SUMMARY.md`

### Post-Game Reflections

When the user asks to reflect on games:

**Single game** (e.g., "Reflect on the Bills vs Jets game"):

1. Read the original prediction from `data/predictions/`
2. Web search for final score and game recaps
3. Compare prediction to actual outcome
4. Extract lessons learned
5. Write reflection to `data/reflections/week_{N}/{AWAY}_vs_{HOME}_week{N}.md`

**All games in a week** (e.g., "Reflect on all week 12 games"):

1. Web search for "NFL week {N} scores results"
2. Find all predictions we made in `data/predictions/week_{N}/`
3. Spawn **parallel** `reflect` subagents for each game
4. After all complete, calculate overall accuracy and patterns
5. Write summary to `data/reflections/week_{N}/SUMMARY.md`

### Live Game Tracking

When the user asks to track a live game (e.g., "Track the Bills game live"):

1. Create directory `data/live-games/{game_id}/`
2. Enter a loop:
   - Use `fetch-play-by-play` skill to get current state
   - Spawn `live-prediction` subagent to analyze
   - Wait for subagent to complete and read its output
   - Report key insights to user
   - Use `Bash("sleep 300")` to wait 5 minutes
   - Repeat until game ends
3. When game is final, generate `GAME_SUMMARY.md`

**Context Management for Live Games:**

- Subagents have isolated context (won't fill up main context)
- Use `/compact` if context gets large during long games
- Consider running every 5 minutes during regular play, every 2 minutes in 4th quarter

## Available Subagents

### predict

Generates a pregame prediction for a single NFL game. Spawn with the matchup and week.

### reflect

Generates a post-game reflection for a single NFL game. Spawn with matchup, final score, and prediction file path.

### live-prediction

Generates an in-game prediction. Spawn with game ID and current state file path.

### injury-researcher

Researches injuries using ESPN and web searches. Spawn with team name(s).

## Available Skills

### fetch-odds

Fetches current betting odds from The Odds API.
Usage: Invoke the skill and specify the week number.

### fetch-play-by-play

Fetches live play-by-play from Tank01 API.
Usage: Invoke the skill and specify the game ID.

## File Organization

All outputs are **Markdown files** (no JSON):

- `data/predictions/week_{N}/{AWAY}_vs_{HOME}_week{N}.md`
- `data/reflections/week_{N}/{AWAY}_vs_{HOME}_week{N}.md`
- `data/live-games/{game_id}/{quarter}_{time}.md`
- `data/injury-reports/{TEAM}_{date}.md`

Use Glob and Grep to find relevant files:

- Find team's recent games: `grep -l "BUF" data/predictions/week_*/`
- Find all week 13 predictions: `glob data/predictions/week_13/*.md`

## Output Format

Write all outputs as unstructured Markdown with headers. No JSON.

Example prediction:

# BUF vs NYJ - Week 12 Prediction

**Date**: November 29, 2025
**Spread**: BUF -3.5
**Total**: 42.5

## Injury Impact

Buffalo is healthy. The Jets are missing Sauce Gardner (hamstring, OUT)...

## Prediction

**Winner**: Buffalo Bills
**Spread Pick**: BUF -3.5 - Jets secondary too depleted
**Total Pick**: Over 42.5
**Confidence**: 7/10

## Analysis

The injury news tilts this game toward Buffalo...

## Important Notes

- Use **parallel subagents** when processing multiple games for efficiency
- Always check for existing predictions/reflections before creating new ones
- Incorporate lessons from past reflections into new predictions
- For live tracking, the subagent handles analysis - you orchestrate timing
- All model calls use **Opus** for maximum capability
```

### Subagents

#### predict.md

```markdown
---
description: Generates a pregame prediction for a single NFL game
model: opus
tools: Read, Write, Grep, Glob, Skill, WebSearch, WebFetch, Task
---

# Predict Subagent

Generate a pregame prediction for the specified NFL game.

## Process

1. Read odds data for this game
2. Spawn injury-researcher subagent for both teams
3. Search `data/reflections/` for past reflections involving either team (last 3 weeks)
4. Web search for analyst predictions and game previews (filter for current week)
5. Synthesize analysis and write prediction

## Output

Write to: `data/predictions/week_{N}/{AWAY}_vs_{HOME}_week{N}.md`

## Output Format

# {AWAY} vs {HOME} - Week {N} Prediction

**Date**: {date}
**Spread**: {favorite} {line}
**Total**: {over_under}
**Moneyline**: {away_ml} / {home_ml}

## Injury Impact

{analysis of key injuries and their effect on the game}

## Key Matchups

{important position battles and scheme matchups}

## Historical Context

{relevant insights from past reflections on these teams}

## Prediction

**Winner**: {team}
**Spread Pick**: {team} {line} - {reasoning}
**Total Pick**: {Over/Under} {total} - {reasoning}
**Confidence**: {1-10}

## Analysis

{detailed reasoning for the prediction}
```

#### reflect.md

```markdown
---
description: Generates a post-game reflection for a single NFL game
model: opus
tools: Read, Write, Grep, Glob, WebSearch, WebFetch
---

# Reflect Subagent

Analyze a completed NFL game and extract lessons learned.

## Inputs (provided in prompt)

- Game matchup
- Week number
- Final score
- Original prediction file path

## Process

1. Read the original prediction
2. Web search for game recaps and box scores
3. Compare prediction to actual outcome
4. Identify what reasoning was correct/incorrect
5. Extract actionable lessons for future predictions

## Output

Write to: `data/reflections/week_{N}/{AWAY}_vs_{HOME}_week{N}.md`

## Output Format

# {AWAY} vs {HOME} - Week {N} Reflection

**Final Score**: {away_score} - {home_score}
**Date**: {date}

## Prediction Accuracy

| Pick   | Prediction | Actual   | Correct |
| ------ | ---------- | -------- | ------- |
| Winner | {pred}     | {actual} | Yes/No  |
| Spread | {pred}     | {actual} | Yes/No  |
| Total  | {pred}     | {actual} | Yes/No  |

## What Happened

{summary of game flow and key moments}

## What We Got Right

{analysis of correct predictions and reasoning}

## What We Missed

{analysis of incorrect predictions - what did we miss?}

## Lessons Learned

{specific, actionable insights for future predictions}

## Team Notes

- **{AWAY}**: {updated assessment of team}
- **{HOME}**: {updated assessment of team}
```

#### live-prediction.md

```markdown
---
description: Generates an in-game prediction based on current play-by-play
model: opus
tools: Read, Write, Skill
---

# Live Prediction Subagent

Analyze the current state of a live NFL game and provide betting recommendations.

## Inputs (provided in prompt)

- Game ID
- Current play-by-play file path
- Previous prediction files in this game (if any)

## Process

1. Read current play-by-play state
2. Read previous predictions for this game to track evolution
3. Analyze game flow, momentum, scoring trends
4. Identify live betting opportunities

## Output

Write to: `data/live-games/{game_id}/{quarter}_{time}.md`

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
```

#### injury-researcher.md

```markdown
---
description: Researches current injury status for NFL teams using web sources
model: opus
tools: WebFetch, WebSearch, Read, Write
---

# Injury Researcher Subagent

Research injury information for the specified team(s) using web sources.

## Process

### Step 1: Fetch ESPN Injury Report

WebFetch: https://www.espn.com/nfl/injuries

Extract injuries for the relevant team(s):

- Player name and position
- Injury type
- Status (Out, Doubtful, Questionable, Probable)

### Step 2: Fetch Team Depth Chart

For each team, fetch:

- https://www.espn.com/nfl/team/depth/_/name/{team_abbr}/{team-full-name}

Examples:

- buf/buffalo-bills
- nyj/new-york-jets
- kc/kansas-city-chiefs

Note backup players for any injured starters.

### Step 3: Dynamic Searches for Key Players

For any Questionable/Doubtful players at key positions (QB, RB1, WR1, key defenders):

Web search: "{player_name} injury update"

**IMPORTANT**: Filter for articles from the last 24 hours only.

Extract:

- Latest practice participation
- Coach quotes
- Expected availability

### Step 4: Assess Impact

For significant injuries:

- How critical is this player?
- Who replaces them?
- Historical performance without this player
- Betting implications

## Output

Write to: `data/injury-reports/{TEAM}_{date}.md`

## Output Format

# {TEAM} Injury Report - {date}

## Critical Injuries

### {Player Name} - {Position}

- **Status**: Out/Doubtful/Questionable
- **Injury**: {type}
- **Latest Update**: {news from last 24 hours}
- **Backup**: {replacement player}
- **Impact**: {assessment}

## Depth Chart Concerns

{analysis}

## Betting Implications

{how injuries affect spread/total/ML}
```

### Skills

#### fetch-odds/SKILL.md

````markdown
---
name: fetch-odds
description: Fetches current NFL betting odds from The Odds API
allowed-tools: Bash, Read, Write
---

# Fetch Odds

Fetches current betting odds for NFL games.

## Usage

```bash
python {baseDir}/scripts/odds_api.py --week {week}
```
````

## Output

Saves odds data to `data/odds/week_{N}_odds.md` in readable format:

# Week {N} NFL Odds

## {AWAY} @ {HOME}

- **Spread**: {favorite} {line} ({price})
- **Total**: {over_under} ({over_price} / {under_price})
- **Moneyline**: {away_ml} / {home_ml}
- **Game Time**: {datetime}

...

````

#### fetch-play-by-play/SKILL.md
```markdown
---
name: fetch-play-by-play
description: Fetches live play-by-play data from Tank01 API
allowed-tools: Bash, Read, Write
---

# Fetch Play-by-Play

Fetches current play-by-play for a live NFL game.

## Usage
```bash
python {baseDir}/scripts/tank01_api.py --game_id {game_id}
````

## Output

Saves to `data/live-games/{game_id}/current_state.md`:

# {AWAY} @ {HOME} - Live State

**Score**: {away_score} - {home_score}
**Quarter**: {quarter}
**Time**: {time_remaining}
**Possession**: {team}

## Team Stats

| Stat        | {AWAY} | {HOME} |
| ----------- | ------ | ------ |
| Total Yards | X      | Y      |
| Passing     | X      | Y      |
| Rushing     | X      | Y      |
| TOP         | X      | Y      |

## Recent Plays

{last 10 plays with details}

## Scoring Summary

{all scoring plays}

```

### Answered Open Questions

1. **Live Game Mode**: Use `Bash("sleep 300")` for 5-minute intervals. Main agent orchestrates, spawns live-prediction subagent each iteration. Subagents have isolated context so main agent stays lean.

2. **Context Management**:
   - Subagents isolate context (their work doesn't fill main context)
   - Auto-compaction available if needed during long games
   - Will experiment with intervals and compaction frequency

3. **Model Selection**: **Opus for all tasks** to maximize capability.

4. **Authentication**: Copy API keys from `nflagent/.env` to new app's `.env`:
```

ODDS_API_KEY=...
TANK01_API_KEY=...
OPENAI_API_KEY=... # if needed

```

5. **UI**:
- Reuse excel-demo's ChatInterface, Message, ToolUseDisplay, ThinkingDisplay
- Display agent messages as they stream
- Users read markdown files in their own IDE

### Design Decisions Summary

1. **No slash commands** - CLAUDE.md handles all requests flexibly via natural language
2. **Skills for APIs only** - fetch-odds and fetch-play-by-play wrap external APIs
3. **Subagents for analysis** - predict, reflect, live-prediction, injury-researcher
4. **Parallel execution** - Main agent spawns many subagents for batch operations
5. **File-based outputs** - All results written as markdown files
6. **Opus everywhere** - Maximum capability for all tasks
7. **Reuse excel-demo UI** - Copy the streaming message display components, don't worry about sports specific components yet
```
