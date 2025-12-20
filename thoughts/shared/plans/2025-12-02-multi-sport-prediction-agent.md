# Multi-Sport Prediction Agent Implementation Plan

## Overview

This plan expands the current NFL-only prediction agent into a comprehensive multi-sport, multi-bet-type platform supporting NFL, NBA, NHL, MLB, and College Basketball (NCAAB/NCAAF). The system will handle game predictions, player props, futures bets, and correlated parlays while maintaining a portfolio-level view of all predictions.

## Current State Analysis

### Existing Architecture

- **Agent System**: Main orchestrator (`CLAUDE.md`) delegates to subagents (`predict.md`, `reflect.md`, `injury-researcher.md`, `live-prediction.md`)
- **Data Organization**: Flat structure under `data/` with `predictions/`, `reflections/`, `depth-charts/`, `injury-reports/`, `live-games/`, `odds/`
- **Skills**: `fetch-odds`, `fetch-play-by-play`, sport-specific fetch skills (`fetch-nfl`, `fetch-nba`, `fetch-nhl`, `fetch-ncaam`)
- **Output**: All Markdown files, chronologically organized by week

### Key Discoveries from Research

**Market AI Features** (from [Rithmm](https://www.rithmm.com/), [Leans.AI](https://leans.ai/)):

- Multi-sport coverage with sport-specific AI models
- Player props with confidence signals
- Same-game parlay builders with correlation awareness
- Real-time odds comparison across sportsbooks
- Portfolio tracking with win rate analytics

**Sport-Specific Data Sources**:
| Sport | Free Data Sources | Premium Options |
|-------|------------------|-----------------|
| NFL | [The Odds API](https://the-odds-api.com/), ESPN depth charts, Football Outsiders | PFF, Tank01 API |
| NBA | ESPN injury reports, NBA API | Sportradar, SportsDataIO |
| NHL | [NHL API](https://github.com/Zmalski/NHL-API-Reference), [Natural Stat Trick](https://www.naturalstattrick.com/), Hockey Reference | Sportradar |
| MLB | [Baseball Savant](https://baseballsavant.mlb.com/) (Statcast), [FanGraphs](https://www.fangraphs.com), [pybaseball](https://github.com/jldbc/pybaseball) | Sportradar |
| NCAAB | [Bart Torvik](https://barttorvik.com/), [cbbdata](https://cbbdata.aweatherman.com/), [NCAA API](https://github.com/henrygd/ncaa-api) | KenPom ($) |

**Player Props Strategy** (from [Kindred hybrid modeling](https://medium.com/@kindred-tech/hybrid-player-props-modelling-for-the-modern-sportsbook-7ed4a6d11099)):

- Counting stats (assists, rebounds) follow Poisson distribution
- Bet the median, not the mean (right-skewed distributions)
- Hybrid models combining market odds + engineered features outperform pure statistical models
- Player props are more beatable due to lower liquidity and customer biases (over preference)

**SGP Correlation** (from [Wizard of Odds](https://wizardofodds.com/article/same-game-parlays-the-mathematics-of-correlation/)):

- SGPs carry 15-25% house edge vs 4-5% for singles
- Correlated outcomes require Gaussian copulas or correlation matrices
- Shop across books - same SGP can vary from +369 to +580
- Best value in situational SGPs before market reacts to news

---

## Proposed Architecture Options

### Option 1: Sport-First Organization (Horizontal Isolation)

**Structure:**

```
data/
├── nfl/
│   ├── predictions/week_{N}/
│   ├── reflections/week_{N}/
│   ├── player-props/week_{N}/
│   ├── depth-charts/
│   ├── injury-reports/
│   └── live-games/
├── nba/
│   ├── predictions/{date}/
│   ├── reflections/{date}/
│   ├── player-props/{date}/
│   ├── rest-tracker/
│   └── injury-reports/
├── nhl/
│   └── ...
├── mlb/
│   └── ...
├── ncaab/
│   └── ...
└── general/
    ├── portfolio/
    ├── monthly-reflections/
    └── cross-sport-analysis/

agents/
├── nfl/
│   ├── predict-nfl.md
│   ├── reflect-nfl.md
│   ├── injury-researcher-nfl.md
│   └── props-nfl.md
├── nba/
│   ├── predict-nba.md
│   ├── reflect-nba.md
│   ├── rest-predictor-nba.md
│   └── props-nba.md
└── ...
```

**Pros:**

- Complete isolation prevents cross-sport data contamination
- Easy to add new sports without affecting existing ones
- Sport-specific agents can be highly specialized
- Clear ownership and file paths

**Cons:**

- Significant code duplication across sports
- Harder to maintain consistency across sports
- No shared learning between sports
- More agents to maintain (4-5 agents × 5 sports = 20+ agents)

**Best For:** Teams with sport-specific experts who want full autonomy per sport.

---

## Sport-Specific Agent Customizations

### NFL (Existing + Enhancements)

| Agent                      | Purpose            | Tools                               |
| -------------------------- | ------------------ | ----------------------------------- |
| `predict-nfl.md`           | Game predictions   | Task, WebSearch, Read, Write, Skill |
| `reflect-nfl.md`           | Post-game analysis | Read, Write, WebSearch, Skill       |
| `injury-researcher-nfl.md` | Starter injuries   | WebFetch, WebSearch, Write          |
| `props-nfl.md`             | Player props       | WebSearch, Task, Write              |
| `live-prediction-nfl.md`   | In-game updates    | Skill, Write                        |

**New/Tweaked:**

- `props-nfl.md`: Focuses on passing/rushing/receiving yards, TDs, receptions. Uses game prediction as context.

### NBA

| Agent                   | Purpose                 | Unique Aspects               |
| ----------------------- | ----------------------- | ---------------------------- |
| `predict-nba.md`        | Game predictions        | Daily schedule, no "weeks"   |
| `reflect-nba.md`        | Post-game analysis      | Box score focus              |
| `rest-predictor-nba.md` | **NEW** Load management | Predicts who sits on B2Bs    |
| `props-nba.md`          | Player props            | Points/rebounds/assists, PRA |

**Key Differences from NFL:**

- **No "weeks"** - NBA uses dates: `data/nba/predictions/2025-01-15/`
- **Rest/load management** is the #1 research priority (vs injuries for NFL)
- **Back-to-backs (B2B)** heavily influence predictions
- **Rotation** matters more - minutes restrictions for veterans

**Research from [NBA load management study](https://www.nba.com/news/nba-sends-data-load-management-study):**

- Injury odds increase 2.87% per 96 minutes played
- Injury odds decrease 15.96% per day of rest
- Stars miss 23.9 games/season (2020s) vs 10.6 (1990s)

### NHL

| Agent                      | Purpose                    | Unique Aspects                  |
| -------------------------- | -------------------------- | ------------------------------- |
| `predict-nhl.md`           | Game predictions           | Goalie-centric                  |
| `reflect-nhl.md`           | Post-game analysis         | Advanced stats (Corsi, Fenwick) |
| `goalie-researcher-nhl.md` | **NEW** Confirmed starters | Most important variable         |
| `props-nhl.md`             | Player props               | Shots, goals, assists, saves    |

**Key Differences from NFL:**

- **Goalie confirmation** is #1 priority - wait until ~5pm ET for starters
- **Advanced metrics**: Corsi (shot attempts), Fenwick (unblocked shot attempts), xGF (expected goals)
- **Back-to-backs** matter but less than NBA
- Use [Natural Stat Trick](https://www.naturalstattrick.com/) for advanced stats

### MLB

| Agent                     | Purpose             | Unique Aspects           |
| ------------------------- | ------------------- | ------------------------ |
| `predict-mlb.md`          | Game predictions    | SP matchup dominant      |
| `reflect-mlb.md`          | Post-game analysis  | Pitching vs batting      |
| `pitching-matchup-mlb.md` | **NEW** SP analysis | ERA, FIP, xFIP, Statcast |
| `props-mlb.md`            | Player props        | Strikeouts, hits, HRs    |

**Key Differences from NFL:**

- **Starting pitcher (SP) drives everything** - must confirm before predicting
- **Bullpen usage** matters for totals
- **Platoon splits** (L/R matchups) critical for props
- Use [Baseball Savant](https://baseballsavant.mlb.com/) for Statcast data, [FanGraphs](https://www.fangraphs.com) for projections

### NCAAB (College Basketball)

| Agent                      | Purpose                    | Unique Aspects           |
| -------------------------- | -------------------------- | ------------------------ |
| `predict-ncaab.md`         | Game predictions           | Efficiency-based         |
| `reflect-ncaab.md`         | Post-game analysis         | Tempo-free stats         |
| `kenpom-analyzer-ncaab.md` | **NEW** Efficiency metrics | AdjO, AdjD, Tempo        |
| `props-ncaab.md`           | Player props               | Limited - focus on games |

**Key Differences from NFL:**

- **No reliable injury info** - limited reporting
- **Efficiency metrics** matter most: [Bart Torvik](https://barttorvik.com/) (free), KenPom (paid)
- **Conference matchups** have different dynamics
- **Props are limited** - less liquidity, fewer markets

---

## Player Props Agent Flow

### Question: Should we predict game first, then base props on game prediction?

**Recommended: Yes, use game prediction as context**

**Workflow:**

```
1. Game prediction exists?
   → Yes: Read game prediction
   → No: Run game prediction first

2. Load game context:
   - Predicted winner, spread, total
   - Key matchups identified
   - Injury impacts

3. For each player prop:
   a. Get player's recent stats (last 5-10 games)
   b. Get opponent's defensive stats vs position
   c. Factor in game script (winning team runs more, losing team passes more)
   d. Calculate expected value
   e. Compare to available line

4. Output player props with:
   - Pick (over/under)
   - Expected value calculation
   - Correlation to game prediction
   - Confidence rating
```

**Why this approach:**

- Game context matters: A blowout means fewer minutes for starters
- Correlated props: If predicting Buffalo to dominate, Josh Allen props should align
- Consistent narrative: Avoids contradictory predictions

### Question: Should we predict every player for a game?

**Recommended: No, be selective**

**Approach:**

- Default: Predict 3-5 "best value" props per game
- On request: Full slate for a specific game
- Key positions only: QB, top RB, top 2 WRs for NFL

**Why selective:**

- Quality > quantity for accuracy tracking
- Liquidity varies by player
- Correlation matters - many props are correlated

## Data Organization Recommendations

### Time-Based vs Event-Based

| Sport   | Organization              | Rationale             |
| ------- | ------------------------- | --------------------- |
| NFL     | `week_{N}`                | Clear weekly cadence  |
| NBA     | `{YYYY-MM-DD}`            | Daily games, no weeks |
| NHL     | `{YYYY-MM-DD}`            | Daily games           |
| MLB     | `{YYYY-MM-DD}`            | Daily games           |
| NCAAB   | `{YYYY-MM-DD}`            | Daily games           |
| Futures | `{YYYY-MM-DD}_assessment` | Point-in-time         |

### File Naming Conventions

```
# Game Predictions
{AWAY}_vs_{HOME}_{date_or_week}.md

# Player Props
{PLAYER_NAME}_{stat}_{date}.md
# OR grouped:
{AWAY}_vs_{HOME}_props_{date}.md

# Reflections (same as predictions)
{AWAY}_vs_{HOME}_{date_or_week}.md

# Research
{TEAM}_{TYPE}_{date}.md
```

---

## Migration Path from Current System

### Phase 1: Data Reorganization

1. Create `data/nfl/` directory
2. Move existing data:
   - `data/predictions/` → `data/nfl/predictions/`
   - `data/reflections/` → `data/nfl/reflections/`
   - `data/depth-charts/` → `data/nfl/research/depth-charts/`
   - `data/injury-reports/` → `data/nfl/research/injury-reports/`
   - `data/live-games/` → `data/nfl/live-games/`
   - `data/odds/` → `data/nfl/odds/`
3. Update all absolute paths in agents

### Phase 2: Agent Reorganization

1. Create `agents/nfl/` directory
2. Rename and move:
   - `predict.md` → `agents/nfl/predict-nfl.md`
   - `reflect.md` → `agents/nfl/reflect-nfl.md`
   - `injury-researcher.md` → `agents/nfl/injury-researcher-nfl.md`
   - `live-prediction.md` → `agents/nfl/live-prediction-nfl.md`
3. Create `agents/nfl/props-nfl.md`
4. Update `CLAUDE.md` to route to sport-specific agents

### Phase 3: Add New Sports

1. Create `agents/{sport}/` directories
2. Copy NFL templates, modify for sport-specific needs
3. Create sport-specific skills (`skills/fetch-{sport}/`) ALREADY CREATED
4. Create data directories (`data/{sport}/`)
5. Test each sport independently

---

## Success Criteria

### Manual Verification

- [ ] NFL prediction workflow unchanged
- [ ] New sport predictions generate correct file paths
- [ ] Player props include game context
- [ ] Portfolio summaries aggregate correctly
- [ ] Cross-sport reflections work

---

## Open Questions (Resolved)

1. **Q: How to handle daily vs weekly sports?**
   A: Use date-based organization for daily sports (NBA, NHL, MLB), week-based for NFL.

2. **Q: Should props be predicted with every game?**
   A: No, be selective. Default to 3-5 best-value props per game.

3. **Q: Should game prediction precede props?**
   A: Yes, game context improves prop accuracy and ensures narrative consistency.

---

## References

- Original spec: `/Users/jakewallin/claude-sports/specs/multi-sport-organization.md`
- Current agents: `/Users/jakewallin/claude-sports/claude-sports-app/agent/.claude/agents/`
- Current data: `/Users/jakewallin/claude-sports/claude-sports-app/agent/data/`

### Data Source Links

- [The Odds API](https://the-odds-api.com/) - Odds data (free tier available)
- [OpticOdds](https://opticodds.com/) - Real-time props (premium)
- [Bart Torvik](https://barttorvik.com/) - Free KenPom alternative
- [Natural Stat Trick](https://www.naturalstattrick.com/) - Free NHL analytics
- [Baseball Savant](https://baseballsavant.mlb.com/) - Free MLB Statcast
- [FanGraphs](https://www.fangraphs.com) - Free MLB analytics
- [pybaseball](https://github.com/jldbc/pybaseball) - Python MLB data
- [NHL API Reference](https://github.com/Zmalski/NHL-API-Reference) - Unofficial NHL API docs
- [cbbdata](https://cbbdata.aweatherman.com/) - College basketball R package
