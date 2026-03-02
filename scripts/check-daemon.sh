#!/bin/bash
#
# Beeclaw PM2 Daemon 健康检查脚本
#
# Usage:
#   ./scripts/check-daemon.sh          # 检查 daemon 状态
#   ./scripts/check-daemon.sh --fix    # 检查并尝试修复问题
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
DAEMON_DIR="data/memory/daemon"
PROACTIVE_DIR="data/memory/proactive"
HEARTBEAT_FILE="$DAEMON_DIR/heartbeat.json"
STATE_FILE="$DAEMON_DIR/state.json"
SCHEDULES_FILE="$PROACTIVE_DIR/schedules.json"
MAX_HEARTBEAT_AGE=120  # 最大心跳年龄（秒）

# 计数器
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNING=0

# 打印函数
print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_check() {
    echo -e "${BLUE}[检查]${NC} $1"
}

print_success() {
    echo -e "${GREEN}  ✅ $1${NC}"
    ((CHECKS_PASSED++))
}

print_error() {
    echo -e "${RED}  ❌ $1${NC}"
    ((CHECKS_FAILED++))
}

print_warning() {
    echo -e "${YELLOW}  ⚠️  $1${NC}"
    ((CHECKS_WARNING++))
}

print_info() {
    echo -e "  ℹ️  $1"
}

# 检查 PM2 进程
check_pm2_process() {
    print_check "PM2 进程状态"

    if ! command -v pm2 &> /dev/null; then
        print_error "PM2 未安装"
        print_info "运行: npm install -g pm2"
        return 1
    fi

    local status=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .pm2_env.status' 2>/dev/null)

    if [ -z "$status" ]; then
        print_error "beeclaw 进程不存在"
        print_info "运行: bun run pm2:start"
        return 1
    fi

    if [ "$status" != "online" ]; then
        print_error "进程状态异常: $status"
        print_info "运行: bun run pm2:restart"
        return 1
    fi

    print_success "进程状态: online"

    # 显示进程信息
    local pid=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .pid')
    local memory=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .monit.memory')
    local cpu=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .monit.cpu')

    print_info "PID: $pid"
    print_info "内存: $((memory / 1024 / 1024)) MB"
    print_info "CPU: $cpu%"
}

# 检查配置文件
check_config() {
    print_check "PM2 配置文件"

    if [ ! -f "ecosystem.config.cjs" ]; then
        print_error "ecosystem.config.cjs 不存在"
        return 1
    fi

    if grep -q "args.*--daemon" ecosystem.config.cjs; then
        print_success "Daemon 参数已配置"
    else
        print_error "缺少 --daemon 参数"
        print_info "在 ecosystem.config.cjs 中添加: args: '--daemon'"
        return 1
    fi
}

# 检查 Daemon 目录
check_daemon_directory() {
    print_check "Daemon 数据目录"

    if [ ! -d "$DAEMON_DIR" ]; then
        print_error "Daemon 目录不存在: $DAEMON_DIR"
        print_info "Daemon 可能未启动"
        return 1
    fi

    print_success "Daemon 目录存在"
}

# 检查心跳文件
check_heartbeat() {
    print_check "Daemon 心跳"

    if [ ! -f "$HEARTBEAT_FILE" ]; then
        print_error "心跳文件不存在"
        print_info "Daemon 可能未启动或启动失败"
        return 1
    fi

    local timestamp=$(jq -r '.timestamp' "$HEARTBEAT_FILE" 2>/dev/null)

    if [ -z "$timestamp" ] || [ "$timestamp" == "null" ]; then
        print_error "心跳文件格式错误"
        return 1
    fi

    # 计算心跳年龄（兼容 macOS 和 Linux）
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        local last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${timestamp:0:19}" "+%s" 2>/dev/null)
    else
        # Linux
        local last_epoch=$(date -d "${timestamp:0:19}" "+%s" 2>/dev/null)
    fi

    local now=$(date "+%s")
    local age=$((now - last_epoch))

    if [ $age -gt $MAX_HEARTBEAT_AGE ]; then
        print_error "心跳过期: ${age} 秒前"
        print_info "Daemon 可能已停止响应"
        return 1
    fi

    print_success "心跳正常: ${age} 秒前更新"
    print_info "最后更新: $timestamp"
}

