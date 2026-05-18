const configForm = document.querySelector("#configForm")
const sitesEditor = document.querySelector("#sitesEditor")
const saveButton = document.querySelector("#saveButton")
const reloadButton = document.querySelector("#reloadButton")
const addSiteButton = document.querySelector("#addSiteButton")
const testTransmissionButton = document.querySelector("#testTransmissionButton")
const configMessage = document.querySelector("#configMessage")

const CONFIG_FIELDS = [
  { key: "port", label: "服务端口", type: "number", group: "服务", help: "Web 服务监听端口，修改后需要重启服务。" },
  { key: "timeoutMs", label: "请求超时（毫秒）", type: "number", group: "服务", help: "访问 NexusPHP 站点和下载种子的超时时间。" },
  { key: "userAgent", label: "User-Agent", type: "textarea", group: "服务", help: "请求 NexusPHP 页面时使用的浏览器 UA。" },
  { key: "checkIntervalMs", label: "全局检查间隔（毫秒）", type: "number", group: "订阅", help: "订阅默认检查间隔。单个订阅可在首页覆盖。" },
  { key: "searchMaxPages", label: "搜索最大页数", type: "number", group: "订阅", help: "每个站点搜索时最多翻多少页。" },
  { key: "downloadEnabled", label: "启用自动下载", type: "boolean", group: "Transmission", help: "开启后发现新集会下载种子并提交到 Transmission。关闭时只记录发现更新。" },
  { key: "syncTransmissionBeforeCheck", label: "检查前同步 Transmission", type: "boolean", group: "Transmission", help: "检查前读取已完成任务，避免重复下载。" },
  { key: "transmissionNetworkFailureAsSuccess", label: "Transmission 网络失败默认成功", type: "boolean", group: "Transmission", help: "网络不可达时不阻断订阅检查。" },
  { key: "transmissionUrl", label: "Transmission RPC 地址", type: "text", group: "Transmission", help: "例如 http://127.0.0.1:9091/transmission/rpc。" },
  { key: "transmissionUsername", label: "Transmission 用户名", type: "text", group: "Transmission", help: "未开启认证可留空。" },
  { key: "transmissionPassword", label: "Transmission 密码", type: "password", group: "Transmission", help: "未开启认证可留空。" },
  { key: "aiEnabled", label: "启用 AI 助手", type: "boolean", group: "AI 助手", help: "开启后 /ai.html 可调用 OpenAI-compatible 模型解析自然语言订阅需求。" },
  { key: "aiBaseUrl", label: "AI API 地址", type: "text", group: "AI 助手", help: "OpenAI-compatible API 根地址，例如 https://api.openai.com/v1 或 https://api.deepseek.com/v1。" },
  { key: "aiApiKey", label: "AI API Key", type: "password", group: "AI 助手", help: "模型服务 API Key。仅保存在本机 config.json。" },
  { key: "aiModel", label: "AI 模型名", type: "text", group: "AI 助手", help: "例如 gpt-4o-mini、deepseek-chat、qwen-plus 等。" },
  { key: "aiTimeoutMs", label: "AI 请求超时（毫秒）", type: "number", group: "AI 助手", help: "调用模型接口的超时时间。" },
  { key: "webSearchEnabled", label: "启用网络搜索", type: "boolean", group: "网络搜索", help: "开启后 AI 遇到最新、热播、演员最新作品等实时问题时会先调用网络搜索。" },
  { key: "webSearchProvider", label: "搜索服务", type: "text", group: "网络搜索", help: "支持 serper 或 searxng。" },
  { key: "webSearchBaseUrl", label: "搜索 API 地址", type: "text", group: "网络搜索", help: "Serper 默认 https://google.serper.dev/search；SearXNG 示例 http://127.0.0.1:8080/search。" },
  { key: "webSearchApiKey", label: "搜索 API Key", type: "password", group: "网络搜索", help: "Serper 需要填写，SearXNG 通常可留空。" },
  { key: "webSearchMaxResults", label: "搜索结果数量", type: "number", group: "网络搜索", help: "传给 AI 的网络搜索结果数量，建议 5。" }
]

let currentConfig = {}

reloadButton.addEventListener("click", loadConfig)
saveButton.addEventListener("click", saveConfig)
addSiteButton.addEventListener("click", addSite)
testTransmissionButton.addEventListener("click", testTransmission)

