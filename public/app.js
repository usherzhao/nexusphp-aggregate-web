const subscriptionForm = document.querySelector("#subscriptionForm")
const parsePreview = document.querySelector("#parsePreview")
const subscriptionsElement = document.querySelector("#subscriptions")
const logsElement = document.querySelector("#logs")
const refreshButton = document.querySelector("#refreshButton")
const configStatus = document.querySelector("#configStatus .status-card-body")
const downloadDirOptions = document.querySelector("#downloadDirOptions")

let dashboard = null
let pollingTimer = null
let isLoadingDashboard = false

refreshButton.addEventListener("click", () => loadDashboard({ manual: true }))
subscriptionForm.addEventListener("submit", createSubscription)
subscriptionForm.elements.firstTitle.addEventListener("input", parseTitlePreview)

async function loadDashboard(options = {}) {
  if (isLoadingDashboard) {
    return
  }
  isLoadingDashboard = true
  try {
    const response = await fetch("/api/subscriptions")
    const data = await response.json()
    if (!response.ok || data.error) {
      throw new Error(data.error || "加载失败")
    }
    dashboard = data
    renderSiteOptions(data.config?.sites || [])
    renderStatus(data.config || {})
    renderSubscriptions(data.subscriptions || [])
    renderLogs(data.state?.logs || [])
    renderDownloadDirs(data.downloadDirs || [])
    applyQuerySubscriptionPayload()
    scheduleDashboardPolling(data.subscriptions || [])
  } catch (error) {
    if (options.manual) {
      alert(error.message)
    } else {
      throw error
    }
  } finally {
    isLoadingDashboard = false
  }
}

function scheduleDashboardPolling(subscriptions) {
  if (pollingTimer) {
    clearTimeout(pollingTimer)
    pollingTimer = null
  }
  const hasCheckingSubscription = subscriptions.some(subscription => subscription.checking)
  if (!hasCheckingSubscription) {
    return
  }
  pollingTimer = setTimeout(() => {
    loadDashboard().catch(error => {
      console.error(error)
      scheduleDashboardPolling(subscriptions)
    })
  }, 2000)
}

