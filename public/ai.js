const aiForm = document.querySelector("#aiAssistForm")
const aiStatus = document.querySelector("#aiStatus")
const aiMessage = document.querySelector("#aiMessage")
const intentPreview = document.querySelector("#intentPreview")
const aiCandidateResults = document.querySelector("#aiCandidateResults")
const downloadDirOptions = document.querySelector("#downloadDirOptions")
const aiChatHistory = document.querySelector("#aiChatHistory")
const clearAiContextButton = document.querySelector("#clearAiContextButton")
const subscriptionResultModal = document.querySelector("#subscriptionResultModal")
const subscriptionResultModalTitle = document.querySelector("#subscriptionResultModalTitle")
const subscriptionResultModalMessage = document.querySelector("#subscriptionResultModalMessage")
const subscriptionResultModalCloseButton = document.querySelector("#subscriptionResultModalCloseButton")
let lastAiKeyword = ""
let lastIntent = {}
let chatTurns = []

subscriptionResultModalCloseButton.addEventListener("click", closeSubscriptionResultModal)
subscriptionResultModal.addEventListener("click", event => {
  if (event.target === subscriptionResultModal) {
    closeSubscriptionResultModal()
  }
})

clearAiContextButton.addEventListener("click", () => {
  lastIntent = {}
  chatTurns = []
  lastAiKeyword = ""
  renderChatHistory()
  intentPreview.textContent = "暂无解析结果。"
  aiMessage.textContent = "上下文已清空。"
})

aiForm.addEventListener("submit", async event => {
  event.preventDefault()
  const button = aiForm.querySelector("button[type='submit']")
  button.disabled = true
  button.textContent = "AI 分析中..."
  aiCandidateResults.innerHTML = ""
  try {
    const formData = new FormData(aiForm)
    const message = String(formData.get("message") || "").trim()
    aiMessage.textContent = "正在调用 AI 解析意图，并搜索候选版本..."
    const response = await fetch("/api/ai/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, lastIntent })
    })
    const data = await response.json()
    if (!response.ok || data.error) {
      throw new Error(data.error || "AI 助手搜索失败")
    }
    lastAiKeyword = data.keyword || data.intent?.title || data.intent?.keyword || message
    lastIntent = data.intent || {}
    chatTurns.push({ user: message, intent: lastIntent })
    renderChatHistory()
    renderIntent(lastIntent)
    renderAiCandidates(data)
  } catch (error) {
    aiMessage.textContent = error.message
  } finally {
    button.disabled = false
    button.textContent = "AI 解析并搜索"
  }
})

async function loadAiStatus() {
  const response = await fetch("/api/ai/status")
  const status = await response.json()
  aiStatus.innerHTML = `
    <summary>AI 状态</summary>
    <div class="status-card-body">
      <div>启用：${status.enabled ? "是" : "否"}</div>
      <div>API Key：${status.configured ? "已配置" : "未配置"}</div>
      <div>模型：${escapeHtml(status.model || "-")}</div>
      <div>接口：${escapeHtml(status.baseUrl || "-")}</div>
    </div>
  `
}

async function loadDownloadDirs() {
  const response = await fetch("/api/subscriptions")
  const data = await response.json()
  downloadDirOptions.innerHTML = (data.downloadDirs || [])
    .filter(Boolean)
    .map(dir => `<option value="${escapeHtml(dir)}"></option>`)
    .join("")
}

function renderChatHistory() {
  if (!chatTurns.length) {
    aiChatHistory.innerHTML = `<div class="empty-state">当前没有上下文。你可以连续输入，例如先说“帮我订阅低智商犯罪”，再说“要 2025 年 2160p，不要合集”。</div>`
    return
  }
  aiChatHistory.innerHTML = chatTurns.map((turn, index) => `
    <div class="ai-chat-turn">
      <div class="ai-chat-user">第 ${index + 1} 轮：${escapeHtml(turn.user)}</div>
      <div class="ai-chat-intent">${renderIntentSummary(turn.intent)}</div>
    </div>
  `).join("")
}