async function loadConfig() {
  setMessage("正在加载配置...", "info")
  const response = await fetch("/api/config")
  const data = await response.json()
  if (!response.ok || data.error) {
    setMessage(data.error || "加载配置失败", "error")
    return
  }
  currentConfig = data.config || {}
  renderConfigForm(currentConfig)
  renderSites(currentConfig.sites || [])
  setMessage("配置已加载。", "success")
}

function renderConfigForm(config) {
  const groups = groupFields(CONFIG_FIELDS)
  configForm.innerHTML = Object.entries(groups).map(([group, fields], index) => `
    <details class="config-group" ${index === 0 ? "open" : ""}>
      <summary class="config-group-title">${escapeHtml(group)}</summary>
      ${renderGroupActions(group)}
      <div class="config-grid">
        ${fields.map(field => renderField(field, config[field.key])).join("")}
      </div>
    </details>
  `).join("")
}

function renderGroupActions(group) {
  if (group === "AI 助手") {
    return `
      <div class="config-group-actions">
        <button type="button" class="secondary" onclick="testAiConnection()">测试 AI 配置</button>
        <span id="aiTestMessage" class="inline-test-message"></span>
      </div>
    `
  }
  if (group === "网络搜索") {
    return `
      <div class="config-group-actions">
        <button type="button" class="secondary" onclick="testWebSearchConnection()">测试网络搜索</button>
        <span id="webSearchTestMessage" class="inline-test-message"></span>
      </div>
    `
  }
  return ""
}

function renderSites(sites, openIndex = -1) {
  sitesEditor.innerHTML = sites.map((site, index) => `
    <details class="site-editor-card" data-site-index="${index}" ${index === openIndex ? "open" : ""}>
      <summary class="site-editor-summary">
        <span class="site-editor-title">${escapeHtml(site.name || site.id || `站点 ${index + 1}`)}</span>
        <span class="site-editor-meta">${escapeHtml(site.siteUrl || "未填写站点地址")} · ${site.enabled ? "已启用" : "已禁用"}</span>
      </summary>
      <div class="site-editor-body">
        <div class="site-editor-header">
          <strong>站点配置</strong>
          <div class="actions">
            <button type="button" class="secondary" onclick="testSite(${index})">测试连接</button>
            <button type="button" class="danger" onclick="removeSite(${index})">删除</button>
          </div>
        </div>
        <div class="config-grid">
          <label class="config-field">
            <span class="field-label">站点 ID</span>
            <input name="id" value="${escapeHtml(site.id || "")}" autocomplete="off">
          </label>
          <label class="config-field">
            <span class="field-label">站点名称</span>
            <input name="name" value="${escapeHtml(site.name || "")}" autocomplete="off">
          </label>
          <label class="config-field wide">
            <span class="field-label">站点地址</span>
            <input name="siteUrl" value="${escapeHtml(site.siteUrl || "")}" autocomplete="off" placeholder="https://example.com/">
          </label>
          <label class="config-field wide">
            <span class="field-label">Cookie</span>
            <textarea name="cookie" rows="4" placeholder="从浏览器请求头复制 Cookie">${escapeHtml(site.cookie || "")}</textarea>
          </label>
          <label class="config-field boolean-field">
            <span class="field-label">启用站点</span>
            <input name="enabled" type="checkbox" ${site.enabled ? "checked" : ""}>
          </label>
        </div>
        <div class="inline-test-message" id="siteTestMessage-${index}"></div>
      </div>
    </details>
  `).join("") || `<div class="empty-state">暂无站点，请添加 NexusPHP 站点。</div>`
}

function groupFields(fields) {
  return fields.reduce((groups, field) => {
    groups[field.group] = groups[field.group] || []
    groups[field.group].push(field)
    return groups
  }, {})
}

function renderField(field, value) {
  const safeValue = value ?? ""
  if (field.type === "boolean") {
    return `
      <label class="config-field boolean-field">
        ${renderLabel(field)}
        <input name="${escapeHtml(field.key)}" type="checkbox" ${safeValue ? "checked" : ""}>
      </label>
    `
  }
  if (field.type === "textarea") {
    return `
      <label class="config-field wide">
        ${renderLabel(field)}
        <textarea name="${escapeHtml(field.key)}" rows="3">${escapeHtml(safeValue)}</textarea>
      </label>
    `
  }
  return `
    <label class="config-field">
      ${renderLabel(field)}
      <input name="${escapeHtml(field.key)}" type="${field.type}" value="${escapeHtml(safeValue)}" autocomplete="off">
    </label>
  `
}

