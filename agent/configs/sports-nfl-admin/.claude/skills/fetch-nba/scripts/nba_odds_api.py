#!/usr/bin/env python3
"""
NBA Odds Fetcher - Retrieves game and player prop odds from The Odds API

Usage:
    # Game odds
    python nba_odds_api.py games

    # All player props for all games
    python nba_odds_api.py props

    # Player props for a specific game (by team name)
    python nba_odds_api.py props --game "Lakers"

    # Specific player prop
    python nba_odds_api.py prop --market player_points --player "LeBron James"

    # Specific player prop with bookmaker
    python nba_odds_api.py prop --market player_points --player "LeBron James" --book fanduel

Available Markets:
    Game: h2h, spreads, totals
    Scoring: player_points, player_points_q1
    Combos: player_points_rebounds_assists, player_points_rebounds, player_points_assists
    Rebounds: player_rebounds
    Assists: player_assists
    Defense: player_blocks, player_steals
    Threes: player_threes
    Achievements: player_double_double, player_triple_double, player_first_basket

Output:
    Minimal token-optimized format for agent consumption
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv


# NBA Market definitions
NBA_GAME_MARKETS = ["h2h", "spreads", "totals"]

NBA_PLAYER_MARKETS = {
    "scoring": ["player_points", "player_points_q1"],
    "combos": ["player_points_rebounds_assists", "player_points_rebounds", "player_points_assists"],
    "rebounds": ["player_rebounds"],
    "assists": ["player_assists"],
    "defense": ["player_blocks", "player_steals"],
    "threes": ["player_threes"],
    "achievements": ["player_double_double", "player_triple_double", "player_first_basket"],
}

ALL_PLAYER_MARKETS = [m for markets in NBA_PLAYER_MARKETS.values() for m in markets]

SPORT_KEY = "basketball_nba"
BASE_URL = "https://api.the-odds-api.com/v4"


def load_api_key() -> str:
    """Load API key from environment."""
    env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
    load_dotenv(env_path)

    api_key = os.getenv("ODDS_API_KEY")
    if not api_key:
        print(f"ERROR: ODDS_API_KEY not found in {env_path}", file=sys.stderr)
        sys.exit(1)
    return api_key


def format_odds(price: int) -> str:
    """Format American odds with sign."""
    return f"+{price}" if price > 0 else str(price)


async def fetch_events(api_key: str) -> list[dict[str, Any]]:
    """Fetch all NBA events."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{BASE_URL}/sports/{SPORT_KEY}/events",
            params={"apiKey": api_key}
        )
        response.raise_for_status()
        return response.json()


