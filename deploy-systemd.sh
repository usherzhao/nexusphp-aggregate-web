#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-nexusphp-aggregate-web}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/nexusphp-aggregate-web}"
PRESERVE_DATA="${PRESERVE_DATA:-true}"
DEPLOY_MODE="${DEPLOY_MODE:-}"
IMAGE_NAME="${IMAGE_NAME:-nexusphp-aggregate-web:latest}"
DOCKER_NETWORK="${DOCKER_NETWORK:-nexusphp-aggregate-net}"
INSTALL_SEARXNG="${INSTALL_SEARXNG:-false}"
SEARXNG_CONTAINER="${SEARXNG_CONTAINER:-searxng}"
SEARXNG_IMAGE="${SEARXNG_IMAGE:-searxng/searxng:latest}"
SEARXNG_CONFIG_DIR="${SEARXNG_CONFIG_DIR:-/data/searxng}"
DEFAULT_RUN_USER="${SUDO_USER:-$(id -un)}"
RUN_USER="${RUN_USER:-${DEFAULT_RUN_USER}}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "此脚本仅支持 Linux 环境。"
  exit 1
fi

if [[ -n "${SUDO}" ]] && ! command -v sudo >/dev/null 2>&1; then
  echo "当前不是 root 用户，且未检测到 sudo。请用 root 执行，或安装 sudo。"
  exit 1
fi

if [[ ! -f "${SOURCE_DIR}/server.js" || ! -f "${SOURCE_DIR}/package.json" ]]; then
  echo "请在项目根目录中执行此脚本，当前目录缺少 server.js 或 package.json。"
  exit 1
fi

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    ${SUDO} apt-get update
    ${SUDO} apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    ${SUDO} dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    ${SUDO} yum install -y "$@"
  else
    echo "未检测到 apt-get/dnf/yum，无法自动安装：$*"
    return 1
  fi
}

install_base_packages() {
  echo "检查基础组件..."
  if command -v apt-get >/dev/null 2>&1; then
    install_packages ca-certificates curl gnupg python3 make rsync
  elif command -v dnf >/dev/null 2>&1; then
    install_packages ca-certificates curl gnupg2 python3 make rsync
  elif command -v yum >/dev/null 2>&1; then
    install_packages ca-certificates curl gnupg2 python3 make rsync
  fi
}

install_code_build_packages() {
  echo "检查代码部署编译组件..."
  if command -v apt-get >/dev/null 2>&1; then
    install_packages build-essential python3 make g++
  elif command -v dnf >/dev/null 2>&1; then
    install_packages gcc gcc-c++ make python3
  elif command -v yum >/dev/null 2>&1; then
    install_packages gcc gcc-c++ make python3
  fi
}

install_nodejs() {
  echo "开始自动安装 Node.js 20..."
  if command -v apt-get >/dev/null 2>&1; then
    install_packages ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | ${SUDO} bash -
    install_packages nodejs
  elif command -v dnf >/dev/null 2>&1; then
    ${SUDO} dnf module reset -y nodejs || true
    ${SUDO} dnf module enable -y nodejs:20 || true
    install_packages nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | ${SUDO} bash -
    install_packages nodejs
  else
    echo "无法自动安装 Node.js，请手动安装 Node.js 20+ 后重新执行脚本。"
    exit 1
  fi
}

get_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -v | sed 's/^v//' | cut -d. -f1
}

ensure_nodejs() {
  install_code_build_packages
  NODE_MAJOR="$(get_node_major)"
  if [[ "${NODE_MAJOR}" -lt 20 ]]; then
    if [[ "${NODE_MAJOR}" -eq 0 ]]; then
      echo "未检测到 Node.js。"
    else
      echo "当前 Node.js 主版本为 ${NODE_MAJOR}，低于 20。"
    fi
    install_nodejs
  fi
  NODE_BIN="$(command -v node || true)"
  NPM_BIN="$(command -v npm || true)"
  if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
    echo "Node.js 或 npm 安装失败，请检查系统包管理器输出。"
    exit 1
  fi
  NODE_VERSION="$(${NODE_BIN} -v | sed 's/^v//')"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [[ "${NODE_MAJOR}" -lt 20 ]]; then
    echo "当前 Node.js 版本为 ${NODE_VERSION}，仍低于 20，请手动处理后重试。"
    exit 1
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    echo "已检测到 Docker：$(docker --version)"
  else
    echo "未检测到 Docker，开始自动安装 Docker..."
    install_packages ca-certificates curl
    curl -fsSL https://get.docker.com | ${SUDO} sh
  fi
  if command -v systemctl >/dev/null 2>&1; then
    ${SUDO} systemctl enable docker || true
    ${SUDO} systemctl start docker || true
  fi
}