function renderIntentSummary(intent) {
  return [
    intent.title || intent.keyword,
    intent.year,
    intent.resolution,
    intent.videoCodec,
    intent.audioCodec,
    intent.source,
    intent.releaseGroup,
    intent.excludeCompletePack ? "不要合集" : "",
    (intent.sites || []).length ? `站点：${intent.sites.join(", ")}` : ""
  ].filter(Boolean).map(escapeHtml).join(" / ") || "未识别"
}

function renderIntent(intent) {
  intentPreview.innerHTML = `
    <div>关键词：${escapeHtml(intent.keyword || intent.title || "-")}</div>
    <div>需要联网：${intent.needsWebSearch ? "是" : "否"}</div>
    <div>联网搜索词：${escapeHtml(intent.webSearchQuery || "-")}</div>
    <div>年份：${escapeHtml(intent.year || "-")}</div>
    <div>分辨率：${escapeHtml(intent.resolution || "-")}</div>
    <div>视频编码：${escapeHtml(intent.videoCodec || "-")}</div>
    <div>音频：${escapeHtml(intent.audioCodec || "-")}</div>
    <div>来源：${escapeHtml(intent.source || "-")}</div>
    <div>发布组：${escapeHtml(intent.releaseGroup || "-")}</div>
    <div>排除合集：${intent.excludeCompletePack ? "是" : "否"}</div>
    <div>站点：${escapeHtml((intent.sites || []).join(", ") || "默认全部")}</div>
  `
}

function renderAiCandidates(data) {
  const errors = data.errors || []
  const skipped = data.siteSelection?.skipped || []
  const groups = data.groups || []
  const skippedText = skipped.length ? `；已跳过未配置站点：${skipped.map(item => item.siteName).join("、")}` : ""
  const errorText = errors.length ? `；部分站点失败：${errors.map(error => `${error.siteName}: ${error.message}`).join("；")}` : ""
  aiMessage.textContent = `AI 已解析意图，搜索到 ${data.totalTorrents || 0} 条种子，整理出 ${groups.length} 个候选版本${skippedText}${errorText}`
  const webResolutionHtml = renderWebResolution(data.webResolution)
  const titleAnalysisHtml = renderAiTitleAnalysis(data.aiTitleAnalysis)
  if (!groups.length) {
    aiCandidateResults.innerHTML = `${webResolutionHtml}${titleAnalysisHtml}<div class="empty-state">没有可创建剧集订阅的候选版本，请查看上方 AI 标题分析候选。</div>`
    return
  }
  const siteMap = new Map()
  for (const group of groups) {
    const site = group.site || "unknown"
    if (!siteMap.has(site)) {
      siteMap.set(site, { siteName: group.siteName || site, groups: [] })
    }
    siteMap.get(site).groups.push(group)
  }
  const siteGroupsHtml = [...siteMap.entries()].map(([site, siteGroup]) => `
    <details class="site-group">
      <summary class="site-group-summary">${escapeHtml(siteGroup.siteName)}（${siteGroup.groups.length} 个候选版本）</summary>
      <div class="site-group-content">
        ${siteGroup.groups.map(group => renderAiCandidateCard(group)).join("")}
      </div>
    </details>
  `).join("")
  aiCandidateResults.innerHTML = webResolutionHtml + titleAnalysisHtml + siteGroupsHtml
}

