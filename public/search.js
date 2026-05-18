const searchForm = document.querySelector("#searchForm")
const searchSites = document.querySelector("#searchSites")
const searchMessage = document.querySelector("#searchMessage")
const searchResults = document.querySelector("#searchResults")
const downloadDirOptions = document.querySelector("#downloadDirOptions")
const subscriptionResultModal = document.querySelector("#subscriptionResultModal")
const subscriptionResultModalTitle = document.querySelector("#subscriptionResultModalTitle")
const subscriptionResultModalMessage = document.querySelector("#subscriptionResultModalMessage")
const subscriptionResultModalCloseButton = document.querySelector("#subscriptionResultModalCloseButton")

let lastKeyword = ""

searchForm.addEventListener("submit", searchTorrents)

subscriptionResultModalCloseButton.addEventListener("click", closeSubscriptionResultModal)
subscriptionResultModal.addEventListener("click", event => {
  if (event.target === subscriptionResultModal) {
    closeSubscriptionResultModal()
  }
})

async function loadSearchConfig() {
  const response = await fetch("/api/subscriptions")
  const data = await response.json()
  if (!response.ok || data.error) {
    throw new Error(data.error || "加载站点失败")
  }
  renderSearchSites(data.config?.sites || [])
}

function renderSearchSites(sites) {
  const enabledSites = sites.filter(site => site.enabled)
  searchSites.innerHTML = `
    <legend>搜索站点</legend>
    ${enabledSites.map(site => `
      <label>
        <input type="checkbox" name="sites" value="${escapeHtml(site.id)}" checked>
        ${escapeHtml(site.name)}${site.configured ? "" : "（未配置 Cookie）"}
      </label>
    `).join("") || "<div>没有已启用站点，请先到系统配置添加。</div>"}
  `
}

async function searchTorrents(event) {
  event.preventDefault()
  const button = searchForm.querySelector("button[type='submit']")
  const formData = new FormData(searchForm)
  const keyword = String(formData.get("keyword") || "").trim()
  const sites = formData.getAll("sites")
  lastKeyword = keyword
  button.disabled = true
  button.textContent = "搜索中..."
  searchResults.innerHTML = ""
  searchMessage.textContent = "正在搜索站点并整理候选版本..."
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword, sites })
    })
    const data = await response.json()
    if (!response.ok || data.error) {
      throw new Error(data.error || "搜索失败")
    }
    renderSearchResults(data)
  } catch (error) {
    searchMessage.textContent = error.message
  } finally {
    button.disabled = false
    button.textContent = "搜索"
  }
}

function renderSearchResults(data) {
  const errors = data.errors || []
  const groups = data.groups || []
  const errorText = errors.length ? `；部分站点失败：${errors.map(error => `${error.siteName}: ${error.message}`).join("；")}` : ""
  searchMessage.textContent = `共搜索到 ${data.total || 0} 条种子，整理出 ${groups.length} 个候选版本${errorText}`
  if (!groups.length) {
    searchResults.innerHTML = `<div class="empty-state">没有找到可解析的候选版本，请换关键词或检查站点配置。</div>`
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
  searchResults.innerHTML = [...siteMap.entries()].map(([site, siteGroup]) => `
    <details class="site-group">
      <summary class="site-group-summary">${escapeHtml(siteGroup.siteName)}（${siteGroup.groups.length} 个候选版本）</summary>
      <div class="site-group-content">
        ${siteGroup.groups.map(group => renderCandidateGroup(group)).join("")}
      </div>
    </details>
  `).join("")
}

function renderCandidateGroup(group) {
  const episodes = group.episodes || []
  const episodeSummary = episodes.length > 12 ? `${episodes.slice(0, 6).join(", ")} ... ${episodes.slice(-3).join(", ")}` : episodes.join(", ")
  return `
    <article class="candidate-card">
      <div class="candidate-main">
        <h3>${escapeHtml(group.displayName || "未解析标题")}</h3>
        <p>${escapeHtml(group.siteName)} · 已找到 ${group.episodeCount || 0} 集</p>
        <p>集数：${escapeHtml(episodeSummary || "-")}</p>
      </div>
      <details class="candidate-titles">
        <summary>查看标题</summary>
        <ul class="candidate-title-list">
          ${(group.titles || []).map(item => renderSearchTitle(group, item)).join("")}
        </ul>
      </details>
      <a class="button-link" href="${buildSubscriptionUrl({ site: group.site, searchName: lastKeyword, firstTitle: group.firstTitle })}">按首个标题带回订阅页</a>
    </article>
  `
}

function renderSearchTitle(group, item) {
  const payload = JSON.stringify({ site: group.site, siteName: group.siteName, sourceId: item.sourceId, title: item.title, detailUrl: item.detailUrl }).replace(/'/g, "&#39;")
  const seedersBadge = item.seeders != null ? `<span class="seeders-badge" title="做种数">🔥${escapeHtml(item.seeders)}</span>` : ""
  return `
    <li class="candidate-title-item">
      <div>
        <strong>${escapeHtml(item.parsed?.episodeText || "-")}</strong> · <a href="${escapeHtml(item.detailUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>${seedersBadge}
      </div>
      <div class="candidate-title-actions">
        <a class="button-link secondary small-button" href="${buildSubscriptionUrl({ site: group.site, searchName: lastKeyword, firstTitle: item.title })}">带回订阅页</a>
        <button type="button" class="secondary small-button" onclick='downloadSingleTorrent(${payload})'>仅下载</button>
      </div>
    </li>
  `
}

function buildSubscriptionUrl(payload) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) {
    if (value) {
      params.set(key, value)
    }
  }
  return `/?${params.toString()}`
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

function showSubscriptionResultModal(title, message, type = "success") {
  subscriptionResultModalTitle.textContent = title
  subscriptionResultModalMessage.textContent = message
  subscriptionResultModalMessage.className = `modal-message ${type}`
  subscriptionResultModal.hidden = false
}

function closeSubscriptionResultModal() {
  subscriptionResultModal.hidden = true
}

async function downloadSingleTorrent(item) {
  if (!confirm(`确定仅下载以下种子到 Transmission 吗？\n\n${item.title}\n站点：${item.siteName}`)) {
    return
  }
  const formData = new FormData(searchForm)
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
    searchMessage.textContent = `${data.message}：${data.title}`
    await loadDownloadDirs()
  } catch (error) {
    showSubscriptionResultModal("下载失败", error.message, "error")
  }
}

async function loadDownloadDirs() {
  try {
    const response = await fetch("/api/subscriptions")
    const data = await response.json()
    downloadDirOptions.innerHTML = (data.downloadDirs || [])
      .filter(Boolean)
      .map(dir => `<option value="${escapeHtml(dir)}"></option>`)
      .join("")
  } catch (error) {
    console.error(error)
  }
}

async function initSearch() {
  try {
    await loadSearchConfig()
    await loadDownloadDirs()
  } catch (error) {
    searchMessage.textContent = error.message
  }
}

initSearch()
