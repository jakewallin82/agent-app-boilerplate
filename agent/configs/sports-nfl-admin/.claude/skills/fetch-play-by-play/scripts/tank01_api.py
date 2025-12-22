#!/usr/bin/env python3
"""
Tank01 NFL API Play-by-Play Fetcher

Fetches live play-by-play data from Tank01 API and saves to markdown format.
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


def parse_game_id(game_id):
    """Parse game ID to extract team abbreviations."""
    try:
        _, teams = game_id.split('_')
        away, home = teams.split('@')
        return away, home
    except:
        return "AWAY", "HOME"


def fetch_box_score(game_id, api_key):
    """Fetch box score data from Tank01 API."""
    base_url = "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/getNFLBoxScore"

    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com"
    }

    params = {
        "gameID": game_id,
        "playByPlay": "true",
        "fantasyPoints": "true",
        "twoPointConversions": "2",
        "passYards": ".04",
        "passAttempts": "0",
        "passTD": "4",
        "passCompletions": "0",
        "passInterceptions": "-2",
        "pointsPerReception": ".5",
        "carries": ".2",
        "rushYards": ".1",
        "rushTD": "6",
        "fumbles": "-2",
        "receivingYards": ".1",
        "receivingTD": "6",
        "targets": "0",
        "defTD": "6",
        "fgMade": "3",
        "fgMissed": "-3",
        "xpMade": "1",
        "xpMissed": "-1"
    }

    try:
        print(f"Fetching data for game ID: {game_id}...", file=sys.stderr)
        response = requests.get(base_url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from API: {e}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error parsing API response: {e}", file=sys.stderr)
        sys.exit(1)


def safe_get(data, *keys, default="N/A"):
    """Safely get nested dictionary values."""
    result = data
    for key in keys:
        if isinstance(result, dict):
            result = result.get(key)
        else:
            return default
        if result is None:
            return default
    return result if result != "" else default


def get_team_info(data):
    """Extract team information from API response."""
    if 'body' not in data:
        return {}

    body = data['body']
    team_info = {}

    if 'DST' in body and isinstance(body['DST'], dict):
        dst = body['DST']
        if 'away' in dst and isinstance(dst['away'], dict):
            team_info['away_abv'] = dst['away'].get('teamAbv', 'AWAY')
            team_info['away_id'] = dst['away'].get('teamID', '')
        if 'home' in dst and isinstance(dst['home'], dict):
            team_info['home_abv'] = dst['home'].get('teamAbv', 'HOME')
            team_info['home_id'] = dst['home'].get('teamID', '')

    if not team_info.get('away_abv'):
        team_info['away_abv'] = body.get('away', 'AWAY')
    if not team_info.get('home_abv'):
        team_info['home_abv'] = body.get('home', 'HOME')

    return team_info


def format_team_indicator(team_id, team_info):
    """Format team indicator with emoji."""
    if team_id == team_info.get('away_id'):
        return f"🏈 {team_info.get('away_abv', 'AWAY')}"
    elif team_id == team_info.get('home_id'):
        return f"🏠 {team_info.get('home_abv', 'HOME')}"
    else:
        return f"Team {team_id}"


def format_play_for_markdown(play, team_info):
    """Format a single play in markdown."""
    period = play.get('playPeriod', 'Q?')
    clock = play.get('playClock', '??:??')
    down_dist = play.get('downAndDistance', '')
    play_desc = play.get('play', 'No description')
    team_id = play.get('teamID', 'Unknown')

    team_indicator = format_team_indicator(team_id, team_info)

    stats_summary = ""
    if 'playerStats' in play:
        stats = []
        for player_id, player_stats in play['playerStats'].items():
            for stat_type, stat_values in player_stats.items():
                if stat_type == 'Passing':
                    yards = stat_values.get('passYds', '0')
                    stats.append(f"Pass: {yards}yd")
                elif stat_type == 'Rushing':
                    yards = stat_values.get('rushYds', '0')
                    stats.append(f"Rush: {yards}yd")
                elif stat_type == 'Receiving':
                    yards = stat_values.get('recYds', '0')
                    stats.append(f"Rec: {yards}yd")
                elif stat_type == 'Kicking':
                    yards = stat_values.get('kickYards', '0')
                    stats.append(f"Kick: {yards}yd")

        if stats:
            stats_summary = f" | Stats: {', '.join(stats)}"

    return f"**{period} {clock}** {down_dist} \n- {play_desc}{stats_summary}\n- {team_indicator}\n"


def format_scoring_play(score, team_info):
    """Format a scoring play in markdown."""
    period = score.get('scorePeriod', 'Q?')
    time = score.get('scoreTime', '??:??')
    score_desc = score.get('score', 'Unknown score')
    score_type = score.get('scoreType', 'Unknown')
    team = score.get('team', 'Unknown')
    home_score = score.get('homeScore', '0')
    away_score = score.get('awayScore', '0')
    details = score.get('scoreDetails', '')

    return (f"🏈 **SCORE - {score_type}** 🏈\n"
            f"**{period} {time}** - {team}\n"
            f"- {score_desc}\n"
            f"- Score: {team_info.get('away_abv', 'Away')} {away_score} - {home_score} {team_info.get('home_abv', 'Home')}\n"
            f"- Drive: {details}\n")


def categorize_player(player_data):
    """Categorize player by their primary position based on stats."""
    if 'Passing' in player_data:
        return 'QB'
    elif 'Rushing' in player_data and 'Receiving' not in player_data:
        return 'RB'
    elif 'Receiving' in player_data and 'Rushing' not in player_data:
        return 'WR'
    elif 'Receiving' in player_data and 'Rushing' in player_data:
        rush_yards = int(player_data.get('Rushing', {}).get('rushYds', '0') or '0')
        rec_yards = int(player_data.get('Receiving', {}).get('recYds', '0') or '0')
        return 'RB' if rush_yards > rec_yards else 'WR'
    elif 'Kicking' in player_data:
        return 'K'
    elif 'Defense' in player_data:
        return 'DEF'
    else:
        return 'OTHER'


def get_player_importance_score(player_data):
    """Calculate importance score for sorting."""
    score = 0

    if 'Passing' in player_data:
        passing = player_data['Passing']
        score += int(passing.get('passYds', '0') or '0') * 0.1
        score += int(passing.get('passTD', '0') or '0') * 6

    if 'Rushing' in player_data:
        rushing = player_data['Rushing']
        score += int(rushing.get('rushYds', '0') or '0') * 0.1
        score += int(rushing.get('rushTD', '0') or '0') * 6

    if 'Receiving' in player_data:
        receiving = player_data['Receiving']
        score += int(receiving.get('recYds', '0') or '0') * 0.1
        score += int(receiving.get('recTD', '0') or '0') * 6

    if 'Defense' in player_data:
        defense = player_data['Defense']
        score += float(defense.get('totalTackles', '0') or '0') * 0.5
        score += float(defense.get('sacks', '0') or '0') * 3

    return score


def format_player_entry(player_data, player_id):
    """Format a single player's stats."""
    player_name = player_data.get('longName', f'Player {player_id}')
    position = categorize_player(player_data)

    stats_lines = []

    if 'Passing' in player_data:
        passing = player_data['Passing']
        if any(passing.get(stat, '0') != '0' for stat in ['passYds', 'passTD', 'passCompletions', 'passAttempts']):
            stats_lines.append(f"**Passing:** {passing.get('passCompletions', '0')}/{passing.get('passAttempts', '0')} for {passing.get('passYds', '0')} yards, {passing.get('passTD', '0')} TD, {passing.get('passInt', '0')} INT")

    if 'Rushing' in player_data:
        rushing = player_data['Rushing']
        if any(rushing.get(stat, '0') != '0' for stat in ['rushYds', 'rushTD', 'carries']):
            stats_lines.append(f"**Rushing:** {rushing.get('carries', '0')} carries for {rushing.get('rushYds', '0')} yards, {rushing.get('rushTD', '0')} TD")

    if 'Receiving' in player_data:
        receiving = player_data['Receiving']
        if any(receiving.get(stat, '0') != '0' for stat in ['recYds', 'recTD', 'receptions', 'targets']):
            stats_lines.append(f"**Receiving:** {receiving.get('receptions', '0')}/{receiving.get('targets', '0')} for {receiving.get('recYds', '0')} yards, {receiving.get('recTD', '0')} TD")

    if 'Kicking' in player_data:
        kicking = player_data['Kicking']
        if any(kicking.get(stat, '0') != '0' for stat in ['fgMade', 'fgAttempts', 'xpMade', 'xpAttempts']):
            fg_stats = f"{kicking.get('fgMade', '0')}/{kicking.get('fgAttempts', '0')} FG"
            xp_stats = f"{kicking.get('xpMade', '0')}/{kicking.get('xpAttempts', '0')} XP"
            stats_lines.append(f"**Kicking:** {fg_stats}, {xp_stats}")

    if 'Defense' in player_data:
        defense = player_data['Defense']
        if any(defense.get(stat, '0') != '0' for stat in ['totalTackles', 'sacks', 'defensiveInterceptions', 'defTD']):
            def_stats = []
            if defense.get('totalTackles', '0') != '0':
                def_stats.append(f"{defense.get('totalTackles', '0')} tackles")
            if defense.get('sacks', '0') != '0':
                def_stats.append(f"{defense.get('sacks', '0')} sacks")
            if defense.get('defensiveInterceptions', '0') != '0':
                def_stats.append(f"{defense.get('defensiveInterceptions', '0')} INT")
            if def_stats:
                stats_lines.append(f"**Defense:** {', '.join(def_stats)}")

    if stats_lines:
        return f"**{player_name}** ({position})\n" + "\n".join(f"  {line}" for line in stats_lines)
    else:
        return f"**{player_name}** ({position}) - No stats"


