import http from "node:http"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import crypto from "node:crypto"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, "data")
const PUBLIC_DIR = path.join(__dirname, "public")
const CONFIG_FILE = path.join(__dirname, "config.json")
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, "subscriptions.json")
const STATE_FILE = path.join(DATA_DIR, "state.json")

const DEFAULT_CONFIG = {
  port: 3001,
  timeoutMs: 60000,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  checkIntervalMs: 10 * 60 * 1000,
  searchMaxPages: 5,
  downloadEnabled: true,
  syncTransmissionBeforeCheck: true,
  transmissionNetworkFailureAsSuccess: false,
  transmissionUrl: "http://127.0.0.1:9091/transmission/rpc",
  transmissionUsername: "",
  transmissionPassword: "",
  aiEnabled: false,
  aiBaseUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  aiTimeoutMs: 30000,
  webSearchEnabled: false,
  webSearchProvider: "serper",
  webSearchBaseUrl: "https://google.serper.dev/search",
  webSearchApiKey: "",
  webSearchMaxResults: 5,
  sites: [
    {
      id: "pthome",
      name: "PTHOME",
      siteUrl: "https://www.pthome.net/",
      cookie: "",
      enabled: true
    },
    {
      id: "btschool",
      name: "BTSCHOOL",
      siteUrl: "https://pt.btschool.club/",
      cookie: "",
      enabled: true
    }
  ]
}

let CONFIG = await loadConfig()
const activeChecks = new Set()

await ensureDataFiles()
startScheduler()

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (url.pathname === "/api/config" && request.method === "GET") {
      await sendJson(response, await getEditableConfig())
      return
    }
    if (url.pathname === "/api/config" && request.method === "PUT") {
      const body = await readJsonBody(request)
      await sendJson(response, await saveEditableConfig(body))
      return
    }
    if (url.pathname === "/api/config/test/site" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, await testNexusConnection(body))
      return
    }
    if (url.pathname === "/api/config/test/transmission" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, await testTransmissionConnection(body))
      return
    }
    if (url.pathname === "/api/subscriptions" && request.method === "GET") {
      await sendJson(response, await getDashboardData())
      return
    }
    if (url.pathname === "/api/subscriptions" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, { subscription: await createSubscription(body) })
      return
    }
    if (url.pathname === "/api/search" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, await aggregateSearch(body))
      return
    }
    if (url.pathname === "/api/ai/status" && request.method === "GET") {
      await sendJson(response, getAiStatus())
      return
    }
    if (url.pathname === "/api/ai/assist" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, await searchAiAssistantCandidates(body))
      return
    }
    if (url.pathname === "/api/ai/movie/download" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, await downloadAiMovieCandidate(body))
      return
    }
    if (url.pathname === "/api/config/test/ai" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, await testAiConnection(body))
      return
    }
    if (url.pathname === "/api/config/test/web-search" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, await testWebSearchConnection(body))
      return
    }
    if (url.pathname === "/api/parse-title" && request.method === "POST") {
      const body = await readJsonBody(request)
      await sendJson(response, { parsed: parseEpisodeTitle(String(body.title || "")) })
      return
    }
    const startMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)\/start$/)
    if (startMatch && request.method === "POST") {
      await startSubscription(startMatch[1])
      runCheck(startMatch[1]).catch(error => appendLog(startMatch[1], "检查失败", error.message))
      await sendJson(response, { ok: true })
      return
    }
    const stopMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)\/stop$/)
    if (stopMatch && request.method === "POST") {
      await stopSubscription(stopMatch[1])
      await sendJson(response, { ok: true })
      return
    }
    const checkMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)\/check$/)
    if (checkMatch && request.method === "POST") {
      runCheck(checkMatch[1]).catch(error => appendLog(checkMatch[1], "检查失败", error.message))
      await sendJson(response, { ok: true })
      return
    }
    const updateMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)$/)
    if (updateMatch && request.method === "PATCH") {
      const body = await readJsonBody(request)
      await updateSubscriptionSettings(updateMatch[1], body)
      await sendJson(response, { ok: true })
      return
    }
    const downloadedDeleteMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)\/downloaded$/)
    if (downloadedDeleteMatch && request.method === "DELETE") {
      const body = await readJsonBody(request)
      await removeDownloadedEpisodeRecord(downloadedDeleteMatch[1], body)
      await sendJson(response, { ok: true })
      return
    }
    const deleteMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)$/)
    if (deleteMatch && request.method === "DELETE") {
      await deleteSubscription(deleteMatch[1])
      await sendJson(response, { ok: true })
      return
    }
    await serveStatic(url.pathname, response)
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" })
    response.end(JSON.stringify({ error: sanitizeErrorMessage(error.message) }))
  }
})

server.listen(CONFIG.port, () => {
  console.log(`NexusPHP 聚合查询助手已启动：http://localhost:${CONFIG.port}`)
})

async function loadConfig() {
  const config = await readJsonFile(CONFIG_FILE, DEFAULT_CONFIG)
  return normalizeConfig(config)
}

function normalizeConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    port: Number(config.port ?? DEFAULT_CONFIG.port),
    timeoutMs: Number(config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs),
    checkIntervalMs: Number(config.checkIntervalMs ?? DEFAULT_CONFIG.checkIntervalMs),
    searchMaxPages: Number(config.searchMaxPages ?? DEFAULT_CONFIG.searchMaxPages),
    aiTimeoutMs: Number(config.aiTimeoutMs ?? DEFAULT_CONFIG.aiTimeoutMs),
    webSearchMaxResults: Number(config.webSearchMaxResults ?? DEFAULT_CONFIG.webSearchMaxResults),
    downloadEnabled: Boolean(config.downloadEnabled ?? DEFAULT_CONFIG.downloadEnabled),
    syncTransmissionBeforeCheck: Boolean(config.syncTransmissionBeforeCheck ?? DEFAULT_CONFIG.syncTransmissionBeforeCheck),
    transmissionNetworkFailureAsSuccess: Boolean(config.transmissionNetworkFailureAsSuccess ?? DEFAULT_CONFIG.transmissionNetworkFailureAsSuccess),
    aiEnabled: Boolean(config.aiEnabled ?? DEFAULT_CONFIG.aiEnabled),
    webSearchEnabled: Boolean(config.webSearchEnabled ?? DEFAULT_CONFIG.webSearchEnabled),
    sites: normalizeSites(config.sites)
  }
}

function normalizeSites(sites) {
  const source = Array.isArray(sites) && sites.length ? sites : DEFAULT_CONFIG.sites
  const used = new Set()
  return source.map((site, index) => {
    const fallbackId = `site${index + 1}`
    const rawId = String(site.id || site.name || fallbackId).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || fallbackId
    const id = used.has(rawId) ? `${rawId}-${index + 1}` : rawId
    used.add(id)
    return {
      id,
      name: String(site.name || id).trim() || id,
      siteUrl: String(site.siteUrl || "").trim().replace(/\/$/, ""),
      cookie: String(site.cookie || ""),
      enabled: Boolean(site.enabled ?? true)
    }
  })
}

async function ensureDataFiles() {
  await mkdir(DATA_DIR, { recursive: true })
  if (!existsSync(CONFIG_FILE)) {
    await writeJsonFile(CONFIG_FILE, CONFIG)
  }
  if (!existsSync(SUBSCRIPTIONS_FILE)) {
    await writeJsonFile(SUBSCRIPTIONS_FILE, [])
  }
  if (!existsSync(STATE_FILE)) {
    await writeJsonFile(STATE_FILE, { logs: [] })
  }
}

function startScheduler() {
  setInterval(() => {
    checkDueSubscriptions().catch(error => console.error(error.message))
  }, 60 * 1000)
  setTimeout(() => {
    checkDueSubscriptions().catch(error => console.error(error.message))
  }, 3000)
}

async function getEditableConfig() {
  return {
    config: CONFIG,
    defaults: DEFAULT_CONFIG,
    restartRequiredKeys: ["port"],
    runtimeReloadableKeys: ["timeoutMs", "userAgent", "checkIntervalMs", "searchMaxPages", "downloadEnabled", "syncTransmissionBeforeCheck", "transmissionNetworkFailureAsSuccess", "transmissionUrl", "transmissionUsername", "transmissionPassword", "aiEnabled", "aiBaseUrl", "aiApiKey", "aiModel", "aiTimeoutMs", "webSearchEnabled", "webSearchProvider", "webSearchBaseUrl", "webSearchApiKey", "webSearchMaxResults", "sites"]
  }
}

