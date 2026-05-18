# NexusPHP 聚合查询助手

聚合多个 NexusPHP 站点的搜索、订阅追番、AI 智能推荐，并通过 Transmission 自动下载。

## 功能

- **聚合搜索** — 同时搜索多个 NexusPHP 站点，按标题模板自动分组候选版本
- **订阅追番** — 设置第一集标题模板，定时检查并自动下载后续集数
- **AI 订阅助手** — 自然语言描述需求，AI 解析标题并搜索匹配种子（支持联网搜索）
- **Transmission 自动下载** — 匹配到的种子自动推送到 Transmission
- **多站点管理** — 在配置页统一管理所有 NexusPHP 站点的 Cookie 和参数

## 页面说明

| 页面 | 路径 | 说明 |
|------|------|------|
| 订阅追番 | `/` | 订阅列表、新建订阅、运行日志 |
| 聚合搜索 | `/search.html` | 多站点关键词搜索、单个种子下载 |
| AI 助手 | `/ai.html` | 自然语言订阅、AI 推荐候选 |
| 系统配置 | `/config.html` | 站点管理、Transmission、AI、网络搜索配置 |

## 环境要求

- **Node.js** >= 18（需要内置 `fetch` 支持）
- **Transmission** — 需要已安装并启用 RPC 的 Transmission 客户端
- **NexusPHP 站点账号** — 需要在目标站点注册并获取登录 Cookie

## 安装

### 方式一：直接运行

```bash
git clone <仓库地址> nexusphp-aggregate-web
cd nexusphp-aggregate-web
npm install
cp config.example.json config.json
# 编辑 config.json 填写配置（见下方说明）
npm start
```

默认监听 `http://localhost:3001`。

### 方式二：Linux 一键部署（推荐）

```bash
sudo bash deploy-systemd.sh
```

脚本会以交互方式引导完成部署，依次询问：

1. **部署方式** — 选择代码部署、Docker 部署或 Docker 快速更新
2. **安装目录** — 默认 `/opt/nexusphp-aggregate-web`
3. **服务名称** — 默认 `nexusphp-aggregate-web`
4. **运行用户** — 默认当前登录用户
5. **是否安装 SearXNG** — 可选的网络搜索容器

脚本会自动检测环境并安装所需依赖（Node.js、Docker 等），完成配置后启动服务。

> **Docker 快速更新**：如果已经部署过 Docker 模式，选择此项可以直接更新代码并重启容器，无需重新构建镜像。

## 配置说明

配置文件为 `config.json`，首次运行前请从 `config.example.json` 复制：

```bash
cp config.example.json config.json
```

### 基本配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `port` | `3001` | Web 服务监听端口 |
| `timeoutMs` | `60000` | HTTP 请求超时（毫秒） |
| `checkIntervalMs` | `600000` | 订阅自动检查间隔（默认 10 分钟） |
| `searchMaxPages` | `5` | 每个站点最大搜索页数 |
| `downloadEnabled` | `true` | 是否启用自动下载 |

### 站点配置

可在后台管理直接配置或者在 `sites` 数组中添加 NexusPHP 站点：

```json
{
  "sites": [
    {
      "id": "pthome",
      "name": "PTHOME",
      "siteUrl": "https://www.pthome.net/",
      "cookie": "你的站点Cookie",
      "enabled": true
    }
  ]
}
```

**获取 Cookie 的方法：**

1. 用浏览器登录目标 NexusPHP 站点
2. 按 `F12` 打开开发者工具 → `Network`（网络）标签
3. 刷新页面，点击任意请求
4. 在 `Request Headers` 中找到 `Cookie:` 后面的完整内容
5. 复制粘贴到 `config.json` 的 `cookie` 字段

> **注意：** Cookie 有效期有限，如果搜索报错"Cookie 可能已失效"，需要重新登录并更新 Cookie。

也可以在 Web 配置页面 (`/config.html`) 中在线添加和编辑站点，无需手动编辑 JSON 文件。

### Transmission 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `transmissionUrl` | `http://127.0.0.1:9091/transmission/rpc` | Transmission RPC 地址 |
| `transmissionUsername` | `""` | 用户名（留空表示无认证） |
| `transmissionPassword` | `""` | 密码 |
| `syncTransmissionBeforeCheck` | `true` | 检查前先同步已下���种子状态 |
| `transmissionNetworkFailureAsSuccess` | `false` | Transmission 连接失败时是否视为成功 |