def format_player_stats_section(data, team_info):
    """Format player stats box score section organized by position."""
    if 'body' not in data or 'playerStats' not in data['body']:
        return ""

    player_stats = data['body']['playerStats']
    away_abv = team_info.get('away_abv', 'AWAY')
    home_abv = team_info.get('home_abv', 'HOME')
    away_id = team_info.get('away_id', '')
    home_id = team_info.get('home_id', '')

    away_players_by_pos = {}
    home_players_by_pos = {}

    for player_id, player_data in player_stats.items():
        player_team_id = player_data.get('teamID', '')
        position = categorize_player(player_data)
        importance = get_player_importance_score(player_data)

        player_entry = (importance, format_player_entry(player_data, player_id))

        if player_team_id == away_id:
            if position not in away_players_by_pos:
                away_players_by_pos[position] = []
            away_players_by_pos[position].append(player_entry)
        elif player_team_id == home_id:
            if position not in home_players_by_pos:
                home_players_by_pos[position] = []
            home_players_by_pos[position].append(player_entry)

    for pos_dict in [away_players_by_pos, home_players_by_pos]:
        for position in pos_dict:
            pos_dict[position].sort(key=lambda x: x[0], reverse=True)

    position_order = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'OTHER']

    def format_team_section(team_abv, players_by_pos):
        section = f"### {team_abv} Players\n\n"

        for position in position_order:
            if position in players_by_pos and players_by_pos[position]:
                section += f"#### {position}\n\n"
                for _, player_entry in players_by_pos[position][:5]:
                    section += player_entry + "\n\n"

        return section

    section = f"## 📊 Player Stats\n\n"
    section += format_team_section(away_abv, away_players_by_pos)
    section += format_team_section(home_abv, home_players_by_pos)

    return section