is_interactive() {
  [[ -t 0 && "${INTERACTIVE:-true}" != "false" ]]
}

prompt_value() {
  local label="$1"
  local current="$2"
  local input=""
  if is_interactive; then
    read -r -p "${label} [${current}]: " input
    echo "${input:-${current}}"
  else
    echo "${current}"
  fi
}

prompt_yes_no() {
  local label="$1"
  local current="$2"
  local input=""
  if ! is_interactive; then
    echo "${current}"
    return
  fi
  local hint="y/N"
  if [[ "${current}" == "true" ]]; then
    hint="Y/n"
  fi
  read -r -p "${label} [${hint}]: " input
  case "${input:-}" in
    y|Y|yes|YES|Yes) echo "true" ;;
    n|N|no|NO|No) echo "false" ;;
    "") echo "${current}" ;;
    *) echo "${current}" ;;
  esac
}

select_deploy_mode() {
  if [[ -n "${DEPLOY_MODE}" ]]; then
    return
  fi
  if is_interactive; then
    echo "请选择部署方式："
    echo "1) 代码部署：安装 Node.js/npm，用 systemd 后台运行"
    echo "2) Docker 部署：安装 Docker，构建镜像并用容器后台运行"
    echo "3) Docker 快速更新：仅更新代码文件并重启容器（不重新构建镜像）"
    read -r -p "请输入 1、2 或 3 [默认 1]: " choice
    case "${choice:-1}" in
      1) DEPLOY_MODE="code" ;;
      2) DEPLOY_MODE="docker" ;;
      3) DEPLOY_MODE="docker-restart" ;;
      *) echo "输入无效，默认使用代码部署。"; DEPLOY_MODE="code" ;;
    esac
  else
    DEPLOY_MODE="code"
  fi
}

collect_install_options() {
  select_deploy_mode
  if ! is_interactive; then
    return
  fi
  echo ""
  echo "请确认安装参数："
  INSTALL_DIR="$(prompt_value "安装目录" "${INSTALL_DIR}")"
  SERVICE_NAME="$(prompt_value "服务/容器名称" "${SERVICE_NAME}")"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  PRESERVE_DATA="$(prompt_yes_no "如果目标目录已有数据，是否保留旧 config.json 和 data 目录" "${PRESERVE_DATA}")"
  if [[ "${DEPLOY_MODE}" == "code" ]]; then
    RUN_USER="$(prompt_value "systemd 运行用户" "${RUN_USER}")"
  fi
  if [[ "${DEPLOY_MODE}" == "docker" ]]; then
    IMAGE_NAME="$(prompt_value "Docker 镜像名" "${IMAGE_NAME}")"
    DOCKER_NETWORK="$(prompt_value "Docker 网络名" "${DOCKER_NETWORK}")"
    INSTALL_SEARXNG="$(prompt_yes_no "是否同时安装/更新 SearXNG 网络搜索容器" "${INSTALL_SEARXNG}")"
    if [[ "${INSTALL_SEARXNG}" == "true" ]]; then
      SEARXNG_CONTAINER="$(prompt_value "SearXNG 容器名称" "${SEARXNG_CONTAINER}")"
      SEARXNG_CONFIG_DIR="$(prompt_value "SearXNG 配置目录" "${SEARXNG_CONFIG_DIR}")"
    fi
  fi
  echo ""
  echo "安装确认："
  echo "部署方式：${DEPLOY_MODE}"
  echo "安装目录：${INSTALL_DIR}"
  echo "服务/容器名称：${SERVICE_NAME}"
  echo "保留旧数据：${PRESERVE_DATA}"
  if [[ "${DEPLOY_MODE}" == "code" ]]; then
    echo "运行用户：${RUN_USER}"
  elif [[ "${DEPLOY_MODE}" == "docker" ]]; then
    echo "Docker 镜像名：${IMAGE_NAME}"
    echo "Docker 网络名：${DOCKER_NETWORK}"
    echo "安装 SearXNG：${INSTALL_SEARXNG}"
    if [[ "${INSTALL_SEARXNG}" == "true" ]]; then
      echo "SearXNG 容器名称：${SEARXNG_CONTAINER}"
      echo "SearXNG 配置目录：${SEARXNG_CONFIG_DIR}"
    fi
  fi
  if [[ "$(prompt_yes_no "确认开始安装" "true")" != "true" ]]; then
    echo "已取消安装。"
    exit 0
  fi
}

