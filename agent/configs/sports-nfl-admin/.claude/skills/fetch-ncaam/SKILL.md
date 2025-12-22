---
name: fetch-ncaam
description: Fetches NCAAM (college basketball) game odds and player props from The Odds API
allowed-tools: Bash, Read, Write
---

# Fetch NCAAM Odds

Fetches current betting odds for NCAA Men's Basketball games including player props.

## Usage

### Game Odds (Spread, Total, Moneyline)

```bash
# All games
python {baseDir}/scripts/ncaam_odds_api.py games

# Specific game (by team name)
python {baseDir}/scripts/ncaam_odds_api.py games --game "Duke"
```

### Player Props

```bash
# All props for all games
python {baseDir}/scripts/ncaam_odds_api.py props

# Props for a specific game
python {baseDir}/scripts/ncaam_odds_api.py props --game "Duke"

# Props by category
python {baseDir}/scripts/ncaam_odds_api.py props --game "Duke" --category scoring
```

### Single Player Lookup

```bash
# Get specific player prop
python {baseDir}/scripts/ncaam_odds_api.py prop --market player_points --player "Cooper Flagg"

# With specific bookmaker
python {baseDir}/scripts/ncaam_odds_api.py prop --market player_points --player "Cooper Flagg" --book fanduel
```

## Available Markets

### Game Markets
- `h2h` - Moneyline
- `spreads` - Point spread
- `totals` - Over/Under total points

### Player Prop Markets

**Scoring**
- `player_points` - Points scored (O/U)

**Combination Stats**
- `player_points_rebounds_assists` - Total PRA (O/U)
- `player_points_rebounds` - Total PR (O/U)
- `player_points_assists` - Total PA (O/U)

**Individual Stats**
- `player_rebounds` - Total rebounds (O/U)
- `player_assists` - Assists (O/U)

**Defense**
- `player_blocks` - Blocks (O/U)
- `player_steals` - Steals (O/U)

**Shooting**
- `player_threes` - Three-pointers made (O/U)

## Output Format

Output is optimized for minimal tokens:

```
## Duke Blue Devils @ North Carolina Tar Heels
ML: Duke Blue Devils -150, North Carolina Tar Heels +130
Spread: Duke Blue Devils -3.0 (-110), North Carolina Tar Heels +3.0 (-110)
Total: 155.5 (O -110, U -110)

## Duke Blue Devils @ North Carolina Tar Heels - Player Props
Source: DraftKings

### player_points
- Cooper Flagg: O 22.5 -115, U 22.5 -110
- RJ Davis: O 18.5 -110, U 18.5 -115

### player_points_rebounds_assists
- Cooper Flagg: O 30.5 -110, U 30.5 -115
- RJ Davis: O 25.5 -115, U 25.5 -110
```

## Requirements

- `ODDS_API_KEY` environment variable set in `/Users/jakewallin/claude-sports/claude-sports-app/agent/.env`
- Python dependencies: httpx, python-dotenv

## Prop Categories

Use `--category` flag to filter props:
- `scoring` - Points
- `combos` - Combined stat lines (PRA, PR, PA)
- `rebounds` - Rebounding stats
- `assists` - Assist stats
- `defense` - Defensive stats (blocks, steals)
- `threes` - Three-point shooting