function renderLabel(field) {
  return `
    <span class="field-label">
      ${escapeHtml(field.label)}
      <span class="help-icon" title="${escapeHtml(field.help)}" aria-label="${escapeHtml(field.help)}">?</span>
    </span>
  `
}

function addSite() {
  currentConfig.sites = [
    ...(currentConfig.sites || []),
    { id: `site${(currentConfig.sites || []).length + 1}`, name: "新站点", siteUrl: "", cookie: "", enabled: true }
  ]
  renderSites(currentConfig.sites, currentConfig.sites.length - 1)
}

function removeSite(index) {
  currentConfig.sites = readSitesFromForm().filter((site, siteIndex) => siteIndex !== index)
  renderSites(currentConfig.sites)
}

async function testSite(index) {
  const config = buildPayload()
  const site = config.sites[index]
  setInlineMessage(`siteTestMessage-${index}`, "正在测试...", "info")
  const response = await fetch("/api/config/test/site", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...config, siteId: site?.id })
  })
  const data = await response.json()
  setInlineMessage(`siteTestMessage-${index}`, data.message || (data.ok ? "连接成功" : "连接失败"), data.ok ? "success" : "error")
}

async function testTransmission() {
  const payload = buildPayload()
  setMessage("正在测试 Transmission...", "info")
  const response = await fetch("/api/config/test/transmission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  })
  const data = await response.json()
  setMessage(data.message || (data.ok ? "连接成功" : "连接失败"), data.ok ? "success" : "error")
}

async function testAiConnection() {
  await testConnection("/api/config/test/ai", "aiTestMessage", "正在测试 AI 配置...")
}

async function testWebSearchConnection() {
  await testConnection("/api/config/test/web-search", "webSearchTestMessage", "正在测试网络搜索...")
}

async function testConnection(url, messageElementId, loadingMessage) {
  setInlineMessage(messageElementId, loadingMessage, "info")
  const payload = buildPayload()
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok || data.error) {
      throw new Error(data.error || "连接测试失败")
    }
    setInlineMessage(messageElementId, data.message || (data.ok ? "连接成功" : "连接失败"), data.ok ? "success" : "error")
  } catch (error) {
    setInlineMessage(messageElementId, error.message, "error")
  }
}

async function saveConfig() {
  const payload = buildPayload()
  saveButton.disabled = true
  saveButton.textContent = "保存中..."
  try {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok || data.error) {
      throw new Error(data.error || "保存失败")
    }
    currentConfig = data.config || payload
    renderConfigForm(currentConfig)
    renderSites(currentConfig.sites || [])
    setMessage(data.restartRecommended ? "配置已保存。端口变更需要重启服务。" : "配置已保存并生效。", "success")
  } catch (error) {
    setMessage(error.message, "error")
  } finally {
    saveButton.disabled = false
    saveButton.textContent = "保存配置"
  }
}

function buildPayload() {
  const payload = { ...currentConfig }
  for (const field of CONFIG_FIELDS) {
    const element = configForm.elements[field.key]
    if (!element) {
      continue
    }
    if (field.type === "boolean") {
      payload[field.key] = element.checked
    } else if (field.type === "number") {
      payload[field.key] = Number(element.value)
    } else {
      payload[field.key] = element.value
    }
  }
  payload.sites = readSitesFromForm()
  return payload
}

function readSitesFromForm() {
  return [...sitesEditor.querySelectorAll(".site-editor-card")].map(card => ({
    id: card.querySelector('[name="id"]').value.trim(),
    name: card.querySelector('[name="name"]').value.trim(),
    siteUrl: card.querySelector('[name="siteUrl"]').value.trim(),
    cookie: card.querySelector('[name="cookie"]').value,
    enabled: card.querySelector('[name="enabled"]').checked
  }))
}

function setMessage(message, type = "info") {
  configMessage.textContent = message
  configMessage.className = `config-message ${type}`
}

function setInlineMessage(id, message, type = "info") {
  const element = document.querySelector(`#${CSS.escape(id)}`)
  if (!element) {
    return
  }
  element.textContent = message
  element.className = `inline-test-message ${type}`
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]))
}

window.testSite = testSite
window.removeSite = removeSite
window.testAiConnection = testAiConnection
window.testWebSearchConnection = testWebSearchConnection

loadConfig()
