#!/bin/bash
#
# Beeclaw PM2 Daemon Health Check Script
#
# Usage:
#   ./scripts/check-daemon.sh          # Check daemon status
#   ./scripts/check-daemon.sh --fix    # Check and attempt to fix issues
#
# Prerequisites: pm2, jq
#

set -e

# ─── Colours ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ─── Configuration ────────────────────────────────────────────────────
# These paths must match:
#   - ecosystem.config.cjs  (error_file / out_file)
#   - src/entries/bot.ts     (daemonPath = join(config.memory.path, 'daemon'))
#   - src/domain/proactive/  (scheduler basePath)
DAEMON_DIR="data/memory/daemon"
PROACTIVE_DIR="data/memory/proactive"
HEARTBEAT_FILE="$DAEMON_DIR/heartbeat.json"
STATE_FILE="$DAEMON_DIR/state.json"
SCHEDULES_FILE="$PROACTIVE_DIR/schedules.json"
LOG_DIR="logs"                              # PM2 log directory (created by PM2)
MAX_HEARTBEAT_AGE=180  # Max heartbeat age in seconds (was 120 — too tight for cold start)

# ─── Counters ─────────────────────────────────────────────────────────
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNING=0

# ─── Helpers ──────────────────────────────────────────────────────────
print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_check()   { echo -e "${BLUE}[CHECK]${NC} $1"; }
print_success() { echo -e "${GREEN}  [OK]  $1${NC}"; ((CHECKS_PASSED++)); }
print_error()   { echo -e "${RED}  [FAIL] $1${NC}"; ((CHECKS_FAILED++)); }
print_warning() { echo -e "${YELLOW}  [WARN] $1${NC}"; ((CHECKS_WARNING++)); }
print_info()    { echo -e "  [INFO] $1"; }