async def fetch_game_odds(api_key: str, event_id: str | None = None) -> dict[str, Any] | list[dict[str, Any]]:
    """Fetch game odds (spread, total, moneyline)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        if event_id:
            response = await client.get(
                f"{BASE_URL}/sports/{SPORT_KEY}/events/{event_id}/odds",
                params={
                    "apiKey": api_key,
                    "regions": "us",
                    "markets": ",".join(NBA_GAME_MARKETS),
                    "oddsFormat": "american"
                }
            )
        else:
            response = await client.get(
                f"{BASE_URL}/sports/{SPORT_KEY}/odds",
                params={
                    "apiKey": api_key,
                    "regions": "us",
                    "markets": ",".join(NBA_GAME_MARKETS),
                    "oddsFormat": "american"
                }
            )
        response.raise_for_status()
        return response.json()


async def fetch_player_props(
    api_key: str,
    event_id: str,
    markets: list[str] | None = None,
    bookmaker: str | None = None
) -> dict[str, Any]:
    """Fetch player props for a specific event."""
    if markets is None:
        markets = ALL_PLAYER_MARKETS

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{BASE_URL}/sports/{SPORT_KEY}/events/{event_id}/odds",
            params={
                "apiKey": api_key,
                "regions": "us",
                "markets": ",".join(markets),
                "oddsFormat": "american",
                **({"bookmakers": bookmaker} if bookmaker else {})
            }
        )
        response.raise_for_status()
        return response.json()


def find_event_by_team(events: list[dict], team_query: str) -> dict | None:
    """Find event matching team name (partial match)."""
    query = team_query.lower()
    for event in events:
        if query in event.get("home_team", "").lower() or query in event.get("away_team", "").lower():
            return event
    return None


def format_game_odds_minimal(game: dict[str, Any]) -> str:
    """Format game odds in minimal output format."""
    away = game.get("away_team", "?")
    home = game.get("home_team", "?")

    lines = [f"## {away} @ {home}"]

    bookmakers = game.get("bookmakers", [])
    if not bookmakers:
        lines.append("No odds available")
        return "\n".join(lines)

    # Use first bookmaker
    bk = bookmakers[0]
    for market in bk.get("markets", []):
        key = market["key"]
        outcomes = market.get("outcomes", [])

        if key == "h2h":
            odds_str = ", ".join([f"{o['name']} {format_odds(o['price'])}" for o in outcomes])
            lines.append(f"ML: {odds_str}")
        elif key == "spreads":
            odds_str = ", ".join([f"{o['name']} {o.get('point', 0):+.1f} ({format_odds(o['price'])})" for o in outcomes])
            lines.append(f"Spread: {odds_str}")
        elif key == "totals":
            over = next((o for o in outcomes if o["name"] == "Over"), None)
            under = next((o for o in outcomes if o["name"] == "Under"), None)
            if over and under:
                lines.append(f"Total: {over.get('point', '?')} (O {format_odds(over['price'])}, U {format_odds(under['price'])})")

    return "\n".join(lines)


def format_player_props_minimal(data: dict[str, Any], player_filter: str | None = None) -> str:
    """Format player props in minimal output format."""
    away = data.get("away_team", "?")
    home = data.get("home_team", "?")

    lines = [f"## {away} @ {home} - Player Props"]

    bookmakers = data.get("bookmakers", [])
    if not bookmakers:
        lines.append("No props available")
        return "\n".join(lines)

    # Use first bookmaker
    bk = bookmakers[0]
    lines.append(f"Source: {bk.get('title', 'Unknown')}")

    for market in bk.get("markets", []):
        market_key = market["key"]
        outcomes = market.get("outcomes", [])

        # Group by player
        players: dict[str, list] = {}
        for o in outcomes:
            player = o.get("description", "Unknown")
            if player_filter and player_filter.lower() not in player.lower():
                continue
            if player not in players:
                players[player] = []
            players[player].append(o)

        if not players:
            continue

        lines.append(f"\n### {market_key}")
        for player, odds_list in players.items():
            if len(odds_list) == 1:
                # Yes/No market (like double_double)
                o = odds_list[0]
                lines.append(f"- {player}: {o['name']} {format_odds(o['price'])}")
            else:
                # Over/Under market
                over = next((o for o in odds_list if o["name"] == "Over"), None)
                under = next((o for o in odds_list if o["name"] == "Under"), None)
                if over and under:
                    point = over.get("point", "?")
                    lines.append(f"- {player}: O {point} {format_odds(over['price'])}, U {point} {format_odds(under['price'])}")

    return "\n".join(lines)


def get_player_odds(data: dict[str, Any], market: str, player: str, bookmaker: str | None = None) -> str:
    """Get odds for a specific player and market - minimal output."""
    bookmakers = data.get("bookmakers", [])

    # Filter to specific bookmaker if requested
    if bookmaker:
        bookmakers = [b for b in bookmakers if bookmaker.lower() in b.get("key", "").lower() or bookmaker.lower() in b.get("title", "").lower()]

    if not bookmakers:
        return f"No odds found for {player} - {market}"

    bk = bookmakers[0]
    for m in bk.get("markets", []):
        if m["key"] != market:
            continue

        for o in m.get("outcomes", []):
            if player.lower() in o.get("description", "").lower():
                if o["name"] in ["Yes", "No"]:
                    return f"{player} ({market}): {o['name']} {format_odds(o['price'])}"
                else:
                    # Find paired over/under
                    paired = [x for x in m.get("outcomes", []) if player.lower() in x.get("description", "").lower()]
                    over = next((x for x in paired if x["name"] == "Over"), None)
                    under = next((x for x in paired if x["name"] == "Under"), None)
                    if over and under:
                        return f"{player} ({market}): O {over.get('point', '?')} {format_odds(over['price'])}, U {under.get('point', '?')} {format_odds(under['price'])}"

    return f"No odds found for {player} - {market}"


async def cmd_games(api_key: str, team: str | None = None):
    """Command: Get game odds."""
    if team:
        events = await fetch_events(api_key)
        event = find_event_by_team(events, team)
        if not event:
            print(f"No game found for team: {team}")
            return
        data = await fetch_game_odds(api_key, event["id"])
        print(format_game_odds_minimal(data))
    else:
        games = await fetch_game_odds(api_key)
        for game in games:
            print(format_game_odds_minimal(game))
            print()


async def cmd_props(api_key: str, team: str | None = None, category: str | None = None):
    """Command: Get all player props."""
    events = await fetch_events(api_key)

    if team:
        event = find_event_by_team(events, team)
        if not event:
            print(f"No game found for team: {team}")
            return
        events = [event]

    markets = ALL_PLAYER_MARKETS
    if category and category in NBA_PLAYER_MARKETS:
        markets = NBA_PLAYER_MARKETS[category]

    for event in events:
        data = await fetch_player_props(api_key, event["id"], markets)
        print(format_player_props_minimal(data))
        print()


async def cmd_prop(api_key: str, market: str, player: str, book: str | None = None):
    """Command: Get specific player prop."""
    events = await fetch_events(api_key)

    # Search all events for the player
    for event in events:
        data = await fetch_player_props(api_key, event["id"], [market], book)
        result = get_player_odds(data, market, player, book)
        if "No odds found" not in result:
            print(result)
            return

    print(f"No odds found for {player} - {market}")


async def main():
    parser = argparse.ArgumentParser(description="NBA Odds Fetcher")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # games command
    games_parser = subparsers.add_parser("games", help="Get game odds")
    games_parser.add_argument("--game", help="Filter by team name")

    # props command
    props_parser = subparsers.add_parser("props", help="Get all player props")
    props_parser.add_argument("--game", help="Filter by team name")
    props_parser.add_argument("--category", choices=list(NBA_PLAYER_MARKETS.keys()), help="Filter by category")

    # prop command (single player lookup)
    prop_parser = subparsers.add_parser("prop", help="Get specific player prop")
    prop_parser.add_argument("--market", required=True, help="Market key (e.g., player_points)")
    prop_parser.add_argument("--player", required=True, help="Player name")
    prop_parser.add_argument("--book", help="Bookmaker (e.g., fanduel, draftkings)")

    args = parser.parse_args()
    api_key = load_api_key()

    if args.command == "games":
        await cmd_games(api_key, args.game)
    elif args.command == "props":
        await cmd_props(api_key, args.game, args.category)
    elif args.command == "prop":
        await cmd_prop(api_key, args.market, args.player, args.book)


if __name__ == "__main__":
    asyncio.run(main())
