// ラグアドの情報を集めて data/ に貯め、docs/ のページを作り直す。
//   node scripts/collect.mjs              いつもの収集（Google ニュースは直近 3 日）
//   node scripts/collect.mjs --backfill   初回用。Google ニュースを 90 日さかのぼる
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readJson, writeJson, idOf, hostOf, log, truncate } from "./lib/util.mjs";
import { fetchOfficial, fetchYouTube, fetchAppStore, fetchNews } from "./lib/sources.mjs";
import { enrichImages } from "./lib/enrich.mjs";
import { buildTopics } from "./lib/cluster.mjs";
import { updateArchive } from "./lib/archive.mjs";
import { renderPages } from "./lib/pages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const D = (f) => join(ROOT, "data", f);
const backfill = process.argv.includes("--backfill");

const started = Date.now();
const config = await readJson(join(ROOT, "config.json"));
const now = new Date();
const nowIso = now.toISOString();

const WATCHDOG_MIN = config.watchdogMinutes ?? 15;
setTimeout(() => {
  console.error(`[watchdog] ${WATCHDOG_MIN} 分を超えたため中断します`);
  process.exit(2);
}, WATCHDOG_MIN * 60 * 1000).unref();

const re = (list) => (list || []).map((k) => new RegExp(k, "i"));
const ragadRe = re(config.keywords?.ragad);
const seriesRe = re(config.keywords?.series);
const blockRe = re(config.blockTitlePatterns);
const blockSourceRe = re(config.blockSources);
const cats = (config.categories || []).map((c) => ({ id: c.id, re: re(c.keywords) }));
const fallback = config.fallbackCategory || { id: "news", label: "ニュース" };
const guideHosts = new Set(config.guideHosts || []);
const systems = (config.systems || []).map((s) => ({ id: s.id, re: re(s.keywords) }));

function categorize(text, host) {
  const out = [];
  if (guideHosts.has(host)) out.push("guide");
  for (const c of cats) if (c.re.some((r) => r.test(text)) && !out.includes(c.id)) out.push(c.id);
  return out.length ? out.slice(0, 2) : [fallback.id];
}
const systemsOf = (text) => systems.filter((s) => s.re.some((r) => r.test(text))).map((s) => s.id);

// 重複判定用に見出しを正規化する（全角英数を半角に、空白と末尾の媒体名を落とす）
function normTitle(t) {
  return t
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[（(][^（()）]{2,12}[)）]\s*$/, "")
    .replace(/^画像ギャラリー\s*No\.\d+\s*\|\s*/i, "")
    .replace(/[\s　]+/g, "")
    .toLowerCase()
    .slice(0, 40);
}

const stats = {};