backup_existing_data() {
  if [[ -d "${INSTALL_DIR}" ]]; then
    BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S)"
    echo "检测到已有安装目录，备份关键数据到 ${BACKUP_DIR} ..."
    ${SUDO} mkdir -p "${BACKUP_DIR}/data"
    if [[ -f "${INSTALL_DIR}/config.json" ]]; then
      ${SUDO} cp -a "${INSTALL_DIR}/config.json" "${BACKUP_DIR}/config.json"
    fi
    for f in "data/subscriptions.json" "data/state.json"; do
      if [[ -f "${INSTALL_DIR}/${f}" ]]; then
        ${SUDO} cp -a "${INSTALL_DIR}/${f}" "${BACKUP_DIR}/${f}"
      fi
    done
  fi
}

restore_existing_data() {
  if [[ "${PRESERVE_DATA}" == "true" && -n "${BACKUP_DIR:-}" ]]; then
    echo "恢复已有生产配置和数据..."
    if [[ -f "${BACKUP_DIR}/config.json" ]]; then
      ${SUDO} cp -a "${BACKUP_DIR}/config.json" "${INSTALL_DIR}/config.json"
    fi
    for f in "data/subscriptions.json" "data/state.json"; do
      if [[ -f "${BACKUP_DIR}/${f}" ]]; then
        ${SUDO} mkdir -p "${INSTALL_DIR}/data"
        ${SUDO} cp -a "${BACKUP_DIR}/${f}" "${INSTALL_DIR}/${f}"
      fi
    done
  fi
}

ensure_runtime_files() {
  ${SUDO} mkdir -p "${INSTALL_DIR}/data"
  if [[ ! -f "${INSTALL_DIR}/config.json" ]]; then
    if [[ -f "${INSTALL_DIR}/config.example.json" ]]; then
      echo "未找到 config.json，已从 config.example.json 创建。"
      ${SUDO} cp -a "${INSTALL_DIR}/config.example.json" "${INSTALL_DIR}/config.json"
    else
      echo "未找到 config.json 和 config.example.json，创建最小配置文件。"
      ${SUDO} tee "${INSTALL_DIR}/config.json" >/dev/null <<EOF
{
  "port": 3010,
  "timeoutMs": 60000,
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "checkIntervalMs": 600000,
  "searchMaxPages": 5,
  "downloadEnabled": true,
  "syncTransmissionBeforeCheck": true,
  "transmissionNetworkFailureAsSuccess": false,
  "transmissionUrl": "http://127.0.0.1:9091/transmission/rpc",
  "transmissionUsername": "",
  "transmissionPassword": "",
  "aiEnabled": false,
  "aiBaseUrl": "https://api.openai.com/v1",
  "aiApiKey": "",
  "aiModel": "gpt-4o-mini",
  "aiTimeoutMs": 30000,
  "webSearchEnabled": false,
  "webSearchProvider": "serper",
  "webSearchBaseUrl": "https://google.serper.dev/search",
  "webSearchApiKey": "",
  "webSearchMaxResults": 5,
  "sites": []
}
EOF
    fi
  fi
  ${SUDO} chown -R "${RUN_USER}:${RUN_USER}" "${INSTALL_DIR}"
  if [[ -f "${INSTALL_DIR}/config.json" ]]; then
    ${SUDO} chmod 600 "${INSTALL_DIR}/config.json" || true
  fi
}

