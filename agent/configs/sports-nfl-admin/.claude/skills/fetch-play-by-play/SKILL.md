---
name: fetch-play-by-play
description: Fetches live play-by-play data from Tank01 API
allowed-tools: Bash, Read, Write
---

# Fetch Play-by-Play

Fetches current play-by-play for a live NFL game.

## Game ID Format

Game IDs follow a strict format: `YYYYMMDD_{AWAY_TEAM}@{HOME_TEAM}`

- `YYYYMMDD` - The date of the game (4-digit year, 2-digit month, 2-digit day)
- `{AWAY_TEAM}` - The road/away team's abbreviation (e.g., KC, BUF, SF)
- `@` - Literal @ symbol separating teams
- `{HOME_TEAM}` - The home team's abbreviation

### Examples

| Game                                | Game ID            |
| ----------------------------------- | ------------------ |
| Chiefs at Chargers on Jan 7, 2024   | `20240107_KC@LAC`  |
| Chargers at Raiders on Nov 30, 2025 | `20251130_LAC@LV`  |
| Bills at Steelers on Nov 17, 2025   | `20251130_BUF@PIT` |
| 49ers at Rams on Nov 24, 2025       | `20251130_SF@LAR`  |

## Usage

### Fetch Play-by-Play (requires known game ID)

```bash
python {baseDir}/scripts/tank01_api.py --game_id {game_id}
```

### Discover Game IDs for a Date

If you don't know the exact game ID (e.g., user says "track the Bills game" but doesn't specify opponent), use the scores-only endpoint to discover all games on a given date:

```bash
python {baseDir}/scripts/get_scores.py --date YYYYMMDD
```

This returns all games for that date with their game IDs, scores, and status.

## Discovering Unknown Game IDs

When the user requests a game but doesn't provide the full game ID:

1. **Spawn a subagent** to call `get_scores.py` with the game date
2. The subagent should parse the response to find the matching game
3. Return the proper game ID in format `YYYYMMDD_{AWAY}@{HOME}`

Example scenario:

- User: "Track the Bills game today"
- Agent doesn't know if Bills are home or away, or who they're playing
- Spawn subagent → calls `get_scores.py --date 20251130`
- Subagent finds: `{"gameID": "20251130_BUF@PIT", "away": "BUF", "home": "PIT"}`
- Returns: `20251130_BUF@PIT`

## Output

Saves play-by-play data to one of two files depending on game status:

- **Live games**: `data/live-games/{game_id}/current_state.md`
- **Completed games**: `data/live-games/{game_id}/final.md`

The script automatically detects if a game is finished (based on `gameStatus`, `quarter`, or `period` fields in the API response) and saves to `final.md` instead of `current_state.md` when the game is over.

### File Format

Both files use the same markdown format:

```markdown
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

## Setup

1. **Install Dependencies**:

   ```bash
   pip install requests python-dotenv
   ```

2. **Configure API Key**:
   Create a `.env` file in the agent root directory (`/Users/jakewallin/claude-sports/claude-sports-app/agent/.env`):

   ```bash
   TANK01_API_KEY=your_api_key_here
   ```

   Get an API key from [RapidAPI - Tank01 NFL API](https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl)

## Script Features

### tank01_api.py (Play-by-Play)

- Loads API key from `.env` file automatically
- Creates output directories as needed
- Formats data into readable markdown
- Handles API errors gracefully
- Includes timestamps for freshness
- Prints output to stdout for agent visibility
- Supports `--debug` mode for troubleshooting
- **Automatically saves to `final.md` when game is over** (detects game status from API response)

### get_scores.py (Discover Game IDs)

- Lists all games for a given date
- Finds specific team's game with `--team` flag
- Supports `--json` output for programmatic use
- Shows whether team is home or away

#### get_scores.py Examples

List all games:

```bash
python {baseDir}/scripts/get_scores.py --date 20251130
```

Find a specific team's game:

```bash
python {baseDir}/scripts/get_scores.py --date 20251130 --team BUF
```

Output:

```
Found game for BUF:
  Game ID: 20251130_BUF@PIT
  Matchup: BUF @ PIT
  Score: BUF 0 - PIT 0
  Status: Scheduled
  BUF is AWAY
```

JSON output:

```bash
python {baseDir}/scripts/get_scores.py --date 20251130 --team BUF --json
```

## Error Handling

Scripts exit with error messages if:

- API key is not configured
- Network request fails
- Invalid game ID or date provided
- API response cannot be parsed

All error messages go to stderr to avoid polluting stdout.

## API Details

### getNFLBoxScore (Play-by-Play)

- Base URL: https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLBoxScore
- Headers:
  - x-rapidapi-key: {TANK01_API_KEY}
  - x-rapidapi-host: tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com
- Parameters:
  - gameID: {game_id}
  - playByPlay: true

### getNFLScoresOnly (Discover Game IDs)

Use this endpoint to find all games on a specific date and their game IDs:

- Base URL: https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLScoresOnly
- Headers:
  - x-rapidapi-key: {TANK01_API_KEY}
  - x-rapidapi-host: tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com
- Parameters:
  - gameDate: YYYYMMDD (e.g., "20251130")
  - topPerformers: "true" (optional, includes top performers)

Returns a list of all games for that date with:

- gameID (the full game ID you need)
- away/home team abbreviations
- current scores
- game status (scheduled, in progress, final)