def format_team_stats_section(data, team_info):
    """Format team stats section."""
    if 'body' not in data or 'teamStats' not in data['body']:
        return ""

    team_stats = data['body']['teamStats']
    away_abv = team_info.get('away_abv', 'AWAY')
    home_abv = team_info.get('home_abv', 'HOME')

    section = f"## 📈 Team Stats\n\n"

    if 'away' in team_stats:
        away_stats = team_stats['away']
        section += f"### {away_abv} Statistics\n\n"
        section += f"- **Total Yards:** {away_stats.get('totalYards', 'N/A')}\n"
        section += f"- **Passing:** {away_stats.get('passCompletionsAndAttempts', 'N/A')} for {away_stats.get('passingYards', 'N/A')} yards\n"
        section += f"- **Rushing:** {away_stats.get('rushingAttempts', 'N/A')} attempts for {away_stats.get('rushingYards', 'N/A')} yards\n"
        section += f"- **Possession:** {away_stats.get('possession', 'N/A')}\n"
        section += f"- **Third Down:** {away_stats.get('thirdDownEfficiency', 'N/A')}\n"
        section += f"- **Red Zone:** {away_stats.get('redZoneScoredAndAttempted', 'N/A')}\n\n"

    if 'home' in team_stats:
        home_stats = team_stats['home']
        section += f"### {home_abv} Statistics\n\n"
        section += f"- **Total Yards:** {home_stats.get('totalYards', 'N/A')}\n"
        section += f"- **Passing:** {home_stats.get('passCompletionsAndAttempts', 'N/A')} for {home_stats.get('passingYards', 'N/A')} yards\n"
        section += f"- **Rushing:** {home_stats.get('rushingAttempts', 'N/A')} attempts for {home_stats.get('rushingYards', 'N/A')} yards\n"
        section += f"- **Possession:** {home_stats.get('possession', 'N/A')}\n"
        section += f"- **Third Down:** {home_stats.get('thirdDownEfficiency', 'N/A')}\n"
        section += f"- **Red Zone:** {home_stats.get('redZoneScoredAndAttempted', 'N/A')}\n\n"

    return section