// ---------- 1. 公式のお知らせ ----------
const officialPrev = (await readJson(D("official.json"), [])) || [];
let official = officialPrev;
try {
  const known = new Map(officialPrev.map((o) => [o.url, o]));
  const got = await fetchOfficial(config.official, known);
  for (const o of got) known.set(o.url, o);
  official = [...known.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  stats["公式サイト"] = got.length;
} catch (e) {
  log("公式のお知らせの取得に失敗:", e.message);
  stats["公式サイト"] = "error";
}
await writeJson(D("official.json"), official);

// ---------- 2. 公式 YouTube ----------
const videosPrev = (await readJson(D("videos.json"), [])) || [];
let videos = videosPrev;
try {
  const map = new Map(videosPrev.map((v) => [v.id, v]));
  const got = await fetchYouTube(config.youtube.channelId);
  for (const v of got) {
    const old = map.get(v.id);
    // 再生数は収集のたびに変わる。前日の値を残して「伸び」を出せるようにする
    const viewsLog = [...(old?.viewsLog || [])];
    const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    if (!viewsLog.length || viewsLog[viewsLog.length - 1][0] !== day) viewsLog.push([day, v.views]);
    else viewsLog[viewsLog.length - 1][1] = v.views;
    map.set(v.id, { ...old, ...v, viewsLog: viewsLog.slice(-14), systems: systemsOf(v.title) });
  }
  for (const v of map.values()) v.systems = systemsOf(v.title);
  videos = [...map.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  stats["YouTube"] = got.length;
} catch (e) {
  log("YouTube の取得に失敗:", e.message);
  stats["YouTube"] = "error";
}
await writeJson(D("videos.json"), videos);

// ---------- 3. App Store ----------
const store = (await readJson(D("store.json"), { current: null, history: [], ratings: [] })) || { history: [], ratings: [] };
try {
  const cur = await fetchAppStore(config.store.appStoreId);
  if (cur) {
    store.current = { ...cur, checkedAt: nowIso };
    if (!store.history.some((h) => h.version === cur.version)) {
      store.history.unshift({ version: cur.version, date: cur.versionDate, notes: truncate(cur.notes, 600), seenAt: nowIso });
    }
    const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    store.ratings = (store.ratings || []).filter((r) => r[0] !== day);
    store.ratings.push([day, cur.rating, cur.ratingCount]);
    store.ratings = store.ratings.slice(-120);
  }
  stats["App Store"] = cur ? 1 : 0;
} catch (e) {
  log("App Store の取得に失敗:", e.message);
  stats["App Store"] = "error";
}
await writeJson(D("store.json"), store);

// ---------- 4. ニュース ----------
if (backfill) config.googleNews.within = "90d";
const { items: raw, stats: newsStats } = await fetchNews(config);
Object.assign(stats, newsStats);
log(`fetched ${raw.length} news items`);

const maxAge = (backfill ? 120 : config.maxArticleAgeDays ?? 14) * 86400000;
const byId = new Map();
const dropped = { offTopic: 0, tooOld: 0, dup: 0, blocked: 0, official: 0 };
const officialTitles = new Set(official.map((o) => normTitle(o.title)));

for (const r of raw) {
  if (!r.title || !/^https?:\/\//.test(r.url || "")) continue;
  // 「見出し - https://example.com/」の形で来る媒体がある
  r.title = r.title.replace(/\s+-\s+https?:\/\/\S+$/, "");
  if (/^https?:\/\//.test(r.source || "")) r.source = hostOf(r.source);
  if (r.publishedAt && now - new Date(r.publishedAt) > maxAge) {
    dropped.tooOld++;
    continue;
  }
  const host = r.sourceHost || hostOf(r.url);
  // 公式サイトそのものは 1 で取っている
  if (/ragnarokadv\.gungho\.jp/.test(host)) {
    dropped.official++;
    continue;
  }
  if (blockRe.some((x) => x.test(r.title)) || blockSourceRe.some((x) => x.test(r.source || ""))) {
    dropped.blocked++;
    continue;
  }
  // ラグアドかどうかは見出しで決める。要約には関連作の名前が並ぶことがあるため
  const scope = ragadRe.some((x) => x.test(r.title)) ? "ragad" : seriesRe.some((x) => x.test(r.title)) ? "series" : "";
  if (!scope) {
    dropped.offTopic++;
    continue;
  }
  const norm = normTitle(r.title);
  if (officialTitles.has(norm)) {
    dropped.official++;
    continue;
  }
  const id = idOf(`t:${norm}`);
  const prev = byId.get(id);
  if (prev) {
    dropped.dup++;
    if (prev.viaGoogle && !r.viaGoogle) Object.assign(prev, { url: r.url, viaGoogle: false, host: hostOf(r.url), source: r.source });
    if (!prev.image && r.image) prev.image = r.image;
    continue;
  }
  byId.set(id, {
    id,
    title: truncate(r.title, 120),
    url: r.url,
    host,
    source: r.source,
    summary: r.summary || "",
    publishedAt: r.publishedAt || nowIso,
    image: r.image || "",
    scope,
    categories: categorize(r.title, host),
    systems: scope === "ragad" ? systemsOf(r.title) : [],
    viaGoogle: !!r.viaGoogle,
  });
}

const items = [...byId.values()].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
log(`kept ${items.length} (対象外 ${dropped.offTopic} / 古い ${dropped.tooOld} / 除外 ${dropped.blocked} / 重複 ${dropped.dup} / 公式 ${dropped.official})`);

// 前回までに画像を取れた記事は、アーカイブの値を使って取りに行かない
const archivePrev = new Map();
{
  const { loadArchive } = await import("./lib/archive.mjs");
  for (const d of (await loadArchive(D("archive"))).slice(0, 30)) for (const it of d.items) archivePrev.set(it.id, it);
}
for (const it of items) {
  const old = archivePrev.get(it.id);
  if (old && !it.image && old.image) it.image = old.image;
  if (old && it.viaGoogle && old.url && !/news\.google\.com/.test(old.url)) {
    it.url = old.url;
    it.host = hostOf(old.url);
    it.viaGoogle = false;
  }
}
try {
  log(`images enriched: ${await enrichImages(items, { limit: backfill ? 200 : 60 })}`);
} catch (e) {
  log("画像の補完に失敗:", e.message);
}

// ---------- 5. 同じ出来事をまとめる ----------
let topics = [];
if (config.cluster?.enabled !== false) {
  topics = buildTopics(items.filter((i) => i.scope === "ragad"), config.cluster, config.entities || []);
  log(`topics: ${topics.length}`);
}

// ---------- 6. 新着の判定と更新間隔 ----------
const prev = (await readJson(D("state.json"), { ranAt: "", ids: [] })) || { ids: [] };
const prevIds = new Set(prev.ids || []);
for (const it of items) it.isNew = prevIds.size > 0 && !prevIds.has(it.id);
const runs = [...(prev.runs || []), nowIso].slice(-24);
function medianGapMin(list) {
  const ts = list.map((t) => new Date(t).getTime()).filter(Boolean).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 60000);
  if (!gaps.length) return null;
  const recent = gaps.slice(-6).sort((a, b) => a - b);
  return Math.round(recent[Math.floor((recent.length - 1) / 2)]);
}
const updateGapMin = medianGapMin(runs);

await writeJson(join(ROOT, "docs", "data", "news.json"), { updatedAt: nowIso, updateGapMin, topics, items });
await writeJson(D("state.json"), { ranAt: nowIso, runs, ids: items.map((i) => i.id) });

// ---------- 7. 過去の記事を貯めて、ページを作り直す ----------
try {
  const n = await updateArchive(D("archive"), items);
  log(`archive: ${n} day files updated`);
  await renderPages(ROOT, { log });
} catch (e) {
  log("ページの生成に失敗:", e.stack || e.message);
}

const summary = { ranAt: nowIso, durationSec: Math.round((Date.now() - started) / 1000), kept: items.length, topics: topics.length, dropped, sources: stats };
await writeJson(D("last-run.json"), summary);
log(`done in ${summary.durationSec}s`);