function renderSiteOptions(sites) {
  const enabledSites = sites.filter(site => site.enabled)
  subscriptionForm.elements.site.innerHTML = enabledSites.map(site => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)}</option>`).join("")
}

function renderStatus(config) {
  const sites = config.sites || []
  configStatus.innerHTML = `
    <div>站点：${sites.map(site => `${escapeHtml(site.name)} ${site.configured ? "已配置" : "未配置"}`).join(" / ") || "未配置"}</div>
    <div>自动下载：${config.downloadEnabled ? "已启用" : "已关闭"}</div>
    <div>检查前同步 Transmission：${config.syncTransmissionBeforeCheck ? "已启用" : "已关闭"}</div>
    <div>Transmission：${escapeHtml(config.transmissionUrl || "未配置")}</div>
    <div>全局检查间隔：${Math.round((config.checkIntervalMs || 0) / 60000)} 分钟</div>
  `
}

function renderDownloadDirs(dirs) {
  downloadDirOptions.innerHTML = dirs.map(dir => `<option value="${escapeHtml(dir)}"></option>`).join("")
}

async function parseTitlePreview() {
  const title = subscriptionForm.elements.firstTitle.value.trim()
  if (!title) {
    parsePreview.textContent = "填写第一集标题后会自动解析。"
    return
  }
  const response = await fetch("/api/parse-title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  })
  const data = await response.json()
  const parsed = data.parsed || {}
  parsePreview.innerHTML = `
    <strong>解析结果：</strong>
    剧名 ${escapeHtml(parsed.showName || "-")}；年份 ${escapeHtml(parsed.year || "-")}；季 ${escapeHtml(parsed.season || "-")}；集 ${escapeHtml(parsed.episodeText || "-")}；分辨率 ${escapeHtml(parsed.resolution || "-")}；发布组 ${escapeHtml(parsed.releaseGroup || "-")}；编码 ${escapeHtml(parsed.videoCodec || "-")}；音频 ${escapeHtml(parsed.audioCodec || "-")}
  `
}

async function createSubscription(event) {
  event.preventDefault()
  const button = subscriptionForm.querySelector("button[type='submit']")
  button.disabled = true
  button.textContent = "创建中..."
  try {
    const formData = new FormData(subscriptionForm)
    const payload = Object.fromEntries(formData.entries())
    const response = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok || data.error) {
      throw new Error(data.error || "创建失败")
    }
    subscriptionForm.reset()
    parsePreview.textContent = "订阅已创建。"
    clearQuerySubscriptionPayload()
    await loadDashboard()
  } catch (error) {
    parsePreview.textContent = error.message
  } finally {
    button.disabled = false
    button.textContent = "创建订阅"
  }
}

function renderSubscriptions(subscriptions) {
  if (!subscriptions.length) {
    subscriptionsElement.innerHTML = `<div class="empty-state">还没有订阅。可以到聚合搜索页查找候选标题，再带回这里创建订阅。</div>`
    return
  }
  subscriptionsElement.innerHTML = subscriptions.map(renderSubscription).join("")
}

function renderSubscription(subscription) {
  const intervalMinutes = Math.round((subscription.checkIntervalMs || 0) / 60000)
  return `
    <article class="subscription-card">
      <div class="subscription-summary">
        <div class="summary-main">
          <strong>${escapeHtml(subscription.searchName)}</strong>
          <span>${escapeHtml(subscription.siteName || subscription.site)} · ${escapeHtml(subscription.parsed?.season || "-")} · ${escapeHtml(subscription.parsed?.resolution || "-")} · ${escapeHtml(subscription.parsed?.releaseGroup || "-")}</span>
        </div>
        <div class="summary-status">${subscription.enabled ? "运行中" : "已暂停"}${subscription.checking ? " · 检查中" : ""}</div>
        <div class="summary-message">${escapeHtml(subscription.lastMessage || "-")}</div>
        <div class="summary-toggle">${escapeHtml(subscription.downloadedEpisodes?.join(", ") || "-")}</div>
      </div>
      <div class="subscription-body">
        <div class="subscription-title">模板：${escapeHtml(subscription.firstTitle)}</div>
        <div class="meta">
          <span>保存路径：${escapeHtml(subscription.downloadDir)}</span>
          <span>检查间隔：${intervalMinutes} 分钟</span>
          <span>上次检查：${formatTime(subscription.lastCheckAt)}</span>
        </div>
        <div class="subscription-settings">
          <label>
            <span>检查间隔（分钟）</span>
            <input id="interval-${escapeHtml(subscription.id)}" type="number" min="1" step="1" value="${intervalMinutes}">
          </label>
          <button type="button" class="secondary" onclick="updateSubscriptionInterval('${escapeAttr(subscription.id)}')">保存间隔</button>
          <button type="button" onclick="checkSubscription('${escapeAttr(subscription.id)}')">立即检查</button>
          ${subscription.enabled ? `<button type="button" class="secondary" onclick="stopSubscription('${escapeAttr(subscription.id)}')">暂停</button>` : `<button type="button" onclick="startSubscription('${escapeAttr(subscription.id)}')">启动</button>`}
          <button type="button" class="danger" onclick="deleteSubscription('${escapeAttr(subscription.id)}')">删除</button>
        </div>
        <details class="downloaded-details">
          <summary>已记录下载 ${subscription.downloadedEpisodeDetails?.length || 0} 项</summary>
          ${(subscription.downloadedEpisodeDetails || []).map(item => {
            const torrentHashMap = {}
            for (const torrent of (subscription.downloadedTorrents || [])) {
              const hash = torrent.result?.hashString || torrent.result?.["torrent-added"]?.hashString || torrent.result?.["torrent-duplicate"]?.hashString
              if (hash && !torrentHashMap[torrent.id]) {
                torrentHashMap[torrent.id] = hash
              }
            }
            const hash = torrentHashMap[item.torrentId]
            const ts = hash && dashboard?.transmissionStatus ? dashboard.transmissionStatus[hash] : null
            const percent = ts ? Math.round(ts.percentDone * 100) : null
            const finished = ts ? ts.isFinished : null
            let statusHtml = ""
            if (finished === true) {
              statusHtml = `<span class="torrent-status finished">已完成</span>`
            } else if (percent !== null) {
              statusHtml = `
                <div class="torrent-progress">
                  <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
                  <span class="progress-text">${percent}%</span>
                </div>`
            } else if (hash) {
              statusHtml = `<span class="torrent-status unknown">状态未知</span>`
            } else {
              statusHtml = `<span class="torrent-status no-torrent">无种子信息</span>`
            }
            return `
            <div class="downloaded-item">
              <span>${escapeHtml(item.season || "-")}</span>
              <span>${escapeHtml(item.episode || "-")}</span>
              <span>${escapeHtml(item.title || "-")}</span>
              ${statusHtml}
              <button type="button" class="secondary small-button" onclick='removeDownloadedEpisode(${JSON.stringify({ id: subscription.id, season: item.season || "", episode: item.episode || "" }).replace(/'/g, "&#39;")})'>移除记录</button>
            </div>`
          }).join("")}
        </details>
      </div>
    </article>
  `
}

function renderLogs(logs) {
  logsElement.innerHTML = logs.length ? logs.map(log => `
    <div class="log-item">
      <strong>${escapeHtml(log.action)}</strong> · ${formatTime(log.time)}<br>
      ${escapeHtml(log.message)}
    </div>
  `).join("") : `<div class="empty">暂无日志</div>`
}

function setSubscriptionCheckingState(id) {
  if (!dashboard?.subscriptions) {
    return
  }
  dashboard.subscriptions = dashboard.subscriptions.map(subscription => subscription.id === id
    ? { ...subscription, checking: true, lastMessage: "正在检查更新" }
    : subscription)
  renderSubscriptions(dashboard.subscriptions)
  scheduleDashboardPolling(dashboard.subscriptions)
}

async function postSubscriptionAction(id, action) {
  if (action === "check") {
    setSubscriptionCheckingState(id)
  }
  const response = await fetch(`/api/subscriptions/${encodeURIComponent(id)}/${action}`, { method: "POST" })
  const data = await response.json()
  if (!response.ok || data.error) {
    alert(data.error || "操作失败")
    return
  }
  await loadDashboard()
}

async function startSubscription(id) {
  await postSubscriptionAction(id, "start")
}

async function stopSubscription(id) {
  await postSubscriptionAction(id, "stop")
}

async function checkSubscription(id) {
  await postSubscriptionAction(id, "check")
  scheduleDashboardPolling([{ checking: true }])
}

async function updateSubscriptionInterval(id) {
  const input = document.querySelector(`#interval-${CSS.escape(id)}`)
  const response = await fetch(`/api/subscriptions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkIntervalMinutes: input?.value || "" })
  })
  const data = await response.json()
  if (!response.ok || data.error) {
    alert(data.error || "保存失败")
    return
  }
  await loadDashboard()
}

async function deleteSubscription(id) {
  if (!confirm("确定删除这个订阅吗？")) {
    return
  }
  const response = await fetch(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" })
  const data = await response.json()
  if (!response.ok || data.error) {
    alert(data.error || "删除失败")
    return
  }
  await loadDashboard()
}

async function removeDownloadedEpisode(payload) {
  if (!confirm(`确定移除 ${payload.season} ${payload.episode} 的已下载记录吗？`)) {
    return
  }
  const response = await fetch(`/api/subscriptions/${encodeURIComponent(payload.id)}/downloaded`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ season: payload.season, episode: payload.episode })
  })
  const data = await response.json()
  if (!response.ok || data.error) {
    alert(data.error || "移除失败")
    return
  }
  await loadDashboard()
}

function applyQuerySubscriptionPayload() {
  const params = new URLSearchParams(location.search)
  if (!params.has("site") && !params.has("firstTitle") && !params.has("searchName")) {
    return
  }
  if (params.get("site")) {
    subscriptionForm.elements.site.value = params.get("site")
  }
  if (params.get("searchName")) {
    subscriptionForm.elements.searchName.value = params.get("searchName")
  }
  if (params.get("firstTitle")) {
    subscriptionForm.elements.firstTitle.value = params.get("firstTitle")
    parseTitlePreview()
  }
  parsePreview.scrollIntoView({ behavior: "smooth", block: "center" })
}

function clearQuerySubscriptionPayload() {
  if (location.search) {
    history.replaceState(null, "", location.pathname)
  }
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-"
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]))
}

function escapeHtml(value) {
  return escapeAttr(value)
}

window.startSubscription = startSubscription
window.stopSubscription = stopSubscription
window.checkSubscription = checkSubscription
window.updateSubscriptionInterval = updateSubscriptionInterval
window.deleteSubscription = deleteSubscription
window.removeDownloadedEpisode = removeDownloadedEpisode

loadDashboard().catch(error => {
  configStatus.textContent = error.message
})
