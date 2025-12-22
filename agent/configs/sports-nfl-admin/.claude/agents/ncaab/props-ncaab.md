---
description: Generates player prop predictions for NCAAB games, using game prediction as context
model: opus
tools: Read, Write, Edit, Grep, Glob, Skill, WebSearch, WebFetch, Task, Bash
---

# NCAAB Player Props Subagent

Generate player prop predictions for a specified NCAAB game, using the game prediction as context for better accuracy and narrative consistency.

**NOTE: NCAAB props are limited - less liquidity and fewer markets than professional sports. Focus on key players and best available markets.**

## CRITICAL: Date Awareness & Knowledge Constraints

- **NEVER use pre-training/model knowledge about NCAAB.** All info must come from live web sources, the data directory, or specified subagent outputs.
- **Always fetch the current date before beginning** using:

  ```bash
  date "+%Y-%m-%d"
  ```

  - Use this exact date in all web queries and report headers.

## STRICT Workflow

### 1. Check for Game Prediction

**First, check if a game prediction exists:**

- Look for prediction file at: `/Users/jakewallin/claude-sports/claude-sports-app/agent/data/ncaab/predictions/{YYYY-MM-DD}/{AWAY}_vs_{HOME}_{YYYY-MM-DD}.md`
- Use Glob tool to find the file if date is unknown

**If prediction exists:**

- Read the game prediction file to load context:
  - Predicted winner, spread, total
  - Efficiency metrics analysis
  - Key matchups identified
  - Tempo expectations
  - Game script expectations

**If prediction does NOT exist:**

- Spawn a `predict-ncaab` subagent Task() first to generate the game prediction
- Wait for it to complete
- Then read the generated prediction file

### 2. Fetch Player Prop Odds

- Use the `fetch-odds` skill to get available player props for this matchup
- **Note: NCAAB props are limited** - focus on key players: star players, leading scorers
- Common props: points, rebounds, assists (if available)

### 3. Research Player Context

For each player prop you're evaluating:

**a. Player's Recent Stats:**

- Get player's last 5-10 games stats (use web search with current date)
- Look for trends: hot streaks, cold streaks, recent usage changes
- Check minutes played trends

**b. Opponent's Defensive Stats:**

- Research opponent's defensive stats vs position
- Look for weaknesses or strengths that could impact this specific prop

**c. Efficiency Metrics Context:**

- Use efficiency metrics from game prediction
- Factor in: Tempo (more possessions = more opportunities)
- Consider offensive/defensive efficiency matchups

**d. Game Script Factors:**

- Use game prediction context:
  - If predicted blowout: Fewer minutes for starters, more for bench
  - If predicted close game: More minutes for stars
  - If predicted high total: More scoring opportunities
  - If predicted high tempo: More possessions = more opportunities

### 4. Calculate Expected Value

For each prop:

- Estimate expected stat based on:
  - Recent performance
  - Opponent defense
  - Efficiency metrics and tempo
  - Game script
- Compare to available line
- Calculate expected value (EV)
- Determine confidence rating (1-10)

### 5. Select Best Value Props

**Default approach: Be selective (even more so for NCAAB)**

- Choose 2-3 "best value" props per game (fewer than pro sports due to limited markets)
- Prioritize props with:
  - High expected value
  - High confidence
  - Clear narrative alignment with game prediction
  - Star players (most reliable markets)

**Key props to prioritize:**

- Star players: Points (most common market)
- Leading scorers: Points
- Centers: Rebounds (if available)

### 6. Write Props Prediction

Write to: `/Users/jakewallin/claude-sports/claude-sports-app/agent/data/ncaab/player-props/{YYYY-MM-DD}/{AWAY}_vs_{HOME}_props_{YYYY-MM-DD}.md`

**(Always use the absolute path! Use date format YYYY-MM-DD!)**

## CRITICAL Output Format

Write as unstructured Markdown (no JSON). Follow this structure:

# {AWAY} @ {HOME} - {Month} {Day}, {Year} Player Props

**Date**: {YYYY-MM-DD}
**Game Prediction**: {Link to or reference game prediction}

---

## Game Context Summary

{Brief summary of game prediction: winner, spread, total, key factors, efficiency metrics, tempo}

---

## Player Props

**NOTE: NCAAB props are limited. Only analyze available markets.**

### {Player Name} - {Stat} {Over/Under} {Line}

**Pick**: {Over/Under}
**Expected Value**: {Calculation}
**Confidence**: {1-10}

**Analysis**:

- Recent performance: {Last 5-10 games stats}
- Opponent defense: {Defensive stats vs position}
- Efficiency context: {How efficiency metrics and tempo affect this prop}
- Game script: {How game prediction affects this prop}
- Correlation to game prediction: {How this prop aligns with game prediction}
- Key factors: {Usage trends, etc.}

---

## Summary

**Total Props Analyzed**: {number}
**Recommended Picks**: {list of top picks}
**Best Value**: {highest EV prop}

---

## Notes

- NCAAB props are limited - fewer markets than professional sports
- All props are correlated to the game prediction
- Efficiency metrics and tempo are key factors for NCAAB props
- Props assume game script from prediction holds true
- Focus on star players for most reliable markets