# ─── Prerequisite check ──────────────────────────────────────────────
check_prerequisites() {
    print_check "Prerequisites (pm2, jq)"

    local missing=()
    command -v pm2 &>/dev/null || missing+=("pm2")
    command -v jq  &>/dev/null || missing+=("jq")

    if [ ${#missing[@]} -gt 0 ]; then
        print_error "Missing required tools: ${missing[*]}"
        print_info "Install with: npm i -g pm2 && apt-get install -y jq  (or brew install jq)"
        exit 1
    fi

    print_success "pm2 and jq are available"
}

# ─── PM2 process ──────────────────────────────────────────────────────
check_pm2_process() {
    print_check "PM2 process status"

    local status
    status=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .pm2_env.status' 2>/dev/null)

    if [ -z "$status" ]; then
        print_error "beeclaw process does not exist"
        print_info "Run: bun run pm2:start"
        return 1
    fi

    if [ "$status" != "online" ]; then
        print_error "Process status is unexpected: $status"
        print_info "Run: bun run pm2:restart"
        return 1
    fi

    print_success "Process status: online"

    # Show process info
    local pid memory cpu
    pid=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .pid')
    memory=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .monit.memory')
    cpu=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .monit.cpu')

    print_info "PID: $pid"
    print_info "Memory: $((memory / 1024 / 1024)) MB"
    print_info "CPU: $cpu%"
}

# ─── Config file ──────────────────────────────────────────────────────
check_config() {
    print_check "PM2 config file"

    if [ ! -f "ecosystem.config.cjs" ]; then
        print_error "ecosystem.config.cjs does not exist"
        return 1
    fi

    if grep -q "args.*--daemon" ecosystem.config.cjs; then
        print_success "--daemon argument is configured"
    else
        print_error "Missing --daemon argument"
        print_info "Add to ecosystem.config.cjs: args: '--daemon'"
        return 1
    fi
}

# ─── Daemon directory ─────────────────────────────────────────────────
check_daemon_directory() {
    print_check "Daemon data directory ($DAEMON_DIR)"

    if [ ! -d "$DAEMON_DIR" ]; then
        print_error "Daemon directory does not exist: $DAEMON_DIR"
        print_info "Daemon may not have started yet"
        return 1
    fi

    print_success "Daemon directory exists"
}

# ─── Heartbeat ────────────────────────────────────────────────────────
check_heartbeat() {
    print_check "Daemon heartbeat"

    if [ ! -f "$HEARTBEAT_FILE" ]; then
        print_error "Heartbeat file does not exist"
        print_info "Daemon may not have started or failed on boot"
        return 1
    fi

    local timestamp
    timestamp=$(jq -r '.timestamp' "$HEARTBEAT_FILE" 2>/dev/null)

    if [ -z "$timestamp" ] || [ "$timestamp" == "null" ]; then
        print_error "Heartbeat file has invalid format"
        return 1
    fi

    # Calculate heartbeat age (macOS and Linux compatible)
    local last_epoch now age
    if [[ "$OSTYPE" == "darwin"* ]]; then
        last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${timestamp:0:19}" "+%s" 2>/dev/null)
    else
        last_epoch=$(date -d "${timestamp:0:19}" "+%s" 2>/dev/null)
    fi

    now=$(date "+%s")
    age=$((now - last_epoch))

    if [ $age -gt $MAX_HEARTBEAT_AGE ]; then
        print_error "Heartbeat expired: ${age}s ago"
        print_info "Daemon may have stopped responding"
        return 1
    fi

    print_success "Heartbeat is fresh: ${age}s ago"
    print_info "Last update: $timestamp"
}

# ─── Scheduled tasks ─────────────────────────────────────────────────
check_schedules() {
    print_check "Scheduled tasks ($SCHEDULES_FILE)"

    if [ ! -f "$SCHEDULES_FILE" ]; then
        print_warning "Schedules file does not exist"
        print_info "No scheduled tasks configured"
        return 0
    fi

    local total enabled
    total=$(jq '.schedules | length' "$SCHEDULES_FILE" 2>/dev/null)
    enabled=$(jq '[.schedules[] | select(.enabled==true)] | length' "$SCHEDULES_FILE" 2>/dev/null)

    if [ "$total" -eq 0 ]; then
        print_warning "No scheduled tasks found"
        return 0
    fi

    print_success "Scheduled tasks: $enabled/$total enabled"

    echo ""
    jq -r '.schedules[] | select(.enabled==true) | "  - \(.name) - \(.cron)"' "$SCHEDULES_FILE" 2>/dev/null
}

# ─── Logs ─────────────────────────────────────────────────────────────
check_logs() {
    print_check "Recent logs ($LOG_DIR/)"

    if [ ! -d "$LOG_DIR" ]; then
        print_warning "Log directory does not exist (PM2 creates it on first start)"
        return 0
    fi

    # Daemon startup log
    if grep -q "Starting proactive daemon" "$LOG_DIR/beeclaw-out.log" 2>/dev/null; then
        print_success "Found daemon startup log"
    else
        print_warning "No daemon startup log found (daemon may not have started or log rotated)"
    fi

    # Recent errors
    local recent_errors
    recent_errors=$(tail -100 "$LOG_DIR/beeclaw-error.log" 2>/dev/null | grep -ic "error" || true)
    if [ "$recent_errors" -gt 0 ]; then
        print_warning "Recent error lines: $recent_errors"
        print_info "Inspect: tail -50 $LOG_DIR/beeclaw-error.log"
    else
        print_success "No recent errors"
    fi
}

# ─── Environment variables ────────────────────────────────────────────
check_environment() {
    print_check "Environment variables"

    local missing_vars=()

    [ -z "$LARK_BEECLAW_APPID" ] && missing_vars+=("LARK_BEECLAW_APPID")
    [ -z "$LARK_BEECLAW_AS" ]    && missing_vars+=("LARK_BEECLAW_AS")

    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_warning "Missing env vars: ${missing_vars[*]}"
        print_info "These are required for the Feishu adapter"
    else
        print_success "Feishu environment variables are set"
    fi
}

# ─── Auto-fix ─────────────────────────────────────────────────────────
fix_issues() {
    print_header "Attempting auto-fix"

    local status
    status=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .pm2_env.status' 2>/dev/null)

    if [ -z "$status" ]; then
        print_info "Starting PM2 process..."
        bun run pm2:start
        sleep 5
    elif [ "$status" != "online" ]; then
        print_info "Restarting PM2 process..."
        bun run pm2:restart
        sleep 5
    fi

    print_info "Fix attempt complete -- please re-run this script to verify"
}

# ─── Main ─────────────────────────────────────────────────────────────
main() {
    print_header "Beeclaw PM2 Daemon Health Check"

    check_prerequisites
    echo ""
    check_pm2_process
    echo ""
    check_config
    echo ""
    check_daemon_directory
    echo ""
    check_heartbeat
    echo ""
    check_schedules
    echo ""
    check_logs
    echo ""
    check_environment

    print_header "Summary"

    echo -e "${GREEN}Passed:  $CHECKS_PASSED${NC}"
    echo -e "${YELLOW}Warnings: $CHECKS_WARNING${NC}"
    echo -e "${RED}Failed:  $CHECKS_FAILED${NC}"
    echo ""

    if [ $CHECKS_FAILED -gt 0 ]; then
        echo -e "${RED}[FAIL] Issues detected that need attention${NC}"

        if [ "$1" == "--fix" ]; then
            fix_issues
        else
            echo -e "\nRun with --fix to attempt auto-repair:"
            echo -e "  ${YELLOW}./scripts/check-daemon.sh --fix${NC}"
        fi

        exit 1
    elif [ $CHECKS_WARNING -gt 0 ]; then
        echo -e "${YELLOW}[WARN] Healthy with warnings${NC}"
        exit 0
    else
        echo -e "${GREEN}[OK] All checks passed -- daemon is running normally${NC}"
        exit 0
    fi
}

main "$@"