def is_game_over(data):
    """Check if the game is finished based on API response."""
    body = safe_get(data, "body", default={})

    game_status = safe_get(body, "gameStatus", default="").lower()
    if game_status in ["final", "completed", "finished"]:
        return True

    quarter = safe_get(body, "quarter", default="")
    if isinstance(quarter, str) and quarter.upper() in ["FINAL", "F"]:
        return True

    period = safe_get(body, "period", default="")
    if isinstance(period, str) and period.upper() in ["FINAL", "F"]:
        return True

    return False


def format_game_state(data, game_id):
    """Format API response into readable markdown matching the working format."""
    body = safe_get(data, "body", default={})

    team_info = get_team_info(data)
    away_abv = team_info.get('away_abv', 'AWAY')
    home_abv = team_info.get('home_abv', 'HOME')

    away_pts = safe_get(body, "awayPts", default="0")
    home_pts = safe_get(body, "homePts", default="0")

    lines = []
    lines.append(f"# NFL Live Game: {game_id}")
    lines.append("")
    lines.append(f"**Last updated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("")
    lines.append(f"**Current Score:** {away_abv} {away_pts} - {home_pts} {home_abv}")
    lines.append("")
    lines.append("---")
    lines.append("")

    lines.append(f"## 🏆 Current Score: {away_abv} {away_pts} - {home_pts} {home_abv}")
    lines.append("")

    lines.append(format_team_stats_section(data, team_info))
    lines.append(format_player_stats_section(data, team_info))
    lines.append("---")
    lines.append("")

    scoring_plays = safe_get(body, "scoringPlays", default=[])
    if scoring_plays and isinstance(scoring_plays, list) and len(scoring_plays) > 0:
        lines.append("## 🏈 Scoring Plays")
        lines.append("")
        for score in scoring_plays:
            lines.append(format_scoring_play(score, team_info))
        lines.append("")

    all_plays = safe_get(body, "allPlayByPlay", default=[])
    if all_plays and isinstance(all_plays, list) and len(all_plays) > 0:
        lines.append("## 📊 Play-by-Play")
        lines.append("")
        for play in all_plays:
            lines.append(format_play_for_markdown(play, team_info))
        lines.append("")
    else:
        lines.append("## 📊 Play-by-Play")
        lines.append("")
        lines.append("No play-by-play data available.")
        lines.append("")

    return "\n".join(lines)


def save_output(content, game_id, is_final=False):
    """Save formatted output to file.
    
    Args:
        content: The markdown content to save
        game_id: The game ID
        is_final: If True, save to final.md; otherwise save to current_state.md
    """
    script_dir = Path(__file__).parent
    agent_dir = script_dir.parent.parent.parent.parent
    output_dir = agent_dir / "data" / "live-games" / game_id
    output_dir.mkdir(parents=True, exist_ok=True)

    filename = "final.md" if is_final else "current_state.md"
    output_file = output_dir / filename

    try:
        with open(output_file, 'w') as f:
            f.write(content)
        print(f"Saved to: {output_file}", file=sys.stderr)
        return output_file
    except IOError as e:
        print(f"Error saving file: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Fetch NFL play-by-play data from Tank01 API"
    )
    parser.add_argument(
        "--game_id",
        required=True,
        help="NFL game ID to fetch data for"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Print raw API response for debugging"
    )

    args = parser.parse_args()

    # Load API key
    api_key = load_api_key()

    # Fetch data
    data = fetch_box_score(args.game_id, api_key)

    # Debug output
    if args.debug:
        print("=== RAW API RESPONSE ===", file=sys.stderr)
        print(json.dumps(data, indent=2), file=sys.stderr)
        print("=" * 50, file=sys.stderr)

    # Check if game is over
    game_over = is_game_over(data)

    # Format output
    formatted_output = format_game_state(data, args.game_id)

    # Save to file (final.md if game is over, otherwise current_state.md)
    output_file = save_output(formatted_output, args.game_id, is_final=game_over)

    # Only print the minimal status message to stdout
    status_msg = "FINAL" if game_over else "LIVE"
    print(f"Success! Data saved to: {output_file} (Status: {status_msg})")

if __name__ == "__main__":
    main()
