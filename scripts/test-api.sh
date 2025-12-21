#!/bin/bash

# Backend API Testing Script
# Usage: ./scripts/test-api.sh [endpoint]
# Set your token: export TOKEN="your_jwt_token"

BASE_URL="${BASE_URL:-http://localhost:8080}"
TOKEN="${TOKEN:-YOUR_TOKEN_HERE}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
  echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

# Health check
test_health() {
  print_header "Health Check"
  curl -s "$BASE_URL/health" | jq .
}

# List sessions
test_list_sessions() {
  print_header "List Sessions"
  curl -s "$BASE_URL/api/sessions" \
    -H "Authorization: Bearer $TOKEN" | jq .
}

# Get a specific session
test_get_session() {
  local session_id="$1"
  print_header "Get Session: $session_id"
  curl -s "$BASE_URL/api/sessions/$session_id" \
    -H "Authorization: Bearer $TOKEN" | jq .
}

# Get session messages
test_get_messages() {
  local session_id="$1"
  print_header "Get Messages for Session: $session_id"
  curl -s "$BASE_URL/api/sessions/$session_id/messages" \
    -H "Authorization: Bearer $TOKEN" | jq .
}

# List files for a session
test_list_files() {
  local session_id="$1"
  print_header "List Files for Session: $session_id"
  curl -s "$BASE_URL/api/files/sessions/$session_id/files" \
    -H "Authorization: Bearer $TOKEN" | jq .
}

# Get a specific file
test_get_file() {
  local session_id="$1"
  local file_id="$2"
  print_header "Get File: $file_id"
  curl -s "$BASE_URL/api/files/sessions/$session_id/files/$file_id" \
    -H "Authorization: Bearer $TOKEN" | jq .
}

# Restore session files
test_restore_session() {
  local session_id="$1"
  print_header "Restore Session: $session_id"
  curl -s -X POST "$BASE_URL/api/files/sessions/$session_id/restore" \
    -H "Authorization: Bearer $TOKEN" | jq .
}

# Create a new session
test_create_session() {
  local session_id="$1"
  local title="$2"
  print_header "Create Session"
  curl -s -X POST "$BASE_URL/api/sessions" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"id\": \"$session_id\", \"title\": \"$title\"}" | jq .
}

# Send a message (query agent) - note: this is streaming SSE
test_agent_query() {
  local session_name="$1"
  local content="$2"
  local sdk_session_id="${3:-}"
  print_header "Query Agent (Session: $session_name)"

  local body="{\"content\": \"$content\", \"sessionName\": \"$session_name\""
  if [ -n "$sdk_session_id" ]; then
    body="$body, \"sdkSessionId\": \"$sdk_session_id\""
  fi
  body="$body}"

  echo "Request body: $body"
  echo ""
  echo "Streaming response:"
  curl -N -s -X POST "$BASE_URL/api/agent/query" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# Run all tests
run_all() {
  test_health
  test_list_sessions
}

# Show usage
usage() {
  echo "Usage: $0 <command> [args]"
  echo ""
  echo "Commands:"
  echo "  health                        - Check server health"
  echo "  sessions                      - List all sessions"
  echo "  session <id>                  - Get a specific session"
  echo "  messages <session_id>         - Get messages for a session"
  echo "  files <session_id>            - List files for a session"
  echo "  file <session_id> <file_id>   - Get a specific file"
  echo "  restore <session_id>          - Restore session files to disk"
  echo "  create <uuid> <title>         - Create a new session"
  echo "  query <name> <message> [sdk_id] - Query the agent (streaming)"
  echo "  all                           - Run all basic tests"
  echo ""
  echo "Environment variables:"
  echo "  TOKEN    - JWT bearer token (required)"
  echo "  BASE_URL - Server URL (default: http://localhost:8080)"
  echo ""
  echo "Example:"
  echo "  export TOKEN='eyJhbG...'"
  echo "  $0 health"
  echo "  $0 sessions"
  echo "  $0 query test_session 'Hello, write a file called test.md'"
}

# Main
case "${1:-}" in
  health)
    test_health
    ;;
  sessions)
    test_list_sessions
    ;;
  session)
    test_get_session "$2"
    ;;
  messages)
    test_get_messages "$2"
    ;;
  files)
    test_list_files "$2"
    ;;
  file)
    test_get_file "$2" "$3"
    ;;
  restore)
    test_restore_session "$2"
    ;;
  create)
    test_create_session "$2" "$3"
    ;;
  query)
    test_agent_query "$2" "$3" "${4:-}"
    ;;
  all)
    run_all
    ;;
  *)
    usage
    ;;
esac
