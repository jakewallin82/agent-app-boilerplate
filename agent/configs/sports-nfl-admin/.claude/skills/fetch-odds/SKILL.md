---
name: fetch-odds
description: Fetches current NFL betting odds from The Odds API
allowed-tools: Bash, Read, Write
---

# Fetch Odds

Fetches current betting odds for NFL games.

## Usage

```bash
python {baseDir}/scripts/odds_api.py
```

## Output

Saves odds data to `data/odds/current_odds.md` in readable format:

```markdown
# NFL Odds - {timestamp}

## {AWAY} @ {HOME}

- **Spread**: {favorite} {line} ({price})
- **Total**: {over_under} ({over_price} / {under_price})
- **Moneyline**: {away_ml} / {home_ml}
- **Game Time**: {datetime}

...
```

## Requirements

- ODDS_API_KEY environment variable must be set in `/Users/jakewallin/claude-sports/claude-sports-app/agent/.env`
- Python dependencies: httpx, python-dotenv

## Notes

- The script fetches odds from The Odds API for americanfootball_nfl sport
- Uses US markets with American odds format
- Fetches spreads, totals (over/under), and moneylines
- Output is written to both file and stdout for agent visibility