function renderWebResolution(webResolution) {
  if (!webResolution || (!webResolution.used && !webResolution.resolved && !webResolution.results?.length)) {
    return ""
  }
  const results = webResolution.results || []
  return `
    <section class="ai-title-analysis web-resolution-card">
      <h3>联网检索</h3>
      <p>${escapeHtml(webResolution.reason || "-")}</p>
      <p>搜索词：${escapeHtml(webResolution.query || "-")}</p>
      ${webResolution.resolved?.title ? `<p>推断片名：<strong>${escapeHtml(webResolution.resolved.title)}</strong>${webResolution.resolved.year ? ` / ${escapeHtml(webResolution.resolved.year)}` : ""}</p>` : ""}
      ${results.length ? `
        <ul class="raw-title-list">
          ${results.map(item => `
            <li>
              <div>
                ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(item.title || item.url)}</strong></a>` : `<strong>${escapeHtml(item.title || "-")}</strong>`}
                <div>${escapeHtml(item.snippet || "-")}</div>
              </div>
            </li>
          `).join("")}
        </ul>
      ` : ""}
    </section>
  `
}

function renderAiTitleAnalysis(analysis) {
  if (!analysis) {
    return ""
  }
  const movieCandidates = analysis.movieCandidates || []
  const seriesCandidates = analysis.seriesCandidates || []
  return `
    <section class="ai-title-analysis">
      <h3>AI 标题分析：${escapeHtml(formatAnalysisMode(analysis.mode))}</h3>
      <p>${escapeHtml(analysis.summary || "-")}</p>
      ${renderRawTitleCandidateBlock("电影/剧场版候选", movieCandidates)}
      ${renderRawTitleCandidateBlock("连续剧/动画剧集候选", seriesCandidates)}
      <p class="range-warning">电影/剧场版候选当前仅用于识别展示，订阅创建仍以带集数的连续剧候选为准。</p>
    </section>
  `
}

function renderRawTitleCandidateBlock(title, candidates) {
  if (!candidates.length) {
    return ""
  }
  return `
    <div class="raw-title-block">
      <h4>${escapeHtml(title)}</h4>
      <ul class="raw-title-list">
        ${candidates.map(item => `
          <li>
            <div>
              <strong>${escapeHtml(item.siteName)}</strong> · ${renderTitleLink(item.title, item.detailUrl)}
              <div>${escapeHtml(item.reason)}</div>
            </div>
          </li>
        `).join("")}
      </ul>
    </div>
  `
}

function formatAnalysisMode(mode) {
  if (mode === "movie") return "更像电影/剧场版"
  if (mode === "series") return "更像连续剧/动画剧集"
  if (mode === "mixed") return "可能同时包含电影和剧集"
  return "未知"
}

function renderAiCandidateCard(group) {
  const episodes = group.episodes || []
  const episodeSummary = episodes.length > 12 ? `${episodes.slice(0, 6).join(", ")} ... ${episodes.slice(-3).join(", ")}` : episodes.join(", ")
  return `
    <article class="candidate-card">
      <div class="candidate-main">
        <h3>${escapeHtml(group.displayName)}</h3>
        <p>${escapeHtml(group.siteName)} · ${escapeHtml(group.year || "年份未知")} · ${escapeHtml(group.season || "-")} · 已找到 ${group.episodeCount || 0} 集 · AI 分数 ${group.aiScore ?? 0}</p>
        <p>推荐理由：${escapeHtml((group.aiReasons || []).join("；"))}</p>
        <p>集数：${escapeHtml(episodeSummary || "-")}</p>
        <p>第一集模板：${renderTitleLink(group.firstTitle, group.firstDetailUrl)}</p>
      </div>
      <details class="candidate-titles">
        <summary>查看匹配标题</summary>
        <ul class="candidate-title-list">
          ${(group.titles || []).map(item => renderCandidateTitleItem(group, item)).join("")}
        </ul>
      </details>
      <button type="button" onclick='createSubscriptionFromAiCandidate(${encodeCandidatePayload(group)})'>按第一集模板创建订阅</button>
    </article>
  `
}

function renderCandidateTitleItem(group, item) {
  const titlePayload = { ...group, firstTitle: item.title }
  const seedersBadge = item.seeders != null ? `<span class="seeders-badge" title="做种数">🔥${escapeHtml(item.seeders)}</span>` : ""
  return `
    <li class="candidate-title-item ${item.isRange ? "range-title" : ""}">
      <div>
        <strong>${escapeHtml(item.episodeText || "-")}</strong> · ${renderTitleLink(item.title, item.detailUrl)}${seedersBadge}
        ${item.isRange ? `<div class="range-warning">范围标题：创建订阅后会把 ${escapeHtml(item.episodeText)} 记录为已下载。</div>` : ""}
      </div>
      <div class="candidate-title-actions">
        <button type="button" class="secondary small-button" onclick='createSubscriptionFromAiCandidate(${encodeCandidatePayload(titlePayload)})'>使用此标题创建订阅</button>
        <button type="button" class="secondary small-button" onclick='downloadSingleTorrent(${encodeCandidatePayload({ site: group.site, siteName: group.siteName, sourceId: item.sourceId, title: item.title, detailUrl: item.detailUrl })})'>仅下载</button>
      </div>
    </li>
  `
}

function showSubscriptionResultModal(title, message, type = "success") {
  subscriptionResultModalTitle.textContent = title
  subscriptionResultModalMessage.textContent = message
  subscriptionResultModalMessage.className = `modal-message ${type}`
  subscriptionResultModal.hidden = false
}

function closeSubscriptionResultModal() {
  subscriptionResultModal.hidden = true
}

async function createSubscriptionFromAiCandidate(group) {
  const formData = new FormData(aiForm)
  const downloadDir = String(formData.get("downloadDir") || "").trim()
  if (!downloadDir) {
    alert("请先填写 Transmission 保存路径")
    return
  }
  const payload = {
    site: group.site,
    searchName: lastAiKeyword || group.firstTitle,
    firstTitle: group.firstTitle,
    downloadDir,
    checkIntervalMinutes: String(formData.get("checkIntervalMinutes") || "").trim()
  }
  const response = await fetch("/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  })
  const data = await response.json()
  if (!response.ok || data.error) {
    const message = data.error || "创建订阅失败"
    showSubscriptionResultModal("创建订阅失败", message, "error")
    aiMessage.textContent = message
    return
  }
  const successMessage = `已创建订阅：${payload.searchName} / ${group.siteName} / ${group.displayName}`
  showSubscriptionResultModal("创建订阅成功", successMessage, "success")
  aiMessage.textContent = successMessage
  await loadDownloadDirs()
}

async function downloadSingleTorrent(item) {
  if (!confirm(`确定仅下载以下种子到 Transmission 吗？\n\n${item.title}\n站点：${item.siteName}`)) {
    return
  }
  const formData = new FormData(aiForm)
  const downloadDir = String(formData.get("downloadDir") || "").trim()
  if (!downloadDir) {
    alert("请先填写 Transmission 保存路径")
    return
  }
  try {
    const response = await fetch("/api/ai/movie/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        site: item.site,
        sourceId: item.sourceId,
        title: item.title,
        detailUrl: item.detailUrl,
        downloadDir
      })
    })
    const data = await response.json()
    if (!response.ok || data.error) {
      throw new Error(data.error || "下载提交失败")
    }
    showSubscriptionResultModal("下载已提交", `${data.message}：${data.title}`, "success")
    aiMessage.textContent = `${data.message}：${data.title}`
    await loadDownloadDirs()
  } catch (error) {
    showSubscriptionResultModal("下载失败", error.message, "error")
  }
}

function encodeCandidatePayload(value) {
  return JSON.stringify(value).replace(/'/g, "&#39;")
}

function renderTitleLink(title, detailUrl) {
  if (!detailUrl) {
    return escapeHtml(title)
  }
  return `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
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

window.createSubscriptionFromAiCandidate = createSubscriptionFromAiCandidate
Promise.all([loadAiStatus(), loadDownloadDirs()]).catch(error => {
  aiMessage.textContent = error.message
})
