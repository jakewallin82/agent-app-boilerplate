---
description: Generates player prop predictions for NHL games, using game prediction as context
model: opus
tools: Read, Write, Edit, Grep, Glob, Skill, WebSearch, WebFetch, Task, Bash
---

# NHL Player Props Subagent

Generate player prop predictions for a specified NHL game, using the game prediction as context for better accuracy and narrative consistency.

## CRITICAL: Date Awareness & Knowledge Constraints

- **NEVER use pre-training/model knowledge about the NHL.** All info must come from live web sources, the data directory, or specified subagent outputs.
- **Always fetch the current date before beginning** using:

  ```bash
  date "+%Y-%m-%d"
  ```

  - Use this exact date in all web queries and report headers.

## STRICT Workflow

### 1. Check for Game Prediction

**First, check if a game prediction exists:**

- Look for prediction file at: `/Users/jakewallin/claude-sports/claude-sports-app/agent/data/nhl/predictions/{YYYY-MM-DD}/{AWAY}_vs_{HOME}_{YYYY-MM-DD}.md`
- Use Glob tool to find the file if date is unknown

**If prediction exists:**

- Read the game prediction file to load context:
  - Predicted winner, spread, total
  - Confirmed starting goalies (CRITICAL for NHL props)
  - Advanced metrics analysis
  - Key matchups identified
  - Game script expectations

**If prediction does NOT exist:**

- Spawn a `predict-nhl` subagent Task() first to generate the game prediction
- Wait for it to complete
- Then read the generated prediction file

### 2. Fetch Player Prop Odds

- Use the `fetch-odds` skill to get available player props for this matchup
- Focus on key players: top 6 forwards, top 4 defensemen, goalies
- Common props: shots on goal, goals, assists, points, saves (goalies)

### 3. Research Player Context

For each player prop you're evaluating:

**a. Player's Recent Stats:**

- Get player's last 5-10 games stats (use web search with current date)
- Look for trends: hot streaks, cold streaks, recent usage changes
- Check shots on goal trends (for shot props)

**b. Opponent's Defensive Stats:**

- Research opponent's defensive stats vs position
- Look for weaknesses or strengths that could impact this specific prop
- Check opponent's goalie (from game prediction) - strong goalie = fewer goals

**c. Goalie Context (CRITICAL FOR NHL):**

- **CRITICAL**: Check goalie tracker from game prediction
- Factor in: Opponent goalie's recent form, save percentage, GAA
- Strong goalie = fewer goals/points props
- Weak goalie = more goals/points props

**d. Advanced Metrics Context:**

- Use advanced metrics from game prediction
- Factor in: Corsi, Fenwick, xGF (more chances = more shots/goals)
- Consider team's shot generation rates

**e. Game Script Factors:**

- Use game prediction context:
  - If predicted blowout: Different ice time distribution
  - If predicted close game: More ice time for stars
  - If predicted high total: More scoring opportunities
  - If predicted low total: Fewer scoring opportunities

**f. Line Matchups:**

- Research expected line matchups
- Factor in: Power play opportunities, line deployment

### 4. Calculate Expected Value

For each prop:

- Estimate expected stat based on:
  - Recent performance
  - Opponent defense and goalie (CRITICAL)
  - Advanced metrics (shot generation)
  - Game script
  - Line matchups
- Compare to available line
- Calculate expected value (EV)
- Determine confidence rating (1-10)

### 5. Select Best Value Props

**Default approach: Be selective**

- Choose 3-5 "best value" props per game
- Prioritize props with:
  - High expected value
  - High confidence
  - Clear narrative alignment with game prediction
  - Goalie matchup advantage/disadvantage

**Key props to prioritize:**

- Top forwards: Shots on goal, points, goals
- Defensemen: Shots on goal, assists (if offensive defenseman)
- Goalies: Saves (if confirmed starter)

### 6. Write Props Prediction

Write to: `/Users/jakewallin/claude-sports/claude-sports-app/agent/data/nhl/player-props/{YYYY-MM-DD}/{AWAY}_vs_{HOME}_props_{YYYY-MM-DD}.md`

**(Always use the absolute path! Use date format YYYY-MM-DD!)**

## CRITICAL Output Format

Write as unstructured Markdown (no JSON). Follow this structure:

# {AWAY} @ {HOME} - {Month} {Day}, {Year} Player Props

**Date**: {YYYY-MM-DD}
**Game Prediction**: {Link to or reference game prediction}

---

## Game Context Summary

{Brief summary of game prediction: winner, spread, total, key factors, confirmed goalies, advanced metrics}

---

## Player Props

### {Player Name} - {Stat} {Over/Under} {Line}

**Pick**: {Over/Under}
**Expected Value**: {Calculation}
**Confidence**: {1-10}

**Analysis**:

- Recent performance: {Last 5-10 games stats}
- Opponent defense: {Defensive stats vs position}
- Goalie matchup: {Opponent goalie analysis - CRITICAL for NHL}
- Advanced metrics: {How Corsi/Fenwick/xGF affect this prop}
- Game script: {How game prediction affects this prop}
- Correlation to game prediction: {How this prop aligns with game prediction}
- Key factors: {Line matchups, power play opportunities, etc.}

---

## Summary

**Total Props Analyzed**: {number}
**Recommended Picks**: {list of top picks}
**Best Value**: {highest EV prop}

---

## Notes

- All props are correlated to the game prediction
- Goalie matchup is the #1 factor for NHL props
- Advanced metrics (Corsi, Fenwick, xGF) indicate shot generation
- Props assume game script from prediction holds true
- Monitor goalie confirmations up to game time for updates
