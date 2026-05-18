#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.json"
CONFIG_EXAMPLE="${SCRIPT_DIR}/config.example.json"
SUBSCRIPTIONS_FILE="${SCRIPT_DIR}/data/subscriptions.json"
STATE_FILE="${SCRIPT_DIR}/data/state.json"
SERVICE_NAME="${SERVICE_NAME:-nexusphp-aggregate-web}"
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

is_interactive() {
  [[ -t 0 && "${INTERACTIVE:-true}" != "false" ]]
}

confirm_reset() {
  if ! is_interactive; then
    return
  fi
  echo "========================================="
  echo "  NexusPHP 聚合查询助手 - 初始化重置"
  echo "========================================="
  echo ""
  echo "将要清除以下内容："
  echo "  - ${CONFIG_FILE}"
  echo "  - ${SUBSCRIPTIONS_FILE}"
  echo "  - ${STATE_FILE}"
  echo ""
  echo "清除后将从 config.example.json 重建默认配置。"
  echo ""
  local hint="y/N"
  read -r -p "确认清除所有数据和配置？[${hint}]: " input
  case "${input:-}" in
    y|Y|yes|YES|Yes) ;;
    *) echo "已取消。"; exit 0 ;;
  esac
}

stop_service() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
      if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        echo "停止服务：${SERVICE_NAME} ..."
        ${SUDO} systemctl stop "${SERVICE_NAME}" || true
      fi
    fi
  fi
}

start_service() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
      echo "启动服务：${SERVICE_NAME} ..."
      ${SUDO} systemctl start "${SERVICE_NAME}" || true
      sleep 1
      ${SUDO} systemctl --no-pager --lines=5 status "${SERVICE_NAME}" || true
    fi
  fi
}

reset_config() {
  if [[ -f "${CONFIG_EXAMPLE}" ]]; then
    echo "从 config.example.json 重建 config.json ..."
    ${SUDO} cp -a "${CONFIG_EXAMPLE}" "${CONFIG_FILE}"
  else
    echo "config.example.json 不存在，创建最小配置 ..."
    ${SUDO} tee "${CONFIG_FILE}" >/dev/null <<'EOF'
{
  "port": 3010,
  "timeoutMs": 60000,
  "checkIntervalMs": 600000,
  "searchMaxPages": 5,
  "downloadEnabled": true,
  "sites": []
}
EOF
  fi
  if [[ -n "${SUDO}" ]]; then
    ${SUDO} chmod 600 "${CONFIG_FILE}" || true
  else
    chmod 600 "${CONFIG_FILE}" || true
  fi
}

reset_data() {
  echo "清空订阅数据 ..."
  ${SUDO} mkdir -p "${SCRIPT_DIR}/data"
  echo "[]" | ${SUDO} tee "${SUBSCRIPTIONS_FILE}" >/dev/null
  echo "清空运行日志和状态 ..."
  echo '{"logs":[]}' | ${SUDO} tee "${STATE_FILE}" >/dev/null
}

confirm_reset
stop_service
reset_config
reset_data
start_service

echo ""
echo "========================================="
echo "  初始化完成"
echo "========================================="
echo ""
echo "已清除："
echo "  ✓ config.json 已重置为默认值"
echo "  ✓ data/subscriptions.json 已清空"
echo "  ✓ data/state.json 已清空"
echo ""
echo "请编辑 config.json 填写站点 Cookie 和 Transmission 等配置。"
echo "配置文件：${CONFIG_FILE}"
