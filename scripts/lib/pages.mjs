// docs/ の HTML をすべて作る。収集のたび（collect.mjs）とビルドのたび（build.mjs）に呼ばれる。
// 表示はすべてここで HTML に焼き込み、ブラウザ側の JS は動画の再生・相対時刻・コメントだけにする。
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { readJson } from "./util.mjs";
import { loadArchive, jstDay } from "./archive.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const WD = "日月火水木金土";
const jst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000);
const pad = (n) => String(n).padStart(2, "0");
function md(iso) {
  const d = jst(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}
function mdhm(iso) {
  const d = jst(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function ymd(iso) {
  const d = jst(iso);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}
const time = (iso, f = mdhm) => `<time datetime="${esc(iso)}">${f(iso)}</time>`;
const num = (n) => Number(n || 0).toLocaleString("ja-JP");

export function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[)[\s\S]*?-->/g, "")
    .replace(/\n\s+/g, "\n")
    .replace(/>\n</g, "><")
    .trim();
}

async function verOf(path) {
  try {
    return createHash("sha1").update(await readFile(path)).digest("hex").slice(0, 8);
  } catch {
    return "0";
  }
}

// 画像の URL は外部のもの（記事の og:image・公式のバナー・YouTube のサムネイル）をそのまま使う。
// 読み込めないときは app.js が札に差し替える
function img(src, alt, cls = "") {
  if (!src) return `<span class="noimg ${cls}"><span>${esc(alt).slice(0, 18)}</span></span>`;
  return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-alt="${esc(alt).slice(0, 18)}">`;
}

export async function renderPages(root, { log = console.log } = {}) {
  const DOCS = join(root, "docs");
  const config = await readJson(join(root, "config.json"));
  const content = await readJson(join(root, "content.json"), {});
  const site = config.site;
  const base = site.url.replace(/\/$/, "");
  const official = (await readJson(join(root, "data", "official.json"), [])) || [];
  const videos = (await readJson(join(root, "data", "videos.json"), [])) || [];
  const store = (await readJson(join(root, "data", "store.json"), {})) || {};
  const state = (await readJson(join(root, "docs", "data", "news.json"), {})) || {};
  const days = await loadArchive(join(root, "data", "archive"));
  const all = days.flatMap((d) => d.items).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const ragad = all.filter((i) => i.scope === "ragad");
  const series = all.filter((i) => i.scope === "series");
  const now = new Date();
  const updatedAt = state.updatedAt || now.toISOString();
  const catLabel = Object.fromEntries([...(config.categories || []), config.fallbackCategory].map((c) => [c.id, c.label]));
  const sysById = Object.fromEntries((config.systems || []).map((s) => [s.id, s]));

  const ver = {
    css: await verOf(join(DOCS, "assets", "app.css")),
    js: await verOf(join(DOCS, "assets", "app.js")),
    comments: await verOf(join(DOCS, "assets", "comments.js")),
  };

  const pages = [];
  const put = (path, html, { index = true, priority = 0.5 } = {}) => pages.push({ path, html, index, priority });

  // ---------- 共通の部品 ----------
  const NAV = [
    ["/", "トップ"],
    ["/official/", "公式"],
    ["/news/", "ニュース"],
    ["/videos/", "動画"],
    ["/system/", "システム"],
    ["/info/", "基本情報"],
    ["/series/", "RO・シリーズ"],
    ["/talk/", "雑談"],
    ["/links/", "リンク"],
  ];

  // 公式の発表日や動画の公開日など、手元のデータだけで作る「ブロードキャスト」欄（RO の全体チャットの見た目）
  function broadcast() {
    const lines = [
      ...official.slice(0, 2).map((o) => ({ at: o.publishedAt, cls: "bc-y", who: "公式", text: o.title, url: o.url, ext: true })),
      ...videos.slice(0, 1).map((v) => ({ at: v.publishedAt, cls: "bc-g", who: "動画", text: v.title.replace(/^【[^】]+】/, "").replace(/｜.*$/, ""), url: "/videos/#v-" + v.id })),
      ...ragad.slice(0, 2).map((n) => ({ at: n.publishedAt, cls: "bc-w", who: n.source, text: n.title, url: n.url, ext: true })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 4);
    if (!lines.length) return "";
    return `<div class="bc" aria-label="最新の動き"><div class="wrap"><ul>${lines
      .map((l) => `<li class="${l.cls}"><span class="bc-t">${mdhm(l.at)}</span> <a href="${esc(l.url)}"${l.ext ? ' target="_blank" rel="noopener"' : ""}>${esc(l.who)} : ${esc(l.text)}</a></li>`)
      .join("")}</ul></div></div>`;
  }
  const bcHtml = broadcast();

  function layout({ path, title, desc, body, side = "", image = "", scripts = [], noindex = false, wide = false }) {
    const full = path === "/" ? `${site.title}｜ラグナロク：アドベンチャーズ（ラグアド）の情報まとめ` : `${title}｜${site.title}`;
    const url = base + path;
    const ogImage = image || `${base}/assets/og.png`;
    const nav = NAV.map(([href, label]) => {
      const cur = href === "/" ? path === "/" : path.startsWith(href);
      return `<li><a href="${href}"${cur ? ' aria-current="page"' : ""}>${label}</a></li>`;
    }).join("");
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:type" content="${path === "/" ? "website" : "article"}">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:title" content="${esc(path === "/" ? site.title : title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(ogImage)}">
${image ? "" : '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">'}
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#24365f">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="/feed.xml">
<link rel="stylesheet" href="/assets/app.css?v=${ver.css}">
${site.gaId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(site.gaId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${esc(site.gaId)}");</script>` : ""}
${site.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(site.googleSiteVerification)}">` : ""}
</head>
<body>
<header class="hd">
  <div class="wrap hd-in">
    <a class="logo" href="/"><img src="/assets/logo-mark.png" width="44" height="44" alt=""><span class="logo-t">ラグアド速報<small>Ragnarok: Adventures 情報まとめ</small></span></a>
  </div>
  <nav class="gnav"><ul class="wrap">${nav}</ul></nav>
</header>
${bcHtml}
<div class="wrap page${side ? "" : " page-1col"}${wide ? " page-wide" : ""}">
<main class="main">
${body}
</main>
${side ? `<aside class="side">${side}</aside>` : ""}
</div>
<footer class="ft">
  <div class="wrap">
    <p class="ft-links"><a href="/about/">このサイトについて</a> ／ <a href="/feed.xml">RSS</a> ／ <a href="${esc(site.contactUrl)}" target="_blank" rel="noopener">お問い合わせ</a></p>
    <p class="ft-sis">運営サイト：${(config.sisterSites || []).map((s) => `<a href="${esc(s.url)}">${esc(s.name)}</a>`).join(" ／ ")}</p>
    <p class="ft-note">当サイトは非公式のファンサイトです。記事の見出しと冒頭の一部を引用し、元記事へリンクしています。<br>『ラグナロク：アドベンチャーズ』に関する権利は Gravity Co., Ltd. &amp; Lee MyoungJin(studio DTDS) およびガンホー・オンライン・エンターテイメントに帰属します。</p>
  </div>
</footer>
<script src="/assets/app.js?v=${ver.js}" defer></script>
${scripts.map((s) => `<script src="${s}" defer></script>`).join("\n")}
</body>
</html>`;
  }

  // RO のウィンドウ風の枠
  function win(title, body, { id = "", more = "", cls = "", h = "h2", icon = "" } = {}) {
    return `<section class="win ${cls}"${id ? ` id="${id}"` : ""}>
<${h} class="win-t">${icon ? `<i class="ic ic-${icon}"></i>` : ""}<span>${title}</span>${more ? `<a class="win-more" href="${more}">一覧</a>` : ""}</${h}>
<div class="win-b">${body}</div>
</section>`;
  }

  const catTags = (ids = []) => ids.map((c) => `<span class="tag tag-${esc(c)}">${esc(catLabel[c] || c)}</span>`).join("");

  // ---------- 開催中のキャンペーン・カウントダウン ----------
  const launchAt = new Date(site.launchAt);
  const preStart = new Date("2026-08-13T12:00:00+09:00");
  const dayMs = 86400000;
  function launchBox() {
    if (now < launchAt) {
      const left = Math.ceil((launchAt - now) / dayMs);
      const pct = Math.min(99.9, ((now - preStart) / (launchAt - preStart)) * 100);
      return `<div class="lv">
<p class="lv-big">正式サービスまで <b>あと${left}日</b></p>
<p class="lv-date">${ymd(launchAt.toISOString())}（${WD[jst(launchAt.toISOString()).getUTCDay()]}）開始予定</p>
<div class="exp"><span class="exp-l">事前登録</span><span class="exp-bar"><i style="width:${pct.toFixed(1)}%"></i></span><span class="exp-n">${pct.toFixed(1)}%</span></div>
<p class="lv-note">8/13 の事前登録開始から正式サービスまでの経過</p>
</div>`;
    }
    const n = Math.floor((now - launchAt) / dayMs) + 1;
    return `<div class="lv"><p class="lv-big">サービス開始から <b>${n}日目</b></p><p class="lv-date">${ymd(launchAt.toISOString())} 正式サービス開始</p></div>`;
  }
  const campaigns = official.filter((o) => o.period && new Date(o.period.end) > now && new Date(o.period.start) <= now);
  function campaignBox() {
    if (!campaigns.length) return `<p class="muted">いま開催中のキャンペーンはありません。</p>`;
    return `<ul class="camp">${campaigns
      .map((o) => {
        const left = new Date(o.period.end) - now;
        const leftTxt = left < dayMs ? `残り${Math.max(1, Math.floor(left / 3600000))}時間` : `残り${Math.floor(left / dayMs)}日`;
        return `<li><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a><span class="camp-end">${mdhm(o.period.end)} まで <b>${leftTxt}</b></span></li>`;
      })
      .join("")}</ul>`;
  }
  const cur = store.current;
  function storeBox() {
    const rating = cur?.ratingCount ? `<b class="star">★${cur.rating.toFixed(1)}</b> <span class="muted">${num(cur.ratingCount)}件</span>` : `<span class="muted">評価はまだありません</span>`;
    return `<div class="store">
${cur?.icon ? `<img class="store-ic" src="${esc(cur.icon)}" alt="" width="60" height="60" referrerpolicy="no-referrer">` : ""}
<dl class="kv">
<dt>App Store</dt><dd>${rating}</dd>
${cur ? `<dt>バージョン</dt><dd>${esc(cur.version)}${cur.size ? `（${num(cur.size)}MB）` : ""}</dd>` : ""}
${cur ? `<dt>確認日時</dt><dd>${time(cur.checkedAt)}</dd>` : ""}
</dl></div>
<p class="btns"><a class="btn" href="${esc(config.store.appStoreUrl)}" target="_blank" rel="noopener">App Store</a><a class="btn" href="${esc(config.store.googlePlayUrl)}" target="_blank" rel="noopener">Google Play</a></p>`;
  }

  const side = (extra = "") =>
    win("ステータス", launchBox() + `<dl class="kv kv-s">${(content.spec || []).filter((r) => /ジャンル|運営|価格|対応OS/.test(r[0])).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl><p class="more-r"><a href="/info/">基本情報を見る</a></p>`, { icon: "st" }) +
    win("開催中のキャンペーン", campaignBox(), { icon: "ev" }) +
    win("アプリ", storeBox(), { icon: "ap" }) +
    win("最近の書き込み", `<ul class="rc" id="recentComments"><li class="muted">読み込み中…</li></ul><p class="more-r"><a href="/talk/">雑談に書き込む</a></p>`, { icon: "ch" }) +
    extra;

  // ---------- 一覧の部品 ----------
  // 記事は 3 段階で見せ方を変える。lead=大きい画像つき / thumb=小さい画像つき / row=文字だけ
  function newsItem(n, kind = "row") {
    const head = `<a class="n-a" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>`;
    const meta = `<p class="n-m">${catTags(n.categories)}<span class="src">${esc(n.source)}</span>${time(n.publishedAt)}</p>`;
    if (kind === "lead")
      return `<article class="n n-lead"><a class="n-img" href="${esc(n.url)}" target="_blank" rel="noopener" tabindex="-1">${img(n.image, n.source)}</a><div>${head}${n.summary ? `<p class="n-s">${esc(n.summary)}</p>` : ""}${meta}</div></article>`;
    if (kind === "thumb" && n.image)
      return `<article class="n n-thumb"><a class="n-img" href="${esc(n.url)}" target="_blank" rel="noopener" tabindex="-1">${img(n.image, n.source)}</a><div>${head}${meta}</div></article>`;
    return `<article class="n n-row">${head}${meta}</article>`;
  }
  function newsList(list, { leads = 0, thumbs = 0 } = {}) {
    let l = 0;
    let t = 0;
    // 各媒体が公式のバナーをそのまま使うことが多いので、同じ画像は 1 回だけ出す
    const used = new Set();
    return list
      .map((n) => {
        if (n.image && used.has(n.image)) return newsItem(n, "row");
        if (n.image) used.add(n.image);
        if (n.image && l < leads) {
          l++;
          return newsItem(n, "lead");
        }
        if (n.image && t < thumbs) {
          t++;
          return newsItem(n, "thumb");
        }
        return newsItem(n, "row");
      })
      .join("");
  }
  function byDay(list, opts) {
    const groups = new Map();
    for (const n of list) {
      const d = jstDay(n.publishedAt);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(n);
    }
    return [...groups]
      .map(([d, items]) => `<h3 class="day">${md(items[0].publishedAt)}<span>${items.length}件</span></h3>${newsList(items, opts)}`)
      .join("");
  }

  function officialItem(o, big = false) {
    const period = o.period ? `<p class="o-p">期間 ${mdhm(o.period.start)} 〜 ${mdhm(o.period.end)}${new Date(o.period.end) < now ? '<span class="tag tag-end">終了</span>' : new Date(o.period.start) <= now ? '<span class="tag tag-on">開催中</span>' : ""}</p>` : "";
    return `<article class="o${big ? " o-big" : ""}"><a class="o-img" href="${esc(o.url)}" target="_blank" rel="noopener" tabindex="-1">${img(o.image, o.title)}</a><div class="o-body">
<p class="o-m"><span class="tag tag-official">${esc(o.category)}</span>${time(o.publishedAt, (x) => `${ymd(x)} ${pad(jst(x).getUTCHours())}:${pad(jst(x).getUTCMinutes())}`)}</p>
<h3 class="o-t"><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a></h3>
${big && o.excerpt ? `<p class="o-x">${esc(o.excerpt.replace(/▼[\s\S]*$/, "").slice(0, 110))}</p>` : ""}${period}</div></article>`;
  }

  const shortVideo = (t) => t.replace(/^【[^】]+】/, "").replace(/｜事前登録受付中！?$/, "").trim();
  function viewsGain(v) {
    const log = v.viewsLog || [];
    if (log.length < 2) return "";
    const g = log[log.length - 1][1] - log[log.length - 2][1];
    return g > 0 ? `<span class="gain">+${num(g)}</span>` : "";
  }
  function videoCard(v, { play = false } = {}) {
    return `<article class="v" id="v-${esc(v.id)}">
<a class="v-img yt" href="${esc(v.url)}" data-yt="${play ? esc(v.id) : ""}" target="_blank" rel="noopener">${img(v.thumb, "動画")}<i class="v-play" aria-hidden="true"></i></a>
<h3 class="v-t">${esc(shortVideo(v.title))}</h3>
<p class="v-m">${time(v.publishedAt, md)}<span>${num(v.views)}回再生</span>${viewsGain(v)}</p>
</article>`;
  }

  function commentsHtml(id, title) {
    return `<section class="win comments" id="comments" data-work="${esc(id)}" data-title="${esc(title)}">
<h2 class="win-t"><i class="ic ic-ch"></i><span>チャット<span class="c-count" id="cCount"></span></span></h2>
<div class="win-b">
<p class="c-rule">URL は書き込めません。悪口・晒し・リアルマネートレードの話は削除します。</p>
<div class="c-list" id="cList"><p class="c-empty">読み込み中…</p></div>
<form class="c-form" id="cForm" novalidate>
<div class="c-row"><label>名前<input type="text" name="name" maxlength="20" placeholder="名無しの冒険者" autocomplete="nickname"></label>
<label class="c-sp"><input type="checkbox" name="spoiler" value="1"> ネタバレ</label></div>
<label class="c-body-label">本文<textarea name="body" rows="4" maxlength="500" required></textarea></label>
<input type="text" name="website" class="c-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<div class="c-foot"><span class="c-len" id="cLen">0 / 500</span><button type="submit">書き込む</button></div>
<p class="c-msg" id="cMsg" role="status"></p>
</form>
<noscript><p class="c-empty">書き込みを見るには JavaScript を有効にしてください。</p></noscript>
</div></section>`;
  }
  const commentScripts = [`/assets/comments.js?v=${ver.comments}`];

  // ---------- トップ ----------
  {
    const latestOfficial = official.slice(0, 4);
    const topics = (state.topics || []).slice(0, 5);
    const ragadRecent = ragad.slice(0, 16);
    const topicHtml = topics.length
      ? `<ol class="tp">${topics
          .map(
            (t) => `<li><a href="${esc(t.url)}" target="_blank" rel="noopener" class="tp-a">${esc(t.title)}</a> <span class="slot" title="${t.sourceCount}媒体が報じた">[${t.sourceCount}]</span>
<p class="tp-m">${esc(t.leadSource)} ほか：${t.articles
              .slice(0, 5)
              .map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.source)}</a>`)
              .join("、")}　${time(t.publishedAt)}</p></li>`
          )
          .join("")}</ol>`
      : "";
    const body = `
${win("公式のお知らせ", latestOfficial.length ? officialItem(latestOfficial[0], true) + `<div class="o-list">${latestOfficial.slice(1).map((o) => officialItem(o)).join("")}</div>` : '<p class="muted">まだありません。</p>', { more: "/official/", icon: "of", cls: "win-official" })}
${topicHtml ? win("話題", topicHtml, { icon: "tp" }) : ""}
${win("ラグアドのニュース", ragadRecent.length ? newsList(ragadRecent, { leads: 2, thumbs: 6 }) : '<p class="muted">まだありません。</p>', { more: "/news/", icon: "nw" })}
${win("公式動画", `<div class="vg">${videos.slice(0, 6).map((v) => videoCard(v, { play: true })).join("")}</div>`, { more: "/videos/", icon: "yt" })}
${win("ゲームシステム", sysGrid(6), { more: "/system/", icon: "sy" })}
${win("RO・ラグナロクシリーズの話題", series.length ? newsList(series.slice(0, 8), { thumbs: 2 }) : '<p class="muted">まだありません。</p>', { more: "/series/", icon: "ro" })}`;
    put("/", layout({ path: "/", title: site.title, desc: site.tagline, body, side: side(), scripts: commentScripts }), { priority: 1 });
  }

  // システムの一覧（動画のサムネイルがあればそれを使う）
  function sysStats(s) {
    const vs = videos.filter((v) => (v.systems || []).includes(s.id));
    const ns = ragad.filter((n) => (n.systems || []).includes(s.id));
    return { vs, ns };
  }
  function sysGrid(limit = 99) {
    const list = (config.systems || []).map((s) => ({ s, ...sysStats(s) }));
    // 動画があるものを先に
    list.sort((a, b) => (b.vs.length ? 1 : 0) - (a.vs.length ? 1 : 0));
    return `<div class="sg">${list
      .slice(0, limit)
      .map(
        ({ s, vs, ns }) => `<a class="sg-i" href="/system/${s.id}/">${vs[0] ? img(vs[0].thumb, s.name) : `<span class="noimg"><span>${esc(s.name)}</span></span>`}<b>${esc(s.name)}</b><span class="sg-n">動画${vs.length}・記事${ns.length}</span></a>`
      )
      .join("")}</div>`;
  }

  // ---------- 公式 ----------
  put(
    "/official/",
    layout({
      path: "/official/",
      title: "公式のお知らせ",
      desc: "ラグナロク：アドベンチャーズ公式サイトのお知らせの一覧。キャンペーンの期間も抜き出しています。",
      body: win("公式のお知らせ", `<p class="lead">公式サイト（ragnarokadv.gungho.jp）のお知らせを、出た順に並べています。本文は公式サイトで読めます。</p><div class="o-list o-list-all">${official.map((o) => officialItem(o, true)).join("")}</div>`, { h: "h1", icon: "of" }),
      side: side(),
    }),
    { priority: 0.8 }
  );

  // ---------- ニュース ----------
  put(
    "/news/",
    layout({
      path: "/news/",
      title: "ラグアドのニュース",
      desc: "ゲーム媒体が報じたラグナロク：アドベンチャーズの記事を日ごとにまとめています。",
      body: win("ラグアドのニュース", `<p class="lead">ファミ通・4Gamer・攻略サイトなどの記事を日ごとに並べています（全${ragad.length}件）。</p>${byDay(ragad.slice(0, 400), { thumbs: 999 })}`, { h: "h1", icon: "nw" }),
      side: side(),
    }),
    { priority: 0.8 }
  );
  put(
    "/series/",
    layout({
      path: "/series/",
      title: "RO・ラグナロクシリーズの話題",
      desc: "ラグナロクオンライン（RO）やラグナロクマスターズなど、ラグナロクシリーズのニュース。",
      body: win("RO・ラグナロクシリーズの話題", `<p class="lead">本家ラグナロクオンラインをはじめ、ラグナロクシリーズの記事です（全${series.length}件）。</p>${byDay(series.slice(0, 400), { thumbs: 999 })}`, { h: "h1", icon: "ro" }),
      side: side(),
    }),
    { priority: 0.6 }
  );

  // ---------- 動画 ----------
  put(
    "/videos/",
    layout({
      path: "/videos/",
      title: "公式動画",
      desc: "ラグナロク：アドベンチャーズ公式YouTubeチャンネルの動画。PV やシステム紹介をまとめて見られます。",
      body: win("公式動画", `<p class="lead">公式 YouTube チャンネル（<a href="https://www.youtube.com/@${esc(config.youtube.handle)}" target="_blank" rel="noopener">@${esc(config.youtube.handle)}</a>）の動画です。サムネイルを押すとこのページで再生します。緑の数字は前日からの再生数の伸びです。</p><div class="vg">${videos.map((v) => videoCard(v, { play: true })).join("")}</div>`, { h: "h1", icon: "yt" }),
      side: side(),
    }),
    { priority: 0.7 }
  );

  // ---------- システム ----------
  const index = { talk: { title: "雑談", path: "/talk/" } };
  put(
    "/system/",
    layout({
      path: "/system/",
      title: "ゲームシステム",
      desc: "ラグナロク：アドベンチャーズのゲームシステムを、公式動画・記事ごとにまとめています。",
      body: win("ゲームシステム", `<p class="lead">公式サイト・ストアの説明と公式動画から、システムごとにページを作っています。動画や記事は見出しの言葉で自動で振り分けています。</p>${sysGrid()}`, { h: "h1", icon: "sy" }),
      side: side(),
    }),
    { priority: 0.7 }
  );
  for (const s of config.systems || []) {
    const { vs, ns } = sysStats(s);
    const cid = `sys-${s.id}`;
    index[cid] = { title: s.name, path: `/system/${s.id}/` };
    const first = vs[0];
    const body = `${win(
      esc(s.name),
      `<p class="crumb"><a href="/system/">ゲームシステム</a> › ${esc(s.name)}</p>
${first ? `<div class="embed"><a class="v-img yt" href="${esc(first.url)}" data-yt="${esc(first.id)}" target="_blank" rel="noopener">${img(first.thumb.replace("hqdefault", "maxresdefault"), s.name)}<i class="v-play"></i></a><p class="embed-t">${esc(shortVideo(first.title))}</p></div>` : ""}
<p class="sys-d">${esc(s.desc)}</p><p class="note">出典：公式サイト・App Store の説明、公式動画。正式サービス前の情報を含みます。</p>`,
      { h: "h1", icon: "sy" }
    )}
${vs.length > 1 ? win("関連する公式動画", `<div class="vg">${vs.slice(1).map((v) => videoCard(v, { play: true })).join("")}</div>`, { icon: "yt" }) : ""}
${ns.length ? win("関連する記事", newsList(ns.slice(0, 30), { thumbs: 6 }), { icon: "nw" }) : ""}
${commentsHtml(cid, s.name)}`;
    put(`/system/${s.id}/`, layout({ path: `/system/${s.id}/`, title: `${s.name}（ゲームシステム）`, desc: `ラグアドの${s.name}。${s.desc}`.slice(0, 120), body, side: side(), image: first?.thumb.replace("hqdefault", "maxresdefault") || "", scripts: commentScripts }), { priority: 0.6 });
  }

  // ---------- 基本情報 ----------
  {
    const spec = `<table class="tb"><tbody>${(content.spec || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
    const tl = `<ol class="tl">${(content.timeline || []).map(([d, t]) => `<li class="${new Date(d + "T23:59:59+09:00") < now ? "done" : "next"}"><time>${d.replace(/-/g, "/")}</time><span>${esc(t)}</span></li>`).join("")}</ol>`;
    const party = `<div class="pt">
<div class="pt-i pt-hero"><span class="job">${esc(content.hero?.role)}</span><b>${esc(content.hero?.name)}</b><p>${esc(content.hero?.text)}</p></div>
${(content.party || []).map((p) => `<div class="pt-i"><span class="job">${esc(p.job)}</span><b>${esc(p.name)}</b><p>${esc(p.text)}</p></div>`).join("")}</div>`;
    const rewards = (content.rewards || [])
      .map(
        (r) => `<h3 class="sub">${esc(r.name)}</h3><table class="tb tb-item"><thead><tr><th>アイテム</th><th>個数</th><th>説明</th></tr></thead><tbody>${r.items
          .map(([n, c, d]) => `<tr><td class="item">${esc(n)}</td><td class="cnt">${esc(c)}</td><td>${esc(d)}</td></tr>`)
          .join("")}</tbody></table>`
      )
      .join("");
    const shots = cur?.screenshots?.length ? `<div class="shots">${cur.screenshots.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${img(u, "スクリーンショット")}</a>`).join("")}</div><p class="note">App Store に載っているスクリーンショットです（開発中の画面を含みます）。</p>` : "";
    const hist = (store.history || []).length
      ? `<table class="tb"><thead><tr><th>バージョン</th><th>公開日</th><th>内容</th></tr></thead><tbody>${store.history.map((h) => `<tr><td>${esc(h.version)}</td><td>${h.date ? ymd(h.date) : ""}</td><td class="pre">${esc(h.notes || "")}</td></tr>`).join("")}</tbody></table><p class="note">App Store のバージョンが変わるたびに記録しています。</p>`
      : "";
    const body = `${win("基本情報", `${spec}<p class="note">出典：公式サイト・App Store（${ymd("2026-10-25T00:00:00+09:00")} 確認）。</p>`, { h: "h1", icon: "st" })}
${win("これまでの動き", tl, { icon: "ev" })}
${win("主人公と冒険の仲間", party + '<p class="note">公式サイトのキャラクター紹介を要約しています。</p>', { icon: "pt" })}
${win("事前登録特典", `<p class="lead">正式サービス開始時に全員に配られるアイテムです（公式の事前登録特設ページより）。</p>${rewards}`, { icon: "it", id: "rewards" })}
${win("ゲーム内のお金・鍵", `<table class="tb"><tbody>${(content.currencies || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`, { icon: "it" })}
${shots ? win("ゲーム画面", shots, { icon: "ap" }) : ""}
${hist ? win("アプリの更新履歴", hist, { icon: "ap" }) : ""}`;
    put("/info/", layout({ path: "/info/", title: "基本情報・事前登録特典", desc: "ラグナロク：アドベンチャーズの配信日・対応OS・仲間キャラクター・事前登録特典のアイテム一覧など。", body, side: side() }), { priority: 0.8 });
  }

  // ---------- リンク ----------
  {
    const groups = new Map();
    for (const l of config.links || []) {
      if (!groups.has(l.group)) groups.set(l.group, []);
      groups.get(l.group).push(l);
    }
    const guideNews = ragad.filter((n) => (n.categories || []).includes("guide")).slice(0, 20);
    const body =
      win(
        "リンク集",
        [...groups].map(([g, ls]) => `<h3 class="sub">${esc(g)}</h3><ul class="lk">${ls.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a><span class="muted">${esc(new URL(l.url).hostname)}</span></li>`).join("")}</ul>`).join(""),
        { h: "h1", icon: "lk" }
      ) + (guideNews.length ? win("攻略サイトの新しい記事", newsList(guideNews), { icon: "nw" }) : "");
    put("/links/", layout({ path: "/links/", title: "リンク集", desc: "ラグアドの公式サイト・公式X・ストア・攻略サイトへのリンク。", body, side: side() }), { priority: 0.4 });
  }

  // ---------- 雑談 ----------
  put(
    "/talk/",
    layout({
      path: "/talk/",
      title: "雑談",
      desc: "ラグナロク：アドベンチャーズについて自由に書き込める雑談スペース。",
      body: win("雑談", `<p class="lead">ラグアドの話ならなんでもどうぞ。職業の相談、ギルドの話、本家 RO の思い出話も歓迎です。</p>`, { h: "h1", icon: "ch" }) + commentsHtml("talk", "雑談"),
      side: side(),
      scripts: commentScripts,
    }),
    { priority: 0.5 }
  );

  // ---------- このサイトについて・404 ----------
  put(
    "/about/",
    layout({
      path: "/about/",
      title: "このサイトについて",
      desc: "ラグアド速報について。",
      body: win(
        "このサイトについて",
        `<div class="prose">
<p>ラグアド速報は、スマホ向けRPG『ラグナロク：アドベンチャーズ』（ラグアド）の情報を集めている非公式のファンサイトです。</p>
<p>集めているもの：</p>
<ul>
<li>公式サイトのお知らせ（見出し・冒頭・バナー画像）</li>
<li>公式 YouTube チャンネルの動画</li>
<li>App Store のバージョン・評価・更新内容</li>
<li>Google ニュースに載ったゲーム媒体・攻略サイトの記事（見出しと元記事の画像）</li>
</ul>
<p>約30分おきに自動で集め直しています。記事の本文は載せていません。続きは元の記事でお読みください。</p>
<p>「ゲームシステム」の説明と「基本情報」は、公式サイトと App Store の説明を要約して手で書いています。正式サービス前の情報なので、配信後に変わることがあります。</p>
<p>掲載内容に問題がある場合は <a href="${esc(site.contactUrl)}" target="_blank" rel="noopener">お問い合わせ</a> からご連絡ください。</p>
</div>`,
        { h: "h1", icon: "st" }
      ),
      side: side(),
    }),
    { priority: 0.2 }
  );
  put("/404.html", layout({ path: "/404.html", title: "ページが見つかりません", desc: "ページが見つかりません。", body: win("ページが見つかりません", `<p>お探しのページは移動したか、なくなりました。</p><p><a href="/">トップへ戻る</a></p>`, { h: "h1" }), noindex: true }), { index: false });

  // ---------- 書き出し ----------
  for (const p of pages) {
    const file = p.path.endsWith(".html") ? join(DOCS, p.path) : join(DOCS, p.path, "index.html");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, minifyHtml(p.html), "utf8");
  }
  // 設定から消えたシステムのページを残さない
  try {
    const ids = new Set((config.systems || []).map((s) => s.id));
    for (const d of await readdir(join(DOCS, "system"), { withFileTypes: true })) if (d.isDirectory() && !ids.has(d.name)) await rm(join(DOCS, "system", d.name), { recursive: true });
  } catch {}

  // コメントを受け付けるページの一覧（api/comments.php が読む）
  await mkdir(join(DOCS, "data"), { recursive: true });
  await writeFile(join(DOCS, "data", "works-index.json"), JSON.stringify(index), "utf8");

  // sitemap.xml
  const sm = pages
    .filter((p) => p.index)
    .map((p) => `<url><loc>${esc(base + p.path)}</loc><lastmod>${updatedAt.slice(0, 10)}</lastmod><priority>${p.priority}</priority></url>`)
    .join("");
  await writeFile(join(DOCS, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sm}</urlset>\n`, "utf8");

  // feed.xml（公式のお知らせとラグアドのニュース）
  const feedItems = [
    ...official.map((o) => ({ title: `【公式】${o.title}`, url: o.url, at: o.publishedAt, desc: o.excerpt })),
    ...ragad.slice(0, 40).map((n) => ({ title: n.title, url: n.url, at: n.publishedAt, desc: n.source })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 50);
  await writeFile(
    join(DOCS, "feed.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(site.title)}</title><link>${esc(site.url)}</link><description>${esc(site.tagline)}</description><language>ja</language><lastBuildDate>${new Date(updatedAt).toUTCString()}</lastBuildDate>${feedItems
      .map((i) => `<item><title>${esc(i.title)}</title><link>${esc(i.url)}</link><guid>${esc(i.url)}</guid><pubDate>${new Date(i.at).toUTCString()}</pubDate><description>${esc(i.desc || "")}</description></item>`)
      .join("")}</channel></rss>\n`,
    "utf8"
  );
  log(`pages: ${pages.length} written`);
}