async function saveEditableConfig(input) {
  const current = await readJsonFile(CONFIG_FILE, CONFIG)
  const merged = normalizeConfig({ ...current, ...input })
  const changedKeys = Object.keys(merged).filter(key => JSON.stringify(merged[key]) !== JSON.stringify(CONFIG[key]))
  await writeJsonFile(CONFIG_FILE, merged)
  CONFIG = merged
  return {
    ok: true,
    config: CONFIG,
    changedKeys,
    restartRecommended: changedKeys.includes("port")
  }
}

async function getDashboardData() {
  const subscriptions = await readSubscriptions()
  const transmissionStatus = await getTransmissionStatusMap()
  return {
    subscriptions,
    state: await readState(),
    transmissionStatus,
    downloadDirs: [...new Set(subscriptions.map(subscription => subscription.downloadDir).filter(Boolean))],
    config: {
      sites: CONFIG.sites.map(site => ({
        id: site.id,
        name: site.name,
        siteUrl: site.siteUrl,
        enabled: site.enabled,
        configured: Boolean(site.cookie)
      })),
      checkIntervalMs: CONFIG.checkIntervalMs,
      downloadEnabled: CONFIG.downloadEnabled,
      syncTransmissionBeforeCheck: CONFIG.syncTransmissionBeforeCheck,
      transmissionUrl: CONFIG.transmissionUrl,
      transmissionConfigured: Boolean(CONFIG.transmissionUrl)
    }
  }
}

async function createSubscription(body) {
  const site = normalizeSubscriptionSite(body.site)
  const searchName = String(body.searchName || "").trim()
  const firstTitle = String(body.firstTitle || "").trim()
  const downloadDir = String(body.downloadDir || "").trim()
  const checkIntervalMs = normalizeSubscriptionInterval(body.checkIntervalMinutes)
  if (!site) {
    throw new Error("请选择有效站点")
  }
  if (!searchName || !firstTitle || !downloadDir) {
    throw new Error("站点、剧名、第一集标题和保存路径都不能为空")
  }
  const parsed = parseEpisodeTitle(firstTitle)
  if (!parsed.season || !parsed.startEpisode) {
    throw new Error("第一集标题无法解析出季或集数")
  }
  const now = new Date().toISOString()
  const subscription = {
    id: crypto.randomUUID(),
    site,
    siteName: getSiteConfig(site)?.name || site,
    searchName,
    firstTitle,
    downloadDir,
    checkIntervalMs,
    parsed,
    versionFingerprint: buildVersionFingerprint(firstTitle),
    titleMatchKey: buildTitleMatchKey(firstTitle),
    downloadedEpisodes: buildInitialDownloadedEpisodes(parsed),
    downloadedEpisodeDetails: buildInitialDownloadedEpisodeDetails(parsed, firstTitle, now),
    downloadedTorrents: [],
    enabled: false,
    checking: false,
    lastCheckAt: null,
    lastMessage: "已创建，未开始执行",
    createdAt: now,
    updatedAt: now
  }
  const subscriptions = await readSubscriptions()
  subscriptions.unshift(subscription)
  await writeSubscriptions(subscriptions)
  await appendLog(subscription.id, "创建订阅", `${subscription.siteName} ${searchName} ${parsed.season} ${parsed.episodeText}`)
  return subscription
}

async function startSubscription(id) {
  await updateSubscription(id, subscription => ({
    ...subscription,
    enabled: true,
    lastMessage: "已开始执行，等待检查",
    updatedAt: new Date().toISOString()
  }))
  await appendLog(id, "开始执行", "订阅已生效")
}

async function stopSubscription(id) {
  await updateSubscription(id, subscription => ({
    ...subscription,
    enabled: false,
    checking: false,
    lastMessage: "已暂停",
    updatedAt: new Date().toISOString()
  }))
  await appendLog(id, "暂停订阅", "订阅已暂停")
}

async function updateSubscriptionSettings(id, body) {
  const checkIntervalMs = normalizeSubscriptionInterval(body.checkIntervalMinutes)
  await updateSubscription(id, subscription => ({
    ...subscription,
    checkIntervalMs,
    updatedAt: new Date().toISOString()
  }))
  await appendLog(id, "更新订阅设置", `检查间隔：${Math.round(checkIntervalMs / 60000)} 分钟`)
}

async function deleteSubscription(id) {
  const subscriptions = await readSubscriptions()
  await writeSubscriptions(subscriptions.filter(subscription => subscription.id !== id))
  await appendLog(id, "删除订阅", "已删除")
}

async function removeDownloadedEpisodeRecord(id, body) {
  const season = String(body.season || "").trim()
  const episode = String(body.episode || "").trim()
  if (!season || !episode) {
    throw new Error("季和集数不能为空")
  }
  await updateSubscription(id, subscription => {
    const downloadedEpisodeDetails = (subscription.downloadedEpisodeDetails || []).filter(item => !(item.season === season && item.episode === episode))
    const remainingEpisodes = new Set(downloadedEpisodeDetails.map(item => item.episode))
    return {
      ...subscription,
      downloadedEpisodes: (subscription.downloadedEpisodes || []).filter(item => item !== episode || remainingEpisodes.has(item)),
      downloadedEpisodeDetails,
      updatedAt: new Date().toISOString()
    }
  })
  await appendLog(id, "删除已下载记录", `${season} ${episode}`)
}

function normalizeSubscriptionInterval(minutes) {
  const value = Number(minutes)
  if (Number.isFinite(value) && value > 0) {
    return Math.round(value * 60 * 1000)
  }
  return CONFIG.checkIntervalMs
}

async function checkDueSubscriptions() {
  const subscriptions = await readSubscriptions()
  const now = Date.now()
  for (const subscription of subscriptions) {
    if (!subscription.enabled || subscription.checking) {
      continue
    }
    const intervalMs = Number(subscription.checkIntervalMs || CONFIG.checkIntervalMs)
    const lastCheckAt = subscription.lastCheckAt ? new Date(subscription.lastCheckAt).getTime() : 0
    if (!lastCheckAt || now - lastCheckAt >= intervalMs) {
      runCheck(subscription.id).catch(error => appendLog(subscription.id, "检查失败", error.message))
    }
  }
}

async function runCheck(id) {
  if (activeChecks.has(id)) {
    return
  }
  activeChecks.add(id)
  try {
    await updateSubscription(id, subscription => ({ ...subscription, checking: true, lastMessage: "正在检查更新" }))
    const subscriptions = await readSubscriptions()
    const subscription = subscriptions.find(item => item.id === id)
    if (!subscription) {
      return
    }
    await appendLog(id, "开始检查", `${subscription.siteName || subscription.site} ${subscription.searchName}`)
    if (CONFIG.syncTransmissionBeforeCheck) {
      await syncTransmissionDownloadedEpisodes(id)
    }
    const refreshedSubscriptions = await readSubscriptions()
    const refreshedSubscription = refreshedSubscriptions.find(item => item.id === id) || subscription
    const matches = await searchUpdatedTorrents(refreshedSubscription)
    if (!matches.length) {
      await updateSubscription(id, item => ({ ...item, checking: false, lastCheckAt: new Date().toISOString(), lastMessage: "没有发现新集" }))
      await appendLog(id, "检查完成", "没有发现新集")
      return
    }
    if (!CONFIG.downloadEnabled) {
      await updateSubscription(id, item => ({
        ...item,
        checking: false,
        lastCheckAt: new Date().toISOString(),
        lastMessage: `发现 ${matches.length} 个更新：${matches.map(match => match.parsed.episodeText).join(", ")}`
      }))
      for (const match of matches) {
        await appendLog(id, "发现更新", match.title)
      }
      return
    }
    const addedMatches = []
    for (const match of matches) {
      const latestSubscriptions = await readSubscriptions()
      const latestSubscription = latestSubscriptions.find(item => item.id === id)
      if (!latestSubscription || isEpisodeDownloaded(latestSubscription, match.parsed)) {
        continue
      }
      const downloadRequest = getTorrentDownloadRequest(match)
      const addResult = await addTorrentToTransmission(downloadRequest, subscription.downloadDir)
      await markEpisodeDownloaded(id, match, addResult)
      addedMatches.push(match)
      await appendLog(id, "已提交下载", `${match.title} -> ${subscription.downloadDir}`)
    }
    const message = addedMatches.length ? `已添加 ${addedMatches.length} 个更新：${addedMatches.map(match => match.parsed.episodeText).join(", ")}` : "没有发现新集"
    await updateSubscription(id, item => ({ ...item, checking: false, lastCheckAt: new Date().toISOString(), lastMessage: message }))
  } catch (error) {
    await updateSubscription(id, subscription => ({ ...subscription, checking: false, lastCheckAt: new Date().toISOString(), lastMessage: error.message }))
    await appendLog(id, "检查失败", error.message)
    throw error
  } finally {
    activeChecks.delete(id)
  }
}

