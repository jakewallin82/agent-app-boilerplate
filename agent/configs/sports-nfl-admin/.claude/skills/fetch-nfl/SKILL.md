---
name: fetch-nfl
description: Fetches NFL game odds and player props from The Odds API
allowed-tools: Bash, Read, Write
---

# Fetch NFL Odds

Fetches current betting odds for NFL games including player props.

## Usage

### Game Odds (Spread, Total, Moneyline)

```bash
# All games
python {baseDir}/scripts/nfl_odds_api.py games

# Specific game (by team name)
python {baseDir}/scripts/nfl_odds_api.py games --game "Bills"
```

### Player Props

```bash
# All props for all games
python {baseDir}/scripts/nfl_odds_api.py props

# Props for a specific game
python {baseDir}/scripts/nfl_odds_api.py props --game "Bills"

# Props by category
python {baseDir}/scripts/nfl_odds_api.py props --game "Bills" --category passing
```

### Single Player Lookup

```bash
# Get specific player prop
python {baseDir}/scripts/nfl_odds_api.py prop --market player_rush_yds --player "Josh Allen"

# With specific bookmaker
python {baseDir}/scripts/nfl_odds_api.py prop --market player_rush_yds --player "Josh Allen" --book fanduel
```

## Available Markets

### Game Markets
- `h2h` - Moneyline
- `spreads` - Point spread
- `totals` - Over/Under total points

### Player Prop Markets

**Passing**
- `player_pass_yds` - Passing yards (O/U)
- `player_pass_tds` - Passing touchdowns (O/U)
- `player_pass_completions` - Completions (O/U)

**Rushing**
- `player_rush_yds` - Rushing yards (O/U)
- `player_rush_tds` - Rushing touchdowns (O/U)
- `player_rush_attempts` - Rush attempts (O/U)

**Receiving**
- `player_receptions` - Receptions (O/U)
- `player_reception_yds` - Receiving yards (O/U)
- `player_reception_tds` - Receiving touchdowns (O/U)

**Defense**
- `player_sacks` - Sacks (O/U)
- `player_solo_tackles` - Solo tackles (O/U)
- `player_defensive_interceptions` - Interceptions (O/U)

**Touchdown Props**
- `player_anytime_td` - Anytime touchdown scorer (Yes odds)
- `player_1st_td` - First touchdown scorer (Yes odds)
- `player_last_td` - Last touchdown scorer (Yes odds)

## Output Format

Output is optimized for minimal tokens:

```
## Buffalo Bills @ Pittsburgh Steelers
ML: Buffalo Bills -150, Pittsburgh Steelers +130
Spread: Buffalo Bills -3.0 (-110), Pittsburgh Steelers +3.0 (-110)
Total: 44.5 (O -110, U -110)

## Buffalo Bills @ Pittsburgh Steelers - Player Props
Source: DraftKings

### player_rush_yds
- Josh Allen: O 47.5 -115, U 47.5 -110
- James Cook: O 62.5 -110, U 62.5 -115

### player_anytime_td
- Josh Allen: Yes -125
- James Cook: Yes +140
```

## Requirements

- `ODDS_API_KEY` environment variable set in `/Users/jakewallin/claude-sports/claude-sports-app/agent/.env`
- Python dependencies: httpx, python-dotenv

## Prop Categories

Use `--category` flag to filter props:
- `passing` - QB passing stats
- `rushing` - Running backs and rushing stats
- `receiving` - Receiver stats
- `defense` - Defensive player stats
- `touchdown` - TD scorer props
