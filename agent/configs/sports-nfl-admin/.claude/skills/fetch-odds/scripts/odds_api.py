#!/usr/bin/env python3
"""
NFL Odds Fetcher - Retrieves current betting odds from The Odds API

Usage:
    python odds_api.py

Output:
    - Writes formatted odds to data/odds/current_odds.md
    - Prints odds to stdout for agent visibility

Requirements:
    - ODDS_API_KEY environment variable (loaded from agent/.env)
    - httpx: async HTTP client
    - python-dotenv: environment variable loading
"""

import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv


def load_environment() -> str:
    """Load environment variables and return API key."""
    # Load from agent/.env (scripts -> fetch-odds -> skills -> .claude -> agent)
    env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
    load_dotenv(env_path)

    api_key = os.getenv("ODDS_API_KEY")
    if not api_key:
        print("ERROR: ODDS_API_KEY not found in environment variables", file=sys.stderr)
        print(f"Please set ODDS_API_KEY in {env_path}", file=sys.stderr)
        sys.exit(1)

    return api_key


def format_american_odds(odds: int) -> str:
    """Format American odds with proper sign."""
    if odds > 0:
        return f"+{odds}"
    return str(odds)


def parse_bookmaker_odds(game: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract odds from the first available bookmaker."""
    bookmakers = game.get("bookmakers", [])
    if not bookmakers:
        return None

    # Use the first bookmaker (usually the most popular/reliable)
    bookmaker = bookmakers[0]
    markets = bookmaker.get("markets", [])

    odds_data = {
        "bookmaker": bookmaker.get("title", "Unknown"),
        "spread": None,
        "total": None,
        "moneyline": None
    }

    for market in markets:
        market_key = market.get("key")
        outcomes = market.get("outcomes", [])

        if market_key == "h2h":  # Moneyline
            odds_data["moneyline"] = {
                outcome["name"]: format_american_odds(outcome["price"])
                for outcome in outcomes
            }

        elif market_key == "spreads":  # Point spread
            for outcome in outcomes:
                if outcome.get("point"):  # This is the favorite
                    odds_data["spread"] = {
                        "team": outcome["name"],
                        "line": outcome["point"],
                        "price": format_american_odds(outcome["price"]),
                        "other_team": next(
                            (o["name"] for o in outcomes if o["name"] != outcome["name"]),
                            "Unknown"
                        )
                    }
                    break

        elif market_key == "totals":  # Over/Under
            over_outcome = next((o for o in outcomes if o["name"] == "Over"), None)
            under_outcome = next((o for o in outcomes if o["name"] == "Under"), None)

            if over_outcome and under_outcome:
                odds_data["total"] = {
                    "line": over_outcome.get("point"),
                    "over_price": format_american_odds(over_outcome["price"]),
                    "under_price": format_american_odds(under_outcome["price"])
                }

    return odds_data


def format_game_markdown(game: Dict[str, Any], odds: Optional[Dict[str, Any]]) -> str:
    """Format a single game's odds as markdown."""
    away_team = game.get("away_team", "Unknown")
    home_team = game.get("home_team", "Unknown")
    commence_time = game.get("commence_time", "")

    # Format game time
    if commence_time:
        try:
            dt = datetime.fromisoformat(commence_time.replace("Z", "+00:00"))
            game_time = dt.strftime("%A, %B %d at %I:%M %p %Z")
        except Exception:
            game_time = commence_time
    else:
        game_time = "Time TBD"

    lines = [
        f"## {away_team} @ {home_team}",
        ""
    ]

    if not odds:
        lines.append("*Odds not available*")
        lines.append("")
        return "\n".join(lines)

    # Spread
    if odds.get("spread"):
        spread = odds["spread"]
        line_value = spread["line"]
        if line_value > 0:
            lines.append(f"- **Spread**: {spread['other_team']} {line_value:+.1f} ({spread['price']})")
        else:
            lines.append(f"- **Spread**: {spread['team']} {line_value:+.1f} ({spread['price']})")
    else:
        lines.append("- **Spread**: N/A")

    # Total
    if odds.get("total"):
        total = odds["total"]
        lines.append(
            f"- **Total**: {total['line']} "
            f"(O: {total['over_price']} / U: {total['under_price']})"
        )
    else:
        lines.append("- **Total**: N/A")

    # Moneyline
    if odds.get("moneyline"):
        ml = odds["moneyline"]
        away_ml = ml.get(away_team, "N/A")
        home_ml = ml.get(home_team, "N/A")
        lines.append(f"- **Moneyline**: {away_team} {away_ml} / {home_team} {home_ml}")
    else:
        lines.append("- **Moneyline**: N/A")

    lines.append(f"- **Game Time**: {game_time}")
    lines.append(f"- **Source**: {odds.get('bookmaker', 'Unknown')}")
    lines.append("")

    return "\n".join(lines)


async def fetch_nfl_odds(api_key: str) -> List[Dict[str, Any]]:
    """Fetch NFL odds from The Odds API."""
    base_url = "https://api.the-odds-api.com"
    endpoint = "/v4/sports/americanfootball_nfl/odds"

    params = {
        "apiKey": api_key,
        "regions": "us",
        "markets": "h2h,spreads,totals",
        "oddsFormat": "american",
        "dateFormat": "iso"
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(f"{base_url}{endpoint}", params=params)
            response.raise_for_status()

            # Check remaining API calls
            remaining = response.headers.get("x-requests-remaining")
            if remaining:
                print(f"API calls remaining: {remaining}", file=sys.stderr)

            return response.json()

        except httpx.HTTPStatusError as e:
            print(f"HTTP error occurred: {e}", file=sys.stderr)
            print(f"Response: {e.response.text}", file=sys.stderr)
            sys.exit(1)

        except httpx.RequestError as e:
            print(f"Request error occurred: {e}", file=sys.stderr)
            sys.exit(1)


def generate_markdown_report(games: List[Dict[str, Any]]) -> str:
    """Generate full markdown report from games data."""
    timestamp = datetime.now().strftime("%Y-%m-%d %I:%M %p")

    lines = [
        f"# NFL Odds - {timestamp}",
        "",
        f"*Fetched from The Odds API*",
        f"*Total games: {len(games)}*",
        ""
    ]

    if not games:
        lines.append("No games currently available.")
        return "\n".join(lines)

    for game in games:
        odds = parse_bookmaker_odds(game)
        lines.append(format_game_markdown(game, odds))

    return "\n".join(lines)


def write_output(content: str, output_path: Path) -> None:
    """Write markdown content to file."""
    # Ensure directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write to file
    output_path.write_text(content)
    print(f"Odds written to: {output_path}", file=sys.stderr)


async def main():
    """Main execution function."""
    # Load API key
    api_key = load_environment()

    # Fetch odds
    print("Fetching NFL odds...", file=sys.stderr)
    games = await fetch_nfl_odds(api_key)

    # Generate markdown report
    markdown_content = generate_markdown_report(games)

    # Determine output path (scripts -> fetch-odds -> skills -> .claude -> agent)
    script_dir = Path(__file__).parent
    output_path = script_dir.parent.parent.parent.parent / "data" / "odds" / "current_odds.md"

    # Write to file
    write_output(markdown_content, output_path)

    # Print to stdout for agent
    print("\n" + "="*60)
    print(markdown_content)
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main())
