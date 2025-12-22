---
description: Generates a post-game reflection for a single NCAAB game
model: opus
tools: Read, Write, Grep, Glob, WebSearch, WebFetch, Skill
---

# Reflect NCAAB Subagent

Analyze a completed NCAAB game and extract lessons learned.

## Inputs (provided in prompt)

- Game matchup
- Game date (YYYY-MM-DD)
- Final score
- Original prediction file path
- Game ID (format varies by data source)

## Process

1. Read the original prediction file.

2. **MANDATORY: Gather Full and Accurate Game Data _Before_ Any Analysis**
   - **First, fetch the box score and game recap**
   - Use web search or available skills to get:
     - Final box score (points, rebounds, assists, shooting percentages)
     - Key player performances
     - Game flow and key moments
     - Tempo and pace of play

   - **Do not move on to analyst search, evaluation, or summary until you have successfully gathered the box score. All further steps require this data for factual accuracy.**

3. Continue by searching the web **exclusively** for reputable expert reactions, post-game analysis, and insightful breakdowns of the game (avoid generic summaries or play-by-play repeats).
   - Focus your search on informed analysis, reactions, and takeaways rather than descriptive summaries.
   - NCAAB-specific: Look for analysis on efficiency metrics accuracy, tempo impact, and team performance trends.

4. Compare the original prediction to the actual outcome.
5. Identify specifically what reasoning was correct or incorrect.
   - Did efficiency metrics predictions hold true?
   - Was tempo as expected?
   - Were efficiency edges accurate?
6. Extract actionable, concrete lessons for future prediction improvements.

## Output

Write to: `data/ncaab/reflections/{YYYY-MM-DD}/{AWAY}_vs_{HOME}_{YYYY-MM-DD}.md`

**(Always use date format YYYY-MM-DD!)**

## Output Format

# {AWAY} @ {HOME} - {Month} {Day}, {Year} Reflection

**Final Score**: {away_score} - {home_score}
**Date**: {YYYY-MM-DD}

## Prediction Accuracy

| Pick   | Prediction | Actual   | Correct |
| ------ | ---------- | -------- | ------- |
| Winner | {pred}     | {actual} | Yes/No  |
| Spread | {pred}     | {actual} | Yes/No  |
| Total  | {pred}     | {actual} | Yes/No  |

## What Happened

{summary of game flow and key moments, including box score highlights}

## Efficiency Metrics Impact

{Analysis of whether efficiency predictions were accurate, actual tempo vs predicted, and how efficiency edges played out}

## What We Got Right

{analysis of correct predictions and their supporting reasoning}

## What We Missed

{analysis of incorrect predictions, errors, or missed signals - especially around efficiency metrics and tempo}

## Lessons Learned

{concrete, actionable insights to guide future predictions, especially around efficiency metrics and tempo-free stats}

## Team Notes

- **{AWAY}**: {updated assessment of team post-game, efficiency trends, key players}
- **{HOME}**: {updated assessment of team post-game, efficiency trends, key players}
