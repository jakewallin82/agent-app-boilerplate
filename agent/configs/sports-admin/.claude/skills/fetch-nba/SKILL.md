---
name: fetch-nba
description: Fetches NBA game odds and player props from The Odds API
allowed-tools: Bash, Read, Write
---

# Fetch NBA Odds

Fetches current betting odds for NBA games including player props.

## Usage

### Game Odds (Spread, Total, Moneyline)

```bash
# All games
python {baseDir}/scripts/nba_odds_api.py games

# Specific game (by team name)
python {baseDir}/scripts/nba_odds_api.py games --game "Lakers"
```

### Player Props

```bash
# All props for all games
python {baseDir}/scripts/nba_odds_api.py props

# Props for a specific game
python {baseDir}/scripts/nba_odds_api.py props --game "Lakers"

# Props by category
python {baseDir}/scripts/nba_odds_api.py props --game "Lakers" --category scoring
```

### Single Player Lookup

```bash
# Get specific player prop
python {baseDir}/scripts/nba_odds_api.py prop --market player_points --player "LeBron James"

# With specific bookmaker
python {baseDir}/scripts/nba_odds_api.py prop --market player_points --player "LeBron James" --book fanduel
```

## Available Markets

### Game Markets
- `h2h` - Moneyline
- `spreads` - Point spread
- `totals` - Over/Under total points

### Player Prop Markets

**Scoring**
- `player_points` - Total points (O/U)
- `player_points_q1` - First quarter points (O/U)

**Combos**
- `player_points_rebounds_assists` - Points + Rebounds + Assists (O/U)
- `player_points_rebounds` - Points + Rebounds (O/U)
- `player_points_assists` - Points + Assists (O/U)

**Rebounds**
- `player_rebounds` - Total rebounds (O/U)

**Assists**
- `player_assists` - Total assists (O/U)

**Defense**
- `player_blocks` - Blocks (O/U)
- `player_steals` - Steals (O/U)

**Threes**
- `player_threes` - Three-pointers made (O/U)

**Achievements**
- `player_double_double` - Double-double (Yes odds)
- `player_triple_double` - Triple-double (Yes odds)
- `player_first_basket` - First basket scorer (Yes odds)

## Output Format

Output is optimized for minimal tokens:

```
## Los Angeles Lakers @ Boston Celtics
ML: Los Angeles Lakers +150, Boston Celtics -175
Spread: Los Angeles Lakers +4.5 (-110), Boston Celtics -4.5 (-110)
Total: 226.5 (O -110, U -110)

## Los Angeles Lakers @ Boston Celtics - Player Props
Source: DraftKings

### player_points
- LeBron James: O 25.5 -115, U 25.5 -110
- Jayson Tatum: O 28.5 -110, U 28.5 -115

### player_points_rebounds_assists
- LeBron James: O 45.5 -110, U 45.5 -115
- Jayson Tatum: O 42.5 -115, U 42.5 -110

### player_double_double
- LeBron James: Yes -125
- Jayson Tatum: Yes +140
```

## Requirements

- `ODDS_API_KEY` environment variable set in `/Users/jakewallin/claude-sports/claude-sports-app/agent/.env`
- Python dependencies: httpx, python-dotenv

## Prop Categories

Use `--category` flag to filter props:
- `scoring` - Points and Q1 points
- `combos` - Combined stat lines (PRA, PR, PA)
- `rebounds` - Rebounding stats
- `assists` - Assist stats
- `defense` - Blocks and steals
- `threes` - Three-point shooting
- `achievements` - Double-double, triple-double, first basket
