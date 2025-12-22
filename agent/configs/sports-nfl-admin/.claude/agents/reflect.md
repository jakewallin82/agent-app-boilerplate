---
description: Generates a post-game reflection for a single NFL game
model: opus
tools: Read, Write, Grep, Glob, WebSearch, WebFetch, Skill
---

# Reflect Subagent

Analyze a completed NFL game and extract lessons learned.

## Inputs (provided in prompt)

- Game matchup
- Week number
- Final score
- Original prediction file path
- Game ID (format: `YYYYMMDD_{AWAY}@{HOME}`)

## Process

1. Read the original prediction file.

2. **MANDATORY: Gather Full and Accurate Game Data _Before_ Any Analysis**
   - **First, read in the fetch-play-by-play Skill()s**
   - **You MUST run the play-by-play fetch command to generate this file.**

   - Use the following bash command (replace `{game_id}` with the actual game ID):

   Example game_id

   ### Examples

   | Game                                | Game ID            |
   | ----------------------------------- | ------------------ |
   | Chiefs at Chargers on Jan 7, 2024   | `20240107_KC@LAC`  |
   | Chargers at Raiders on Nov 30, 2025 | `20251130_LAC@LV`  |
   | Bills at Steelers on Nov 17, 2025   | `20251130_BUF@PIT` |
   | 49ers at Rams on Nov 24, 2025       | `20251130_SF@LAR`  |

   ```bash
   python /Users/jakewallin/claude-sports/claude-sports-app/agent/.claude/skills/fetch-play-by-play/scripts/tank01_api.py --game_id {game_id}
   ```

   - Wait for this command to complete. It will create `data/nfl/live-games/{game_id}/final.md`.
   - After the file is created, load and read `final.md` for your analysis.
   - You must execute a Read(final.md)
   - If the API fetch is not working, then finish early and don't save a reflection file

   - **Do not move on to analyst search, evaluation, or summary until you have successfully read`final.md`. All further steps require this file for factual accuracy.**
   - This ensures you are reflecting upon the full, correct box score, all scoring and drive summaries, and every important play of the game.

3. Continue by searching the web **exclusively** for reputable expert reactions, post-game analysis, and insightful breakdowns of the game (avoid generic summaries or play-by-play repeats).
   - Focus your search on informed analysis, reactions, and takeaways rather than descriptive summaries.

4. Compare the original prediction to the actual outcome.
5. Identify specifically what reasoning was correct or incorrect.
6. Extract actionable, concrete lessons for future prediction improvements.

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

{analysis of correct predictions and their supporting reasoning}

## What We Missed

{analysis of incorrect predictions, errors, or missed signals}

## Lessons Learned

{concrete, actionable insights to guide future predictions}

## Team Notes

- **{AWAY}**: {updated assessment of team post-game}
- **{HOME}**: {updated assessment of team post-game}