sync_project() {
  if [[ "${SOURCE_DIR}" == "${INSTALL_DIR}" ]]; then
    echo "当前目录已经是安装目录：${INSTALL_DIR}"
  else
    echo "源项目目录：${SOURCE_DIR}"
    echo "目标安装目录：${INSTALL_DIR}"
    backup_existing_data
    echo "开始同步项目文件到 ${INSTALL_DIR} ..."
    ${SUDO} mkdir -p "${INSTALL_DIR}"
    if command -v rsync >/dev/null 2>&1; then
      ${SUDO} rsync -a --delete \
        --exclude "node_modules" \
        --exclude ".git" \
        "${SOURCE_DIR}/" "${INSTALL_DIR}/"
    else
      TMP_DIR="$(mktemp -d)"
      trap 'rm -rf "${TMP_DIR}"' EXIT
      cp -a "${SOURCE_DIR}/." "${TMP_DIR}/"
      rm -rf "${TMP_DIR}/node_modules" "${TMP_DIR}/.git"
      ${SUDO} rm -rf "${INSTALL_DIR:?}/"*
      ${SUDO} cp -a "${TMP_DIR}/." "${INSTALL_DIR}/"
    fi
    restore_existing_data
  fi
  ensure_runtime_files
}

get_config_port() {
  if [[ -f "${INSTALL_DIR}/config.json" ]] && command -v python3 >/dev/null 2>&1; then
    python3 - <<PY
import json
try:
    with open('${INSTALL_DIR}/config.json', 'r', encoding='utf-8') as f:
        print(json.load(f).get('port', 3010))
except Exception:
    print(3010)
PY
  else
    echo 3010
  fi
}

deploy_code() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "代码部署需要 systemd，但未检测到 systemctl。"
    exit 1
  fi
  ensure_nodejs
  echo "安装目录：${INSTALL_DIR}"
  echo "运行用户：${RUN_USER}"
  echo "Node：$(command -v node)"
  echo "npm：$(command -v npm)"
  echo "安装项目依赖..."
  cd "${INSTALL_DIR}"
  npm install --omit=dev
  echo "检查服务语法..."
  npm run check
  echo "写入 systemd 服务：${SERVICE_FILE}"
  ${SUDO} tee "${SERVICE_FILE}" >/dev/null <<EOF
[Unit]
Description=NexusPHP Aggregate Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) ${INSTALL_DIR}/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
  if [[ -f "${INSTALL_DIR}/config.json" ]]; then
    chmod 600 "${INSTALL_DIR}/config.json" || true
  fi
  chmod 755 "${INSTALL_DIR}"
  ${SUDO} systemctl daemon-reload
  ${SUDO} systemctl enable "${SERVICE_NAME}"
  ${SUDO} systemctl restart "${SERVICE_NAME}"
  sleep 2
  ${SUDO} systemctl --no-pager --lines=20 status "${SERVICE_NAME}" || true
  echo "查看日志：sudo journalctl -u ${SERVICE_NAME} -f"
  echo "重启服务：sudo systemctl restart ${SERVICE_NAME}"
  echo "停止服务：sudo systemctl stop ${SERVICE_NAME}"
}

ensure_docker_network() {
  if ! ${SUDO} docker network inspect "${DOCKER_NETWORK}" >/dev/null 2>&1; then
    echo "创建 Docker 网络：${DOCKER_NETWORK}"
    ${SUDO} docker network create "${DOCKER_NETWORK}" >/dev/null
  else
    echo "Docker 网络已存在：${DOCKER_NETWORK}"
  fi
}

deploy_searxng_if_needed() {
  if [[ "${INSTALL_SEARXNG}" != "true" ]]; then
    return
  fi
  echo "安装/更新 SearXNG 网络搜索容器..."
  ${SUDO} mkdir -p "${SEARXNG_CONFIG_DIR}"
  if [[ ! -f "${SEARXNG_CONFIG_DIR}/settings.yml" ]]; then
    echo "写入 SearXNG 配置：${SEARXNG_CONFIG_DIR}/settings.yml"
    local searxng_secret
    if command -v openssl >/dev/null 2>&1; then
      searxng_secret="$(openssl rand -hex 32)"
    else
      searxng_secret="$(date +%s%N | sha256sum | awk '{print $1}')"
    fi
    ${SUDO} tee "${SEARXNG_CONFIG_DIR}/settings.yml" >/dev/null <<EOF
use_default_settings: true

server:
  bind_address: "0.0.0.0"
  port: 8080
  secret_key: "${searxng_secret}"
  limiter: false
  public_instance: false

search:
  formats:
    - html
    - json

ui:
  static_use_hash: true

redis:
  url: false
EOF
  else
    echo "SearXNG 配置已存在，保留：${SEARXNG_CONFIG_DIR}/settings.yml"
  fi
  ${SUDO} docker rm -f "${SEARXNG_CONTAINER}" >/dev/null 2>&1 || true
  ${SUDO} docker run -d \
    --name "${SEARXNG_CONTAINER}" \
    --restart unless-stopped \
    --network "${DOCKER_NETWORK}" \
    -v "${SEARXNG_CONFIG_DIR}:/etc/searxng" \
    "${SEARXNG_IMAGE}"
  echo "SearXNG 已启动。系统配置页推荐填写：http://${SEARXNG_CONTAINER}:8080/search"
}

