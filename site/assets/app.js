// ページは HTML に焼き込み済み。ここでやるのは、動画のその場再生・読めない画像の差し替え・最近の書き込みの表示だけ。
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 外部の画像が読めないとき（リンク切れ・直リンク禁止）は、媒体名の札にする
  function fallback(img) {
    var s = document.createElement("span");
    s.className = "noimg " + (img.className || "");
    s.innerHTML = "<span>" + esc(img.getAttribute("data-alt") || "") + "</span>";
    img.replaceWith(s);
  }
  Array.prototype.forEach.call(document.images, function (img) {
    if (!img.hasAttribute("data-alt")) return;
    if (img.complete && img.naturalWidth === 0) fallback(img);
    else img.addEventListener("error", function () { fallback(img); });
  });
  // maxresdefault が無い動画は 120x90 の灰色画像が返るので、hqdefault に戻す
  Array.prototype.forEach.call(document.querySelectorAll('img[src*="maxresdefault"]'), function (img) {
    function check() {
      if (img.naturalWidth && img.naturalWidth <= 120) img.src = img.src.replace("maxresdefault", "hqdefault");
    }
    if (img.complete) check();
    else img.addEventListener("load", check);
  });

  // 動画はクリックしたときだけ iframe にする（最初から並べると重いため）
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-yt]");
    if (!a || !a.getAttribute("data-yt") || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    var f = document.createElement("iframe");
    f.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(a.getAttribute("data-yt")) + "?autoplay=1&rel=0";
    f.title = "YouTube";
    f.allow = "autoplay; encrypted-media; picture-in-picture";
    f.allowFullscreen = true;
    f.className = "v-frame";
    a.replaceWith(f);
  });

  // サイドの「最近の書き込み」
  var rc = document.getElementById("recentComments");
  if (rc) {
    fetch("/api/comments.php?recent=1")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var items = ((j && j.items) || []).slice(0, 6);
        if (!items.length) {
          rc.innerHTML = '<li class="muted">まだ書き込みはありません。</li>';
          return;
        }
        rc.innerHTML = items
          .map(function (c) {
            var body = c.sp ? "（ネタバレ）" : String(c.body || "").slice(0, 40);
            return '<li><a href="' + esc(c.path) + "#c-" + esc(c.no) + '"><b>' + esc(c.name) + "</b> : " + esc(body) + '</a><span class="rc-w">' + esc(c.title) + "</span></li>";
          })
          .join("");
      })
      .catch(function () {
        rc.innerHTML = '<li class="muted">読み込めませんでした。</li>';
      });
  }
})();