async function aggregateSearch(body) {
  const keyword = String(body.keyword || "").trim()
  const requestedSites = Array.isArray(body.sites) ? body.sites : []
  if (!keyword) {
    throw new Error("请输入搜索关键词")
  }
  const sites = CONFIG.sites.filter(site => site.enabled && (!requestedSites.length || requestedSites.includes(site.id)))
  const results = []
  const errors = []
  for (const site of sites) {
    try {
      const torrents = await searchNexusTorrents(site.id, keyword)
      results.push(...torrents.map(torrent => ({
        ...torrent,
        parsed: parseEpisodeTitle(torrent.title)
      })))
    } catch (error) {
      errors.push({ site: site.id, siteName: site.name, message: error.message })
    }
  }
  return {
    keyword,
    total: results.length,
    results: results.sort((a, b) => `${a.siteName}-${a.title}`.localeCompare(`${b.siteName}-${b.title}`)),
    groups: groupSearchResults(results),
    errors
  }
}

function groupSearchResults(results) {
  const groups = new Map()
  for (const item of results) {
    const parsed = item.parsed || parseEpisodeTitle(item.title)
    const titleMatchKey = buildTitleMatchKey(item.title)
    const key = [item.site, titleMatchKey].join("|")
    const group = groups.get(key) || {
      key,
      titleMatchKey,
      site: item.site,
      siteName: item.siteName,
      displayName: buildSearchGroupDisplayName(item, parsed),
      episodes: [],
      titles: []
    }
    if (parsed.episodeText && !group.episodes.includes(parsed.episodeText)) {
      group.episodes.push(parsed.episodeText)
    }
    group.titles.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({
    ...group,
    episodeCount: group.episodes.length,
    episodes: group.episodes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    firstTitle: group.titles.sort((a, b) => (a.parsed?.startEpisode || 0) - (b.parsed?.startEpisode || 0))[0]?.title || ""
  })).sort((a, b) => b.episodeCount - a.episodeCount || a.displayName.localeCompare(b.displayName))
}

function buildSearchGroupDisplayName(item, parsed) {
  const normalizedTitle = normalizeComparableTitle(removeEpisodeMarker(item.title))
  const profile = [parsed.year, parsed.season, parsed.resolution, parsed.videoCodec, parsed.audioCodec, parsed.releaseGroup].filter(Boolean).join(" · ")
  return profile ? `${normalizedTitle} · ${profile}` : normalizedTitle
}