deploy_docker() {
  install_docker
  ensure_docker_network
  deploy_searxng_if_needed
  PORT="$(get_config_port)"
  cd "${INSTALL_DIR}"
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
      ${SUDO} systemctl stop "${SERVICE_NAME}" || true
      ${SUDO} systemctl disable "${SERVICE_NAME}" || true
    fi
  fi
  echo "构建 Docker 镜像：${IMAGE_NAME}"
  ${SUDO} docker build -t "${IMAGE_NAME}" .
  echo "停止并删除旧容器：${SERVICE_NAME}"
  ${SUDO} docker rm -f "${SERVICE_NAME}" >/dev/null 2>&1 || true
  echo "启动 Docker 容器..."
  ${SUDO} docker run -d \
    --name "${SERVICE_NAME}" \
    --restart unless-stopped \
    --network "${DOCKER_NETWORK}" \
    -p "${PORT}:${PORT}" \
    -v "${INSTALL_DIR}/config.json:/app/config.json" \
    -v "${INSTALL_DIR}/data:/app/data" \
    "${IMAGE_NAME}"
  echo "容器状态："
  ${SUDO} docker ps --filter "name=${SERVICE_NAME}"
  echo "查看日志：sudo docker logs -f ${SERVICE_NAME}"
  echo "重启容器：sudo docker restart ${SERVICE_NAME}"
  echo "停止容器：sudo docker stop ${SERVICE_NAME}"
}

deploy_docker_restart() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "未检测到 Docker，无法执行快速更新。请先使用选项 2 完整安装 Docker 部署。"
    exit 1
  fi
  if ! ${SUDO} docker ps -a --format '{{.Names}}' | grep -qw "${SERVICE_NAME}"; then
    echo "未找到容器 ${SERVICE_NAME}，无法快速更新。请先使用选项 2 完整安装 Docker 部署。"
    exit 1
  fi
  local container_status
  container_status="$(${SUDO} docker inspect -f '{{.State.Running}}' "${SERVICE_NAME}" 2>/dev/null || echo "false")"
  echo "同步项目文件到 ${INSTALL_DIR} ..."
  sync_project
  echo "将更新的代码文件拷贝到容器 ${SERVICE_NAME} ..."
  ${SUDO} docker cp "${INSTALL_DIR}/server.js" "${SERVICE_NAME}:/app/server.js"
  ${SUDO} docker cp "${INSTALL_DIR}/public/." "${SERVICE_NAME}:/app/public/"
  ${SUDO} docker cp "${INSTALL_DIR}/package.json" "${SERVICE_NAME}:/app/package.json"
  if [[ "${container_status}" == "true" ]]; then
    echo "重启容器..."
    ${SUDO} docker restart "${SERVICE_NAME}"
  else
    echo "容器当前未运行，正在启动..."
    ${SUDO} docker start "${SERVICE_NAME}"
  fi
  sleep 2
  echo "容器状态："
  ${SUDO} docker ps --filter "name=${SERVICE_NAME}"
  echo "查看日志：sudo docker logs -f ${SERVICE_NAME}"
}

collect_install_options
install_base_packages

case "${DEPLOY_MODE}" in
  code)
    echo "部署方式：代码部署"
    sync_project
    deploy_code
    ;;
  docker)
    echo "部署方式：Docker 部署"
    sync_project
    deploy_docker
    ;;
  docker-restart)
    echo "部署方式：Docker 快速更新"
    deploy_docker_restart
    ;;
  *)
    echo "DEPLOY_MODE 只能是 code、docker 或 docker-restart。"
    exit 1
    ;;
esac

PORT="$(get_config_port)"
echo "部署完成。"
echo "安装目录：${INSTALL_DIR}"
echo "访问地址：http://服务器IP:${PORT}"
echo "订阅追番：http://服务器IP:${PORT}/"
echo "聚合搜索：http://服务器IP:${PORT}/search.html"
echo "AI 订阅助手：http://服务器IP:${PORT}/ai.html"
echo "系统配置：http://服务器IP:${PORT}/config.html"
