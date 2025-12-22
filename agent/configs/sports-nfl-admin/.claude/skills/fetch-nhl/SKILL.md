---
name: fetch-nhl
description: Fetches NHL game odds and player props from The Odds API
allowed-tools: Bash, Read, Write
---

# Fetch NHL Odds

Fetches current betting odds for NHL games including player props.

## Usage

### Game Odds (Spread, Total, Moneyline)

```bash
# All games
python {baseDir}/scripts/nhl_odds_api.py games

# Specific game (by team name)
python {baseDir}/scripts/nhl_odds_api.py games --game "Maple Leafs"
```

### Player Props

```bash
# All props for all games
python {baseDir}/scripts/nhl_odds_api.py props

# Props for a specific game
python {baseDir}/scripts/nhl_odds_api.py props --game "Maple Leafs"

# Props by category
python {baseDir}/scripts/nhl_odds_api.py props --game "Maple Leafs" --category scoring
```

### Single Player Lookup

```bash
# Get specific player prop
python {baseDir}/scripts/nhl_odds_api.py prop --market player_points --player "Auston Matthews"

# With specific bookmaker
python {baseDir}/scripts/nhl_odds_api.py prop --market player_points --player "Auston Matthews" --book fanduel
```

## Available Markets

### Game Markets
- `h2h` - Moneyline
- `spreads` - Puck line (typically 1.5 goals)
- `totals` - Over/Under total goals

### Player Prop Markets

**Scoring**
- `player_points` - Total points (goals + assists) (O/U)
- `player_goals` - Goals scored (O/U)
- `player_assists` - Assists (O/U)

**Performance**
- `player_shots_on_goal` - Shots on goal (O/U)
- `player_blocked_shots` - Blocked shots (O/U)
- `player_power_play_points` - Power play points (O/U)

**Goalie**
- `player_total_saves` - Total saves (O/U)

**Goal Scorer**
- `player_goal_scorer_first` - First goal scorer (Yes odds)
- `player_goal_scorer_anytime` - Anytime goal scorer (Yes odds)
- `player_goal_scorer_last` - Last goal scorer (Yes odds)

## Output Format

Output is optimized for minimal tokens:

```
## Toronto Maple Leafs @ Boston Bruins
ML: Toronto Maple Leafs -120, Boston Bruins +105
Spread: Toronto Maple Leafs -1.5 (+180), Boston Bruins +1.5 (-220)
Total: 6.5 (O -110, U -110)

## Toronto Maple Leafs @ Boston Bruins - Player Props
Source: DraftKings

### player_points
- Auston Matthews: O 1.5 -115, U 1.5 -110
- David Pastrnak: O 1.5 -105, U 1.5 -120

### player_goal_scorer_anytime
- Auston Matthews: Yes -125
- David Pastrnak: Yes +140
```

## Requirements

- `ODDS_API_KEY` environment variable set in `/Users/jakewallin/claude-sports/claude-sports-app/agent/.env`
- Python dependencies: httpx, python-dotenv

## Prop Categories

Use `--category` flag to filter props:
- `scoring` - Points, goals, assists
- `performance` - Shots on goal, blocked shots, power play points
- `goalie` - Goaltender save totals
- `goal_scorer` - Goal scorer props (first, anytime, last)