> **注意：** `transmissionUrl` 必须是完整的 RPC 路径，通常以 `/transmission/rpc` 结尾。

### AI 助手配置（可选）

启用后可使用 AI 订阅助手页面，通过自然语言描述需求来搜索和创建订阅。

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `aiEnabled` | `false` | 是否启用 AI 助手 |
| `aiBaseUrl` | `https://api.openai.com/v1` | AI API 地址（兼容 OpenAI 格式的任何服务） |
| `aiApiKey` | `""` | AI API Key |
| `aiModel` | `gpt-4o-mini` | 模型名称 |
| `aiTimeoutMs` | `30000` | AI 请求超时（毫秒） |

> **注意：** `aiBaseUrl` 支持任何兼容 OpenAI Chat Completions API 格式的服务，如 OpenAI、Azure OpenAI、DeepSeek、Ollama 等。填写对应服务商提供的 API 地址和 Key 即可。

### 网络搜索配置（可选）

配合 AI 助手使用，支持"最新剧"、"某演员最新作品"等实时信息查询。

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `webSearchEnabled` | `false` | 是否启用网络搜索 |
| `webSearchProvider` | `serper` | 搜索服务提供商（`serper` 或 `searxng`） |
| `webSearchBaseUrl` | `https://google.serper.dev/search` | 搜索 API 地址 |
| `webSearchApiKey` | `""` | 搜索 API Key |
| `webSearchMaxResults` | `5` | 单次搜索最大结果数 |

**Serper 配置：**

- 注册 [serper.dev](https://serper.dev/) 获取 API Key
- `webSearchBaseUrl` 保持默认即可

**SearXNG 自建配置：**

- 参考 [SearXNG 文档](https://docs.searxng.org/) 部署实例
- `webSearchBaseUrl` 填写你的 SearXNG 实例地址，如 `http://localhost:8888/search`
- `webSearchApiKey` 留空
- 需在 SearXNG 的 `settings.yml` 中设置 `format: json`

## 使用重置脚本

如需清空所有数据和配置，恢复初始状态：

```bash
# Linux
bash reset.sh

# Windows
.\reset.ps1
```

脚本会确认后清空 `config.json`、`data/subscriptions.json`、`data/state.json`，并从 `config.example.json` 重建默认配置。

## 依赖的开源项目

| 项目 | 用途 |
|------|------|
| [Node.js](https://nodejs.org/) | 运行环境 |
| [Transmission](https://transmissionbt.com/) | BT 下载客户端 |
| [OpenAI API](https://platform.openai.com/docs/) / 兼容服务 | AI 助手功能 |
| [Serper](https://serper.dev/) 或 [SearXNG](https://docs.searxng.org/) | 网络搜索（AI 助手可选） |

## 常见问题

**Q: 搜索结果为空？**
A: 检查站点 Cookie 是否已过期，以及站点是否可正常访问。

**Q: 种子下载失败？**
A: 检查 Transmission 是否在运行、RPC 地址是否正确、是否有认证信息。

**Q: AI 助手无响应？**
A: 检查 `aiEnabled` 是否为 `true`，API Key 和地址是否正确。可在配置页点击"测试 AI 配置"验证。

**Q: 订阅一直不下载？**
A: 确认订阅已点击"开始"，Transmission 可正常连接，且站点 Cookie 有效。

## 项目结构

```
nexusphp-aggregate-web/
├── server.js              # 后端服务入口
├── config.json            # 运行时配置（从 config.example.json 复制）
├── config.example.json    # 配置示例
├── package.json
├── Dockerfile
├── deploy-systemd.sh      # Linux 一键部署脚本
├── reset.sh / reset.ps1   # 初始化重置脚本
├── data/                  # 运行时数据目录
│   ├── subscriptions.json # 订阅数据
│   └── state.json         # 运行状态和日志
└── public/                # 前端静态文件
    ├── index.html         # 订阅追番页
    ├── search.html        # 聚合搜索页
    ├── ai.html            # AI 订阅助手页
    ├── config.html        # 系统配置页
    ├── app.js             # 订阅页逻辑
    ├── search.js          # 搜索页逻辑
    ├── ai.js              # AI 助手逻辑
    ├── config.js          # 配置页逻辑
    └── style.css          # 全局样式
```

## License

MIT