async function searchUpdatedTorrents(subscription) {
  const torrents = await searchNexusTorrents(subscription.site, subscription.searchName)
  const seen = new Set()
  return torrents
    .map(torrent => ({
      id: torrent.id,
      site: torrent.site,
      siteName: torrent.siteName,
      sourceId: torrent.sourceId,
      title: torrent.title,
      detailUrl: torrent.detailUrl,
      parsed: parseEpisodeTitle(torrent.title)
    }))
    .filter(candidate => isWantedCandidate(subscription, candidate))
    .sort((a, b) => a.parsed.startEpisode - b.parsed.startEpisode)
    .filter(candidate => {
      const key = `${candidate.parsed.season}-${candidate.parsed.startEpisode}-${candidate.parsed.endEpisode}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}

function getAiStatus() {
  return {
    enabled: Boolean(CONFIG.aiEnabled),
    configured: Boolean(CONFIG.aiApiKey),
    baseUrl: CONFIG.aiBaseUrl,
    model: CONFIG.aiModel
  }
}

async function testAiConnection(input) {
  const testConfig = normalizeConfig({ ...CONFIG, ...input })
  if (!testConfig.aiEnabled) {
    return { ok: false, message: "AI 助手未启用" }
  }
  if (!testConfig.aiApiKey) {
    return { ok: false, message: "AI API Key 为空" }
  }
  if (!testConfig.aiBaseUrl || !testConfig.aiModel) {
    return { ok: false, message: "AI API 地址或模型名为空" }
  }
  const result = await callAiJson([
    { role: "system", content: "只输出 JSON，格式为 {\"ok\": true, \"message\": \"pong\"}。" },
    { role: "user", content: "请返回 pong" }
  ], testConfig)
  return { ok: true, message: `AI 配置可用：${result.message || "pong"}` }
}

async function testWebSearchConnection(input) {
  const testConfig = normalizeConfig({ ...CONFIG, ...input })
  if (!testConfig.webSearchEnabled) {
    return { ok: false, message: "网络搜索未启用" }
  }
  const results = await searchWebWithConfig("最新热播电视剧", testConfig)
  return {
    ok: true,
    message: `网络搜索可用，返回 ${results.length} 条结果${results[0]?.title ? `，第一条：${results[0].title}` : ""}`,
    count: results.length,
    first: results[0] || null
  }
}

async function searchAiAssistantCandidates(body) {
  if (!CONFIG.aiEnabled || !CONFIG.aiApiKey) {
    throw new Error("AI 助手未启用或未配置 API Key，请先在系统配置页配置 AI 助手")
  }
  const message = String(body.message || "").trim()
  if (!message) {
    throw new Error("请输入你想订阅的内容")
  }
  const lastIntent = normalizeAiIntent(body.lastIntent || {})
  const intent = await parseAiSubscriptionIntent(message, lastIntent)
  const webResolution = await maybeResolveIntentWithWebSearch(message, intent)
  const resolvedIntent = webResolution.intent
  const keyword = resolvedIntent.title || resolvedIntent.keyword || message
  const siteSelection = selectAiSearchSites(resolvedIntent.sites?.length ? resolvedIntent.sites : body.sites)
  const rawTorrents = await searchAiRawTorrents(keyword, siteSelection.sites)
  const candidates = buildSmartCandidateResult(keyword, resolvedIntent.year || body.year, siteSelection.sites, rawTorrents.results, rawTorrents.errors)
  const aiTitleAnalysis = await analyzeAiRawTitles(message, resolvedIntent, rawTorrents.results)
  return {
    message,
    lastIntent,
    intent: resolvedIntent,
    originalIntent: intent,
    webResolution,
    siteSelection,
    aiTitleAnalysis,
    ...rankAiCandidateGroups(candidates, resolvedIntent)
  }
}

async function downloadAiMovieCandidate(body) {
  const site = normalizeSubscriptionSite(body.site)
  const sourceId = String(body.sourceId || "").trim()
  const title = String(body.title || "").trim()
  const downloadDir = String(body.downloadDir || "").trim()
  if (!sourceId || !title || !downloadDir) {
    throw new Error("电影标题、种子 ID 和保存路径都不能为空")
  }
  if (!site) {
    throw new Error(`未找到站点 "${body.site}" 的配置，请检查站点 ID 是否正确`)
  }
  const siteConfig = getSiteConfig(site)
  if (!siteConfig) {
    throw new Error(`未找到站点 ${site} 的配置`)
  }
  if (!siteConfig.enabled) {
    throw new Error(`${siteConfig.name} 已禁用`)
  }
  if (!siteConfig.cookie) {
    throw new Error(`${siteConfig.name} 未配置 Cookie，无法获取下载链接`)
  }
  const detailUrl = body.detailUrl || `${siteConfig.siteUrl.replace(/\/$/, "")}/details.php?id=${sourceId}`
  const downloadRequest = getTorrentDownloadRequest({ site, sourceId })
  const addResult = await addTorrentToTransmission(downloadRequest, downloadDir)
  const added = addResult["torrent-added"] || addResult["torrent-duplicate"]
  return {
    ok: true,
    message: addResult.skipped ? "已跳过（Transmission 网络不可达）" : (added ? "已提交到 Transmission" : "已提交"),
    title,
    site,
    siteName: siteConfig.name,
    sourceId,
    downloadDir,
    duplicate: Boolean(addResult["torrent-duplicate"]),
    skipped: Boolean(addResult.skipped)
  }
}

async function maybeResolveIntentWithWebSearch(message, intent) {
  if (!intent.needsWebSearch) {
    return { used: false, reason: "AI 判断不需要联网搜索", intent, results: [], resolved: null }
  }
  if (!CONFIG.webSearchEnabled) {
    return { used: false, reason: "AI 判断需要联网搜索，但网络搜索未启用", intent, results: [], resolved: null }
  }
  const query = intent.webSearchQuery || intent.keyword || intent.title || message
  const results = await searchWebWithConfig(query, CONFIG)
  if (!results.length) {
    return { used: true, reason: "未获取到网络搜索结果", query, intent, results, resolved: null }
  }
  const resolved = await resolveIntentFromWebResults(message, intent, query, results)
  const resolvedIntent = normalizeAiIntent({ ...intent, ...resolved, keyword: resolved.title || intent.keyword, title: resolved.title || intent.title })
  return { used: true, reason: resolved.reason || "已根据网络搜索结果推断片名", query, intent: resolvedIntent, results, resolved }
}

async function searchWebWithConfig(query, config = CONFIG) {
  const provider = String(config.webSearchProvider || "serper").toLowerCase()
  if (provider === "searxng") {
    return searchWebWithSearxng(query, config)
  }
  return searchWebWithSerper(query, config)
}

async function searchWebWithSerper(query, config = CONFIG) {
  if (!config.webSearchApiKey) {
    throw new Error("网络搜索 API Key 为空，请在系统配置页填写 Serper API Key")
  }
  const response = await fetchWithTimeout(config.webSearchBaseUrl || "https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-KEY": config.webSearchApiKey
    },
    body: JSON.stringify({ q: query, gl: "cn", hl: "zh-cn", num: config.webSearchMaxResults || 5 })
  }, config.timeoutMs)
  const data = await response.json()
  return normalizeWebSearchResults([...(data.organic || []), ...(data.news || [])], config)
}

async function searchWebWithSearxng(query, config = CONFIG) {
  const baseUrl = config.webSearchBaseUrl || "http://127.0.0.1:8080/search"
  const url = new URL(baseUrl)
  url.searchParams.set("q", query)
  url.searchParams.set("format", "json")
  url.searchParams.set("language", "zh-CN")
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "X-Real-IP": "127.0.0.1",
      "X-Forwarded-For": "127.0.0.1"
    }
  }, config.timeoutMs)
  const data = await response.json()
  return normalizeWebSearchResults(data.results || [], config)
}

function normalizeWebSearchResults(items, config = CONFIG) {
  return items.slice(0, config.webSearchMaxResults || 5).map(item => ({
    title: String(item.title || "").trim(),
    snippet: String(item.snippet || item.content || "").trim(),
    url: String(item.link || item.url || "").trim(),
    date: String(item.date || item.publishedDate || "").trim()
  })).filter(item => item.title || item.snippet)
}

async function resolveIntentFromWebResults(message, intent, query, results) {
  const result = await callAiJson([
    { role: "system", content: "你是影视剧名解析助手。根据用户需求和网络搜索结果，推断用户真正要搜索的影视剧片名。只输出 JSON。字段：title,year,keyword,reason,confidence。不要编造搜索结果中没有依据的片名；如果无法确定，title 为空。" },
    { role: "user", content: `用户需求=${message}\n原始意图=${JSON.stringify(intent)}\n搜索词=${query}\n网络搜索结果=${JSON.stringify(results)}` }
  ])
  return {
    title: String(result.title || "").trim(),
    year: normalizeYear(result.year),
    keyword: String(result.keyword || result.title || "").trim(),
    reason: String(result.reason || "").trim(),
    confidence: Number(result.confidence || 0)
  }
}

function selectAiSearchSites(preferredSites) {
  const preferred = normalizeAiSites(preferredSites)
  const configured = getConfiguredSearchSites()
  const selected = preferred.filter(site => configured.includes(site))
  const skipped = preferred.filter(site => !configured.includes(site)).map(site => ({
    site,
    siteName: getSiteConfig(site)?.name || site,
    message: `${getSiteConfig(site)?.name || site} 未配置，已跳过`
  }))
  const fallback = configured.filter(site => !selected.includes(site))
  return {
    preferred,
    configured,
    skipped,
    sites: [...new Set([...selected, ...fallback])]
  }
}

function getConfiguredSearchSites() {
  const sites = CONFIG.sites.filter(site => site.enabled && site.cookie).map(site => site.id)
  return sites.length ? sites : CONFIG.sites.filter(site => site.enabled).map(site => site.id)
}

function normalizeAiSites(value) {
  if (!Array.isArray(value)) {
    return []
  }
  const knownSites = new Set(CONFIG.sites.map(site => site.id))
  return [...new Set(value.map(site => String(site || "").trim()).filter(site => knownSites.has(site)))]
}

async function searchAiRawTorrents(keyword, sites) {
  const results = []
  const errors = []
  for (const siteId of sites) {
    try {
      const torrents = await searchNexusTorrents(siteId, keyword)
      results.push(...torrents.map(torrent => ({
        ...torrent,
        parsed: parseEpisodeTitle(torrent.title)
      })))
    } catch (error) {
      const site = getSiteConfig(siteId)
      errors.push({ site: siteId, siteName: site?.name || siteId, message: sanitizeErrorMessage(error.message) })
    }
  }
  return { results, errors }
}

function buildSmartCandidateResult(keyword, year, sites, results, errors) {
  const requestedYear = normalizeYear(year)
  const filtered = results.filter(torrent => !requestedYear || torrent.parsed.year === requestedYear)
  const groups = groupSearchResults(filtered).map(group => ({
    ...group,
    year: group.titles[0]?.parsed?.year || "",
    season: group.titles[0]?.parsed?.season || "",
    resolution: group.titles[0]?.parsed?.resolution || "",
    audioCodec: group.titles[0]?.parsed?.audioCodec || "",
    videoCodec: group.titles[0]?.parsed?.videoCodec || "",
    releaseGroup: group.titles[0]?.parsed?.releaseGroup || "",
    profile: group.titles[0]?.parsed?.profile || "",
    firstDetailUrl: group.titles[0]?.detailUrl || "",
    titles: group.titles.map(item => ({
      id: item.id,
      sourceId: item.sourceId,
      detailUrl: item.detailUrl,
      title: item.title,
      episodeText: item.parsed?.episodeText || "",
      startEpisode: item.parsed?.startEpisode || null,
      endEpisode: item.parsed?.endEpisode || null,
      isRange: item.parsed?.endEpisode > item.parsed?.startEpisode,
      seeders: item.seeders ?? null
    })).slice(0, 20)
  }))
  return { keyword, year: requestedYear, sites, errors, groups, totalTorrents: filtered.length }
}

async function analyzeAiRawTitles(message, intent, torrents) {
  const sample = torrents.slice(0, 80).map((torrent, index) => ({
    index,
    id: torrent.id,
    sourceId: torrent.sourceId,
    detailUrl: torrent.detailUrl,
    site: torrent.site,
    siteName: torrent.siteName,
    title: torrent.title,
    year: torrent.parsed.year,
    episodeText: torrent.parsed.episodeText,
    resolution: torrent.parsed.resolution,
    videoCodec: torrent.parsed.videoCodec,
    audioCodec: torrent.parsed.audioCodec,
    releaseGroup: torrent.parsed.releaseGroup
  }))
  if (!sample.length) {
    return { mode: "unknown", summary: "没有可供 AI 分析的标题。", movieCandidates: [], seriesCandidates: [] }
  }
  const result = await callAiJson([
    { role: "system", content: "你是影视资源标题分析助手。根据用户需求和搜索结果标题，判断用户更可能要电影/剧场版还是连续剧/动画剧集。只输出 JSON。字段：mode(movie|series|mixed|unknown), summary, movieCandidates, seriesCandidates。candidate 字段：index, reason。只允许使用输入里的 index，不要编造标题。" },
    { role: "user", content: `用户需求=${message}\n结构化意图=${JSON.stringify(intent)}\n搜索标题=${JSON.stringify(sample)}` }
  ])
  return normalizeAiTitleAnalysis(result, sample)
}

function normalizeAiTitleAnalysis(input, sample) {
  const safe = input && typeof input === "object" ? input : {}
  const byIndex = new Map(sample.map(item => [Number(item.index), item]))
  return {
    mode: ["movie", "series", "mixed", "unknown"].includes(safe.mode) ? safe.mode : "unknown",
    summary: String(safe.summary || "AI 已分析原始标题。"),
    movieCandidates: normalizeAiTitleCandidates(safe.movieCandidates, byIndex),
    seriesCandidates: normalizeAiTitleCandidates(safe.seriesCandidates, byIndex)
  }
}

function normalizeAiTitleCandidates(value, byIndex) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, 12).map(item => {
    const index = Number(item.index)
    const torrent = byIndex.get(index)
    if (!torrent) {
      return null
    }
    return { ...torrent, reason: String(item.reason || "AI 认为这个标题符合用户需求") }
  }).filter(Boolean)
}

async function parseAiSubscriptionIntent(message, lastIntent = {}) {
  const sites = CONFIG.sites.map(site => site.id).join(",")
  const result = await callAiJson([
    { role: "system", content: `你是 NexusPHP 电视剧订阅助手。你需要把上一轮订阅意图 lastIntent 和用户新输入合并成完整意图。只输出 JSON，不要输出解释。字段：keyword,title,year,resolution,videoCodec,audioCodec,source,releaseGroup,excludeCompletePack,sites,needsWebSearch,webSearchQuery。sites 只能包含这些值：${sites}。用户新输入覆盖 lastIntent；用户未提到的字段保留 lastIntent；未知字段用空字符串、false 或空数组。如果用户询问最新、最近、热播、今年、演员最新作品、导演新片等实时或模糊需求，设置 needsWebSearch=true，并生成 webSearchQuery。` },
    { role: "user", content: `lastIntent=${JSON.stringify(lastIntent)}\n用户新输入=${message}` }
  ])
  return normalizeAiIntent(result)
}

async function callAiJson(messages, config = CONFIG) {
  const baseUrl = String(config.aiBaseUrl || "").replace(/\/$/, "")
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.aiApiKey}`
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages,
      temperature: 0.1,
      response_format: { type: "json_object" }
    })
  }, Number(config.aiTimeoutMs) || 30000)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error?.message || `AI 请求失败：HTTP ${response.status}`)
  }
  const content = data.choices?.[0]?.message?.content || "{}"
  return JSON.parse(content)
}