# 检查定时任务
check_schedules() {
    print_check "定时任务配置"

    if [ ! -f "$SCHEDULES_FILE" ]; then
        print_warning "定时任务文件不存在"
        print_info "暂无定时任务"
        return 0
    fi

    local total=$(jq '.schedules | length' "$SCHEDULES_FILE" 2>/dev/null)
    local enabled=$(jq '[.schedules[] | select(.enabled==true)] | length' "$SCHEDULES_FILE" 2>/dev/null)

    if [ "$total" -eq 0 ]; then
        print_warning "没有定时任务"
        print_info "创建任务: 在对话中说 '每天早上9点提醒我...'"
        return 0
    fi

    print_success "定时任务: $enabled/$total 个已启用"

    # 显示任务列表
    echo ""
    jq -r '.schedules[] | select(.enabled==true) | "  • \(.name) - \(.cron)"' "$SCHEDULES_FILE" 2>/dev/null
}

# 检查日志
check_logs() {
    print_check "最近日志"

    if [ ! -d "logs" ]; then
        print_warning "日志目录不存在"
        return 0
    fi

    # 检查 daemon 启动日志
    if grep -q "Starting proactive daemon" logs/beeclaw-out.log 2>/dev/null; then
        print_success "发现 daemon 启动日志"
    else
        print_warning "未找到 daemon 启动日志"
        print_info "可能 daemon 未启动或日志已轮转"
    fi

    # 检查最近的错误
    local recent_errors=$(tail -100 logs/beeclaw-error.log 2>/dev/null | grep -i "error" | wc -l)
    if [ "$recent_errors" -gt 0 ]; then
        print_warning "最近有 $recent_errors 条错误日志"
        print_info "查看错误: tail -50 logs/beeclaw-error.log"
    else
        print_success "无最近错误"
    fi
}

# 检查环境变量
check_environment() {
    print_check "环境变量"

    local missing_vars=()

    [ -z "$LARK_BEECLAW_APPID" ] && missing_vars+=("LARK_BEECLAW_APPID")
    [ -z "$LARK_BEECLAW_AS" ] && missing_vars+=("LARK_BEECLAW_AS")

    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_warning "缺少环境变量: ${missing_vars[*]}"
        print_info "这些变量用于飞书连接"
    else
        print_success "飞书环境变量已配置"
    fi
}

# 修复问题
fix_issues() {
    print_header "尝试修复问题"

    # 检查进程是否存在
    local status=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="beeclaw") | .pm2_env.status' 2>/dev/null)

    if [ -z "$status" ]; then
        print_info "启动 PM2 进程..."
        bun run pm2:start
        sleep 5
    elif [ "$status" != "online" ]; then
        print_info "重启 PM2 进程..."
        bun run pm2:restart
        sleep 5
    fi

    print_info "修复完成，请重新运行检查"
}

# 主函数
main() {
    print_header "Beeclaw PM2 Daemon 健康检查"

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

    print_header "检查结果"

    echo -e "${GREEN}通过: $CHECKS_PASSED${NC}"
    echo -e "${YELLOW}警告: $CHECKS_WARNING${NC}"
    echo -e "${RED}失败: $CHECKS_FAILED${NC}"
    echo ""

    if [ $CHECKS_FAILED -gt 0 ]; then
        echo -e "${RED}❌ 发现问题需要修复${NC}"

        if [ "$1" == "--fix" ]; then
            fix_issues
        else
            echo -e "\n运行以下命令尝试自动修复:"
            echo -e "  ${YELLOW}./scripts/check-daemon.sh --fix${NC}"
        fi

        exit 1
    elif [ $CHECKS_WARNING -gt 0 ]; then
        echo -e "${YELLOW}⚠️  状态良好但有一些警告${NC}"
        exit 0
    else
        echo -e "${GREEN}✅ 所有检查通过，Daemon 运行正常${NC}"
        exit 0
    fi
}

# 运行
main "$@"
