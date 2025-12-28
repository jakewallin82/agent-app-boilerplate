#!/usr/bin/env python3
"""
Tank01 NFL API - Get Scores Only

Fetches all NFL games for a given date to discover game IDs.
Use this when you need to find the game ID for a specific team's game.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime

try:
    import requests
except ImportError:
    print("Error: requests library not installed. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("Error: python-dotenv library not installed. Install with: pip install python-dotenv", file=sys.stderr)
    sys.exit(1)


def load_api_key():
    """Load API key from environment or .env file."""
    script_dir = Path(__file__).parent
    agent_dir = script_dir.parent.parent.parent.parent
    env_path = agent_dir / ".env"

    if env_path.exists():
        load_dotenv(env_path)
        print(f"Loaded .env from: {env_path}", file=sys.stderr)
    else:
        load_dotenv()

    api_key = os.getenv("TANK01_API_KEY")
    if not api_key:
        print(f"Error: TANK01_API_KEY not found in environment variables.", file=sys.stderr)
        print(f"Please create a .env file at {env_path} with:", file=sys.stderr)
        print(f"TANK01_API_KEY=your_api_key_here", file=sys.stderr)
        sys.exit(1)

    return api_key


def fetch_scores(game_date, api_key, top_performers=True):
    """
    Fetch all NFL scores for a given date.

    Args:
        game_date: Date in YYYYMMDD format (e.g., "20251130")
        api_key: Tank01 RapidAPI key
        top_performers: Include top performers in response

    Returns:
        dict: API response with all games for that date
    """
    url = "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLScoresOnly"

    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com"
    }

    params = {
        "gameDate": game_date,
        "topPerformers": "true" if top_performers else "false"
    }

    try:
        print(f"Fetching scores for date: {game_date}...", file=sys.stderr)
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from API: {e}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error parsing API response: {e}", file=sys.stderr)
        sys.exit(1)


def format_games_summary(data):
    """Format the API response into a readable summary."""
    body = data.get("body", {})

    if not body:
        return "No games found for this date."

    lines = []
    lines.append("# NFL Games\n")

    for game_id, game_data in body.items():
        away = game_data.get("away", "???")
        home = game_data.get("home", "???")
        away_pts = game_data.get("awayPts", "0")
        home_pts = game_data.get("homePts", "0")
        game_status = game_data.get("gameStatus", "Unknown")
        game_time = game_data.get("gameTime", "")

        lines.append(f"## {away} @ {home}")
        lines.append(f"- **Game ID**: `{game_id}`")
        lines.append(f"- **Score**: {away} {away_pts} - {home} {home_pts}")
        lines.append(f"- **Status**: {game_status}")
        if game_time:
            lines.append(f"- **Game Time**: {game_time}")
        lines.append("")

    return "\n".join(lines)


def find_team_game(data, team_abbr):
    """
    Find the game ID for a specific team.

    Args:
        data: API response data
        team_abbr: Team abbreviation (e.g., "BUF", "KC")

    Returns:
        dict: Game info if found, None otherwise
    """
    body = data.get("body", {})
    team_abbr = team_abbr.upper()

    for game_id, game_data in body.items():
        away = game_data.get("away", "").upper()
        home = game_data.get("home", "").upper()

        if team_abbr in (away, home):
            return {
                "gameID": game_id,
                "away": away,
                "home": home,
                "awayPts": game_data.get("awayPts", "0"),
                "homePts": game_data.get("homePts", "0"),
                "gameStatus": game_data.get("gameStatus", "Unknown"),
                "isHome": team_abbr == home
            }

    return None


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Fetch NFL scores for a date to discover game IDs"
    )
    parser.add_argument(
        "--date",
        required=True,
        help="Game date in YYYYMMDD format (e.g., 20251130)"
    )
    parser.add_argument(
        "--team",
        help="Optional: Find game for specific team (e.g., BUF, KC)"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON instead of formatted markdown"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Print raw API response for debugging"
    )

    args = parser.parse_args()

    # Validate date format
    if len(args.date) != 8 or not args.date.isdigit():
        print("Error: Date must be in YYYYMMDD format (e.g., 20251130)", file=sys.stderr)
        sys.exit(1)

    # Load API key
    api_key = load_api_key()

    # Fetch data
    data = fetch_scores(args.date, api_key)

    # Debug output
    if args.debug:
        print("=== RAW API RESPONSE ===", file=sys.stderr)
        print(json.dumps(data, indent=2), file=sys.stderr)
        print("=" * 50, file=sys.stderr)

    # If looking for a specific team
    if args.team:
        game_info = find_team_game(data, args.team)
        if game_info:
            if args.json:
                print(json.dumps(game_info, indent=2))
            else:
                print(f"\nFound game for {args.team.upper()}:")
                print(f"  Game ID: {game_info['gameID']}")
                print(f"  Matchup: {game_info['away']} @ {game_info['home']}")
                print(f"  Score: {game_info['away']} {game_info['awayPts']} - {game_info['home']} {game_info['homePts']}")
                print(f"  Status: {game_info['gameStatus']}")
                print(f"  {args.team.upper()} is {'HOME' if game_info['isHome'] else 'AWAY'}")
        else:
            print(f"No game found for team: {args.team.upper()}", file=sys.stderr)
            sys.exit(1)
    else:
        # Output all games
        if args.json:
            print(json.dumps(data, indent=2))
        else:
            print(format_games_summary(data))

    print(f"\nSuccess!", file=sys.stderr)


if __name__ == "__main__":
    main()