function normalizeAiIntent(input) {
  const intent = input && typeof input === "object" ? input : {}
  return {
    keyword: String(intent.keyword || intent.title || "").trim(),
    title: String(intent.title || intent.keyword || "").trim(),
    needsWebSearch: Boolean(intent.needsWebSearch),
    webSearchQuery: String(intent.webSearchQuery || "").trim(),
    year: normalizeYear(intent.year),
    resolution: normalizeResolution(intent.resolution),
    videoCodec: normalizeVideoCodec(intent.videoCodec || ""),
    audioCodec: normalizeAudioCodec(intent.audioCodec || ""),
    source: String(intent.source || "").trim(),
    releaseGroup: String(intent.releaseGroup || "").trim().toUpperCase(),
    excludeCompletePack: Boolean(intent.excludeCompletePack),
    sites: normalizeAiSites(intent.sites)
  }
}

function rankAiCandidateGroups(candidates, intent) {
  const groups = (candidates.groups || []).map(group => {
    const scoreInfo = scoreAiCandidateGroup(group, intent)
    return { ...group, aiScore: scoreInfo.score, aiReasons: scoreInfo.reasons }
  }).sort((a, b) => b.aiScore - a.aiScore || b.episodeCount - a.episodeCount)
  return { ...candidates, groups }
}

function scoreAiCandidateGroup(group, intent) {
  let score = Number(group.episodeCount || 0)
  const reasons = []
  if (intent.year && group.year === intent.year) {
    score += 25
    reasons.push(`年份匹配 ${intent.year}`)
  }
  if (intent.resolution && group.resolution === intent.resolution) {
    score += 20
    reasons.push(`分辨率匹配 ${intent.resolution}`)
  }
  if (intent.videoCodec && group.videoCodec === intent.videoCodec) {
    score += 15
    reasons.push(`视频编码匹配 ${intent.videoCodec}`)
  }
  if (intent.audioCodec && group.audioCodec === intent.audioCodec) {
    score += 10
    reasons.push(`音频匹配 ${intent.audioCodec}`)
  }
  if (intent.releaseGroup && group.releaseGroup === intent.releaseGroup) {
    score += 15
    reasons.push(`发布组匹配 ${intent.releaseGroup}`)
  }
  if (intent.source && normalizeText(group.firstTitle).includes(normalizeText(intent.source))) {
    score += 12
    reasons.push(`来源匹配 ${intent.source}`)
  }
  if (intent.excludeCompletePack && /complete|合集|全季|e\d+\s*[-~]/i.test(group.firstTitle)) {
    score -= 20
    reasons.push("已按要求降低合集/范围标题优先级")
  }
  if (!reasons.length) {
    reasons.push("按集数覆盖和版本信息排序")
  }
  return { score, reasons }
}

function normalizeResolution(value) {
  const match = String(value || "").match(/4320p|2160p|1080p|720p|480p/i)
  return match?.[0]?.toLowerCase() || ""
}

function normalizeYear(value) {
  const match = String(value || "").match(/(?:19|20)\d{2}/)
  return match?.[0] || ""
}

async function testNexusConnection(input) {
  const testConfig = normalizeConfig({ ...CONFIG, ...input })
  const siteConfig = getSiteConfig(String(input.siteId || input.site || ""), testConfig)
  if (!siteConfig) {
    return { ok: false, message: "站点不存在" }
  }
  if (!siteConfig.siteUrl) {
    return { ok: false, message: `${siteConfig.name} 站点地址为空` }
  }
  if (!siteConfig.cookie) {
    return { ok: false, message: `${siteConfig.name} Cookie 为空` }
  }
  try {
    const response = await fetchWithTimeout(`${siteConfig.siteUrl}/torrents.php`, {
      headers: buildNexusHeaders(siteConfig, testConfig)
    }, testConfig.timeoutMs)
    const html = await response.text()
    if (isNexusLoginPage(html)) {
      return { ok: false, message: `${siteConfig.name} Cookie 可能无效，当前仍是登录页` }
    }
    return { ok: true, message: `${siteConfig.name} 连接成功，Cookie 可访问站内页面` }
  } catch (error) {
    return { ok: false, message: error.message }
  }
}

async function testTransmissionConnection(input) {
  const testConfig = normalizeConfig({ ...CONFIG, ...input })
  try {
    const response = await callTransmissionJsonWithConfig(testConfig, { method: "session-get" })
    if (response.result !== "success") {
      return { ok: false, message: response.result || "Transmission 连接失败" }
    }
    return { ok: true, message: `Transmission 连接成功：${response.arguments?.version || "已连接"}` }
  } catch (error) {
    if (shouldIgnoreTransmissionError(error, testConfig)) {
      return { ok: true, message: `${error.message}；当前配置为网络失败默认成功` }
    }
    return { ok: false, message: error.message }
  }
}

async function searchNexusTorrents(siteId, keyword) {
  const siteConfig = getSiteConfig(siteId)
  if (!siteConfig) {
    throw new Error("站点不存在")
  }
  if (!siteConfig.enabled) {
    throw new Error(`${siteConfig.name} 已禁用`)
  }
  if (!siteConfig.siteUrl) {
    throw new Error(`${siteConfig.name} 未配置站点地址`)
  }
  if (!siteConfig.cookie) {
    throw new Error(`${siteConfig.name} 未配置 Cookie，请在系统配置页填写登录后的 Cookie`)
  }
  const maxPages = Math.max(Number(CONFIG.searchMaxPages) || 1, 1)
  const torrents = []
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const html = await fetchNexusSearchPage(siteConfig, keyword, pageNumber)
    const list = parseNexusTorrents(html, siteConfig)
    if (!list.length) {
      break
    }
    torrents.push(...list)
    if (!hasNexusNextPage(html, pageNumber)) {
      break
    }
  }
  return torrents
}

async function fetchNexusSearchPage(siteConfig, keyword, pageNumber) {
  const url = new URL(`${siteConfig.siteUrl}/torrents.php`)
  url.searchParams.set("search", keyword)
  url.searchParams.set("search_area", "0")
  url.searchParams.set("search_mode", "0")
  url.searchParams.set("incldead", "1")
  url.searchParams.set("spstate", "0")
  url.searchParams.set("inclbookmarked", "0")
  url.searchParams.set("page", String(pageNumber))
  const response = await fetchWithTimeout(url, {
    headers: buildNexusHeaders(siteConfig)
  })
  const html = await response.text()
  if (isNexusLoginPage(html)) {
    throw new Error(`${siteConfig.name} Cookie 可能已失效，搜索被重定向到登录页`)
  }
  return html
}

function parseNexusTorrents(html, siteConfig) {
  const results = []
  const seen = new Set()
  const rowPattern = /<tr[\s\S]*?<\/tr>/gi
  const detailPattern = /<a\b([^>]*href=["']details\.php\?id=(\d+)[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi
  for (const row of html.match(rowPattern) || []) {
    detailPattern.lastIndex = 0
    let match
    while ((match = detailPattern.exec(row))) {
      const attrs = match[1]
      const sourceId = match[2]
      if (seen.has(sourceId)) continue
      const titleAttr = attrs.match(/title=["']([^"']+)["']/i)?.[1] || ""
      const title = decodeHtml(titleAttr || stripHtml(match[3])).trim()
      if (!title) continue
      seen.add(sourceId)
      results.push({
        id: `${siteConfig.id}-${sourceId}`,
        site: siteConfig.id,
        siteName: siteConfig.name,
        sourceId,
        title,
        detailUrl: `${siteConfig.siteUrl}/details.php?id=${encodeURIComponent(sourceId)}`,
        downloadUrl: `${siteConfig.siteUrl}/download.php?id=${encodeURIComponent(sourceId)}`
      })
    }
  }
  return results
}

function getTorrentDownloadRequest(match) {
  const siteConfig = getSiteConfig(match.site)
  if (!siteConfig) {
    throw new Error("站点不存在")
  }
  return {
    url: `${siteConfig.siteUrl}/download.php?id=${encodeURIComponent(match.sourceId)}`,
    headers: {
      ...buildNexusHeaders(siteConfig),
      referer: `${siteConfig.siteUrl}/details.php?id=${encodeURIComponent(match.sourceId)}`
    }
  }
}

async function addTorrentToTransmission(downloadRequest, downloadDir) {
  const torrentResponse = await fetchWithTimeout(downloadRequest.url, { headers: downloadRequest.headers || {} })
  const contentType = torrentResponse.headers.get("content-type") || ""
  const torrentBuffer = Buffer.from(await torrentResponse.arrayBuffer())
  if (!torrentBuffer.length || contentType.includes("text/html")) {
    throw new Error(`种子下载失败：${contentType || "空响应"}`)
  }
  const payload = {
    method: "torrent-add",
    arguments: {
      metainfo: torrentBuffer.toString("base64"),
      "download-dir": downloadDir
    }
  }
  try {
    const result = await callTransmission(payload)
    const json = JSON.parse(result)
    if (json.result !== "success" && json.result !== "duplicate torrent") {
      throw new Error(json.result || "Transmission 添加失败")
    }
    return json.arguments || {}
  } catch (error) {
    if (shouldIgnoreTransmissionError(error)) {
      return { skipped: true, reason: error.message }
    }
    throw error
  }
}

async function callTransmission(payload) {
  return callTransmissionWithConfig(CONFIG, payload)
}

async function callTransmissionWithConfig(config, payload) {
  if (!config.transmissionUrl) {
    throw new Error("Transmission RPC 地址为空")
  }
  const headers = { "content-type": "application/json" }
  if (config.transmissionUsername || config.transmissionPassword) {
    headers.authorization = `Basic ${Buffer.from(`${config.transmissionUsername}:${config.transmissionPassword}`).toString("base64")}`
  }
  let response = await transmissionFetch(config.transmissionUrl, { method: "POST", headers, body: JSON.stringify(payload) })
  if (response.status === 409) {
    headers["x-transmission-session-id"] = response.headers.get("x-transmission-session-id")
    response = await transmissionFetch(config.transmissionUrl, { method: "POST", headers, body: JSON.stringify(payload) })
  }
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Transmission 请求失败：HTTP ${response.status} ${text}`)
  }
  return text
}

async function callTransmissionJsonWithConfig(config, payload) {
  return JSON.parse(await callTransmissionWithConfig(config, payload))
}

async function callTransmissionJson(payload) {
  return JSON.parse(await callTransmission(payload))
}

async function transmissionFetch(url, options) {
  try {
    return await fetch(url, options)
  } catch (error) {
    throw createTransmissionNetworkError(url, error)
  }
}

function createTransmissionNetworkError(url, error) {
  const code = error.cause?.code || error.code || ""
  const message = code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT"
    ? `Transmission 连接超时：${url}`
    : code === "ECONNREFUSED"
      ? `Transmission 连接被拒绝：${url}`
      : code === "ENETUNREACH" || code === "EHOSTUNREACH"
        ? `Transmission 网络不可达：${url}`
        : `Transmission 请求失败：${code || error.message}`
  const networkError = new Error(message)
  networkError.isTransmissionNetworkError = true
  networkError.code = code
  return networkError
}

function shouldIgnoreTransmissionError(error, config = CONFIG) {
  return config.transmissionNetworkFailureAsSuccess && error?.isTransmissionNetworkError
}

async function syncTransmissionDownloadedEpisodes(subscriptionId) {
  const subscriptions = await readSubscriptions()
  const subscription = subscriptions.find(item => item.id === subscriptionId)
  if (!subscription) {
    return
  }
  try {
    const response = await callTransmissionJson({
      method: "torrent-get",
      arguments: {
        fields: ["id", "name", "hashString", "status", "percentDone", "isFinished", "files"]
      }
    })
    const torrents = response.arguments?.torrents || []
    let syncedCount = 0
    for (const torrent of torrents) {
      if (!isTransmissionTorrentFinished(torrent)) {
        continue
      }
      const titles = getTransmissionTorrentTitles(torrent)
      for (const title of titles) {
        const parsed = parseEpisodeTitle(title)
        const match = { id: torrent.id || torrent.hashString || title, site: subscription.site, title, parsed }
        if (!isWantedCandidate(subscription, match)) {
          continue
        }
        await markEpisodeDownloaded(subscriptionId, match, { source: "transmission", hashString: torrent.hashString, torrentId: torrent.id })
        syncedCount += 1
        break
      }
    }
    if (syncedCount) {
      await appendLog(subscriptionId, "同步Transmission", `同步 ${syncedCount} 个已完成任务`)
    }
  } catch (error) {
    if (shouldIgnoreTransmissionError(error)) {
      await appendLog(subscriptionId, "同步Transmission跳过", error.message)
      return
    }
    throw error
  }
}

function isTransmissionTorrentFinished(torrent) {
  return torrent.isFinished === true || torrent.percentDone === 1 || torrent.status === 6
}

function extractHashStringFromTorrentResult(result) {
  if (!result) return null
  if (result.hashString) return result.hashString
  const added = result["torrent-added"] || result["torrent-duplicate"]
  if (added && added.hashString) return added.hashString
  return null
}

async function getTransmissionStatusMap() {
  if (!CONFIG.transmissionUrl) return {}
  try {
    const response = await callTransmissionJson({
      method: "torrent-get",
      arguments: {
        fields: ["hashString", "status", "percentDone", "isFinished", "rateDownload", "eta", "totalSize", "leftUntilDone", "name"]
      }
    })
    const map = {}
    for (const torrent of (response.arguments?.torrents || [])) {
      if (torrent.hashString) {
        map[torrent.hashString] = {
          percentDone: torrent.percentDone || 0,
          isFinished: isTransmissionTorrentFinished(torrent),
          status: torrent.status,
          rateDownload: torrent.rateDownload || 0,
          eta: torrent.eta || 0,
          totalSize: torrent.totalSize || 0,
          leftUntilDone: torrent.leftUntilDone || 0,
          name: torrent.name || ""
        }
      }
    }
    return map
  } catch (error) {
    if (shouldIgnoreTransmissionError(error)) return {}
    return {}
  }
}

function getTransmissionTorrentTitles(torrent) {
  return [torrent.name, ...(torrent.files || []).map(file => file.name)].filter(Boolean)
}

function isWantedCandidate(subscription, candidate) {
  const parsed = candidate.parsed
  if (!parsed.season || !parsed.startEpisode) {
    return false
  }
  if (parsed.season !== subscription.parsed.season) {
    return false
  }
  if (subscription.parsed.year && parsed.year && parsed.year !== subscription.parsed.year) {
    return false
  }
  if (subscription.parsed.resolution && parsed.resolution && parsed.resolution !== subscription.parsed.resolution) {
    return false
  }
  if (subscription.parsed.releaseGroup && parsed.releaseGroup && parsed.releaseGroup !== subscription.parsed.releaseGroup) {
    return false
  }
  if (subscription.parsed.audioCodec && parsed.audioCodec && parsed.audioCodec !== subscription.parsed.audioCodec) {
    return false
  }
  if (subscription.parsed.videoCodec && parsed.videoCodec && parsed.videoCodec !== subscription.parsed.videoCodec) {
    return false
  }
  if (!isSameTitleSeries(subscription, candidate)) {
    return false
  }
  const text = normalizeText(candidate.title)
  const nameMatched = text.includes(normalizeText(subscription.searchName)) || text.includes(normalizeText(subscription.parsed.showName))
  if (!nameMatched) {
    return false
  }
  const torrentExists = (subscription.downloadedTorrents || []).some(item => item.id === candidate.id)
  if (torrentExists) {
    return false
  }
  return !isEpisodeDownloaded(subscription, parsed)
}

function isEpisodeDownloaded(subscription, parsed) {
  const downloadedEpisodes = new Set(subscription.downloadedEpisodes || [])
  return range(parsed.startEpisode, parsed.endEpisode).every(episode => downloadedEpisodes.has(formatEpisode(episode)))
}

function isSameTitleSeries(subscription, candidate) {
  const expectedKey = subscription.titleMatchKey || buildTitleMatchKey(subscription.firstTitle || subscription.parsed?.originalTitle || "")
  const actualKey = buildTitleMatchKey(candidate.title || "")
  if (!expectedKey || !actualKey || expectedKey !== actualKey) {
    return false
  }
  const expected = subscription.versionFingerprint || buildVersionFingerprint(subscription.firstTitle || subscription.parsed?.originalTitle || "")
  const actual = buildVersionFingerprint(candidate.title || "")
  if (!expected.required.every(token => actual.tokens.includes(token))) {
    return false
  }
  if (expected.forbidden.some(token => actual.tokens.includes(token))) {
    return false
  }
  return true
}

function buildTitleMatchKey(title) {
  return normalizeComparableTitle(removeEpisodeMarker(title))
}

function removeEpisodeMarker(title) {
  return String(title || "")
    .replace(/\bS\d{1,2}\s*E\d{1,3}(?:\s*[-~]\s*S?\d{0,2}\s*E?\d{1,3})?\b/ig, " SXXEXX ")
    .replace(/\bE\d{1,3}(?:\s*[-~]\s*E?\d{1,3})?\b/ig, " EXX ")
}

function normalizeComparableTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[\u3010\u3011\[\]()（）{}【】]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildVersionFingerprint(title) {
  const tokens = extractVersionTokens(title)
  return {
    tokens,
    required: tokens,
    forbidden: buildForbiddenVersionTokens(tokens)
  }
}

function extractVersionTokens(title) {
  const normalized = normalizeText(title)
  const tokens = [
    "web dl",
    "webrip",
    "bluray",
    "remux",
    "hdtv",
    "uhd",
    "2160p",
    "1080p",
    "720p",
    "h 264",
    "h 265",
    "hevc",
    "avc",
    "av1",
    "ddp5 1",
    "dd5 1",
    "aac2 0",
    "aac5 1",
    "dts",
    "hdr vivid",
    "hdr10",
    "hdr",
    "dv",
    "dolby vision",
    "iq",
    "clean",
    "60fps",
    "10bit"
  ]
  return tokens.filter(token => normalized.includes(token))
}

function buildForbiddenVersionTokens(requiredTokens) {
  const required = new Set(requiredTokens)
  const exclusiveGroups = [
    ["iq", "clean"],
    ["hdr vivid", "hdr10", "hdr", "dv", "dolby vision"],
    ["web dl", "webrip", "bluray", "remux", "hdtv"],
    ["2160p", "1080p", "720p"],
    ["h 264", "h 265", "hevc", "avc", "av1"],
    ["ddp5 1", "dd5 1", "aac2 0", "aac5 1", "dts"]
  ]
  return [...new Set(exclusiveGroups.flatMap(group => group.some(token => required.has(token)) ? group.filter(token => !required.has(token)) : []))]
}

async function markEpisodeDownloaded(id, match, addResult) {
  const episodeTexts = range(match.parsed.startEpisode, match.parsed.endEpisode).map(formatEpisode)
  await updateSubscription(id, subscription => {
    const episodes = new Set(subscription.downloadedEpisodes || [])
    const downloadedEpisodeDetails = [...(subscription.downloadedEpisodeDetails || [])]
    const existingDetailKeys = new Set(downloadedEpisodeDetails.map(item => `${item.season}-${item.episode}`))
    for (const episodeText of episodeTexts) {
      episodes.add(episodeText)
      const detailKey = `${match.parsed.season}-${episodeText}`
      if (!existingDetailKeys.has(detailKey)) {
        downloadedEpisodeDetails.push({
          season: match.parsed.season,
          episode: episodeText,
          torrentId: match.id,
          title: match.title,
          audioCodec: match.parsed.audioCodec,
          videoCodec: match.parsed.videoCodec,
          downloadedAt: new Date().toISOString()
        })
      }
    }
    return {
      ...subscription,
      downloadedEpisodes: [...episodes].sort(),
      downloadedEpisodeDetails: downloadedEpisodeDetails.sort((a, b) => `${a.season}-${a.episode}`.localeCompare(`${b.season}-${b.episode}`)),
      downloadedTorrents: [
        ...(subscription.downloadedTorrents || []),
        {
          id: match.id,
          title: match.title,
          parsed: match.parsed,
          result: addResult,
          addedAt: new Date().toISOString()
        }
      ],
      updatedAt: new Date().toISOString()
    }
  })
  await appendLog(id, "记录已下载", episodeTexts.join(", "))
}

function parseEpisodeTitle(title) {
  const source = normalizeTitle(title)
  const episodeMatch = source.match(/\bS(\d{1,2})\s*E(\d{1,3})(?:\s*[-~]\s*S?(\d{1,2})?\s*E?(\d{1,3}))?\b/i)
  const episodeOnlyMatch = episodeMatch ? null : source.match(/\bE(\d{1,3})(?:\s*[-~]\s*E?(\d{1,3}))?/i)
  const seasonOnlyMatch = episodeOnlyMatch ? source.match(/\bS(\d{1,2})\b/i) : null
  const resolutionMatch = source.match(/\b(4320p|2160p|1080p|720p|480p)\b/i)
  const audioCodecMatch = source.match(/\b(DDP\s*5[._ ]1|DD\s*5[._ ]1|AAC\s*2[._ ]0|AAC\s*5[._ ]1|DTS(?:-HD)?(?:\s*MA)?|TrueHD|FLAC|Atmos|AC3)\b/i)
  const videoCodecMatch = source.match(/\b(H[ ._-]?26[45]|HEVC|AVC|AV1|x26[45])\b/i)
  const releaseGroupMatch = source.match(/[-￡@]\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/)
  const titleMatch = episodeMatch || episodeOnlyMatch
  const yearText = extractTitleYear(source, titleMatch)
  const seasonNumber = episodeMatch ? Number(episodeMatch[1]) : seasonOnlyMatch ? Number(seasonOnlyMatch[1]) : episodeOnlyMatch ? 1 : null
  const startEpisode = episodeMatch ? Number(episodeMatch[2]) : episodeOnlyMatch ? Number(episodeOnlyMatch[1]) : seasonOnlyMatch ? 1 : null
  const endEpisode = episodeMatch ? Number(episodeMatch[4] || episodeMatch[2]) : episodeOnlyMatch ? Number(episodeOnlyMatch[2] || episodeOnlyMatch[1]) : seasonOnlyMatch ? 99 : null
  const showName = titleMatch ? source.slice(0, titleMatch.index).replace(/\b(19|20)\d{2}\b\s*[-~]?\s*(19|20)?\d{0,2}\s*$/i, "").trim() : ""
  return {
    originalTitle: title,
    showName,
    year: yearText,
    resolution: resolutionMatch?.[1]?.toLowerCase() || "",
    season: seasonNumber ? `S${String(seasonNumber).padStart(2, "0")}` : "",
    startEpisode: startEpisode || null,
    endEpisode: endEpisode || startEpisode || null,
    episodeText: startEpisode ? (seasonOnlyMatch && !episodeMatch && !episodeOnlyMatch ? "全集" : `${formatEpisode(startEpisode)}${endEpisode && endEpisode !== startEpisode ? `-${formatEpisode(endEpisode)}` : ""}`) : "",
    releaseGroup: releaseGroupMatch?.[1]?.toUpperCase() || "",
    audioCodec: normalizeAudioCodec(audioCodecMatch?.[1] || ""),
    videoCodec: normalizeVideoCodec(videoCodecMatch?.[1] || ""),
    profile: buildMediaProfile(source)
  }
}

function extractTitleYear(source, episodeMatch) {
  const scope = episodeMatch ? source.slice(0, episodeMatch.index) : source
  const years = scope.match(/\b((?:19|20)\d{2})\b/g) || []
  if (years.length) {
    return years.at(-1)
  }
  const fallbackYears = episodeMatch ? source.slice(episodeMatch.index).match(/\b((?:19|20)\d{2})\b/g) || [] : []
  return fallbackYears[0] || ""
}

function normalizeTitle(title) {
  return String(title || "").replace(/[\u3010\u3011\[\]]/g, " ").replace(/\s+/g, " ").trim()
}

function normalizeAudioCodec(value) {
  const normalized = normalizeText(value)
  if (!normalized) return ""
  if (normalized.includes("ddp") && normalized.includes("5 1")) return "DDP5.1"
  if (normalized.includes("dd") && normalized.includes("5 1")) return "DD5.1"
  if (normalized.includes("aac") && normalized.includes("2 0")) return "AAC2.0"
  if (normalized.includes("aac") && normalized.includes("5 1")) return "AAC5.1"
  if (normalized.includes("ac3")) return "AC3"
  if (normalized.includes("dts hd") || normalized.includes("dts ma")) return "DTS-HD MA"
  if (normalized.includes("dts")) return "DTS"
  if (normalized.includes("truehd")) return "TrueHD"
  if (normalized.includes("flac")) return "FLAC"
  if (normalized.includes("atmos")) return "Atmos"
  return value.toUpperCase()
}

function normalizeVideoCodec(value) {
  const normalized = normalizeText(value)
  if (!normalized) return ""
  if (normalized.includes("265") || normalized.includes("hevc")) return "H.265"
  if (normalized.includes("264") || normalized.includes("avc")) return "H.264"
  if (normalized.includes("av1")) return "AV1"
  return value.toUpperCase()
}

function buildMediaProfile(title) {
  const normalized = normalizeText(title)
  return ["tx", "web dl", "aac2 0", "ddp5 1", "dv", "hdr", "hfr", "h 264", "h 265", "60fps", "10bit"]
    .filter(token => normalized.includes(token))
    .join("|")
}

function buildInitialDownloadedEpisodes(parsed) {
  return range(parsed.startEpisode, parsed.endEpisode).map(formatEpisode)
}

function buildInitialDownloadedEpisodeDetails(parsed, title, downloadedAt) {
  return buildInitialDownloadedEpisodes(parsed).map(episode => ({
    season: parsed.season,
    episode,
    torrentId: null,
    title,
    audioCodec: parsed.audioCodec,
    videoCodec: parsed.videoCodec,
    downloadedAt
  }))
}

function range(start, end) {
  const list = []
  const safeStart = Number(start)
  const safeEnd = Number(end || start)
  for (let episode = safeStart; episode <= safeEnd; episode += 1) {
    list.push(episode)
  }
  return list
}

function formatEpisode(episode) {
  return `E${String(episode).padStart(2, "0")}`
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[\s._-]+/g, " ").trim()
}

function normalizeSubscriptionSite(siteId) {
  const value = String(siteId || "").trim()
  const site = getSiteConfig(value)
  return site ? site.id : ""
}

function getSiteConfig(siteId, config = CONFIG) {
  return (config.sites || []).find(site => site.id === siteId) || null
}

function buildNexusHeaders(siteConfig, config = CONFIG) {
  return {
    "user-agent": config.userAgent,
    cookie: siteConfig.cookie,
    referer: `${siteConfig.siteUrl}/torrents.php`
  }
}

function isNexusLoginPage(html) {
  return /login\.php|takelogin\.php|用户名|密碼|密码/i.test(html) && !/logout\.php|userdetails\.php|download\.php|details\.php|torrents\.php/i.test(html)
}

function hasNexusNextPage(html, currentPage) {
  const nextPage = currentPage + 1
  return new RegExp(`[?&]page=${nextPage}(?:[^0-9]|$)`).test(html)
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(formatHttpError(response.status, text))
    }
    return response
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`请求超时：${url}`)
    }
    if (error.code === "ECONNREFUSED") {
      throw new Error(`连接被拒绝：${url}`)
    }
    if (error.code === "ENOTFOUND") {
      throw new Error(`DNS 解析失败：${url}`)
    }
    if (error.message?.includes("fetch failed")) {
      throw new Error(`网络请求失败：${url} - ${error.message}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function formatHttpError(status, body = "") {
  const text = String(body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  return text ? `HTTP ${status}: ${text.slice(0, 120)}` : `HTTP ${status}`
}

function sanitizeErrorMessage(message) {
  return String(message || "未知错误").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || "未知错误"
}

async function readSubscriptions() {
  const subscriptions = await readJsonFile(SUBSCRIPTIONS_FILE, [])
  return Array.isArray(subscriptions) ? subscriptions.map(normalizeSubscriptionForStorage) : []
}

async function writeSubscriptions(subscriptions) {
  await writeJsonFile(SUBSCRIPTIONS_FILE, subscriptions.map(normalizeSubscriptionForStorage))
}

function normalizeSubscriptionForStorage(subscription) {
  const site = normalizeSubscriptionSite(subscription.site) || subscription.site || ""
  const normalized = {
    ...subscription,
    site,
    siteName: getSiteConfig(site)?.name || subscription.siteName || site,
    checkIntervalMs: Number(subscription.checkIntervalMs || CONFIG.checkIntervalMs),
    versionFingerprint: subscription.versionFingerprint || buildVersionFingerprint(subscription.firstTitle || subscription.parsed?.originalTitle || ""),
    titleMatchKey: subscription.titleMatchKey || buildTitleMatchKey(subscription.firstTitle || subscription.parsed?.originalTitle || ""),
    downloadedTorrents: Array.isArray(subscription.downloadedTorrents) ? subscription.downloadedTorrents : [],
    checking: Boolean(subscription.checking && activeChecks.has(subscription.id))
  }
  const downloadedEpisodeDetails = normalizeDownloadedEpisodeDetails(normalized, subscription.downloadedEpisodeDetails)
  return {
    ...normalized,
    downloadedEpisodeDetails,
    downloadedEpisodes: buildDownloadedEpisodesFromDetails(downloadedEpisodeDetails, subscription.downloadedEpisodes)
  }
}

function normalizeDownloadedEpisodeDetails(subscription, details) {
  if (!Array.isArray(details)) {
    return []
  }
  return details.filter(item => {
    if (!item?.title) {
      return true
    }
    return isSameTitleSeries(subscription, {
      title: item.title,
      parsed: parseEpisodeTitle(item.title)
    })
  })
}

function buildDownloadedEpisodesFromDetails(details) {
  return [...new Set(details.map(item => item.episode).filter(Boolean))].sort()
}

async function updateSubscription(id, updater) {
  const subscriptions = await readSubscriptions()
  const index = subscriptions.findIndex(subscription => subscription.id === id)
  if (index === -1) {
    return
  }
  subscriptions[index] = normalizeSubscriptionForStorage(updater(subscriptions[index]))
  await writeSubscriptions(subscriptions)
}

async function readState() {
  const state = await readJsonFile(STATE_FILE, { logs: [] })
  return {
    logs: Array.isArray(state.logs) ? state.logs : []
  }
}

async function appendLog(subscriptionId, action, message) {
  const state = await readState()
  state.logs.unshift({
    id: crypto.randomUUID(),
    subscriptionId: subscriptionId || null,
    action,
    message: message || "",
    time: new Date().toISOString()
  })
  state.logs = state.logs.slice(0, 300)
  await writeJsonFile(STATE_FILE, state)
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJsonFile(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : {}
}

async function sendJson(response, data) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(data))
}

async function serveStatic(urlPath, response) {
  const normalizedPath = urlPath === "/" ? "/index.html" : urlPath
  const filePath = path.join(PUBLIC_DIR, path.normalize(normalizedPath).replace(/^([/\\])+/, ""))
  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403)
    response.end("Forbidden")
    return
  }
  try {
    const content = await readFile(filePath)
    response.writeHead(200, { "content-type": getContentType(filePath) })
    response.end(content)
  } catch {
    response.writeHead(404)
    response.end("Not Found")
  }
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8"
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8"
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8"
  return "application/octet-stream"
}
