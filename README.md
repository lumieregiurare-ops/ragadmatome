# ラグアド速報

スマホ向けRPG『ラグナロク：アドベンチャーズ』（ラグアド）の情報をまとめるサイトです。naroumatome を元にしています。`docs/` がサイトルートで、ロリポップ（FTP）に置いて公開します。公開先は `https://ragadmatome.gamelab.website/`。

見た目は本家ラグナロクオンラインのゲーム内ウィンドウと全体チャットに寄せています。ロゴとファビコンはオリジナルのドット絵のスライムで、公式の絵は使っていません。

## 集めているもの

| 集め先 | 中身 | 保存先 |
| --- | --- | --- |
| 公式サイトのお知らせ（`/articles` の JSON） | 見出し・バナー画像・本文の冒頭・キャンペーン期間 | `data/official.json` |
| 公式 YouTube の RSS | 動画・再生数（日ごとに記録して伸びを出す） | `data/videos.json` |
| App Store の lookup API | 評価・バージョン・更新内容・スクリーンショット | `data/store.json` |
| Google ニュースの検索 | ゲーム媒体・攻略サイトの記事（見出しと元記事の og:image） | `data/archive/` |

ニュースは見出しに「ラグナロク：アドベンチャーズ」「ラグアド」があればラグアドの記事、「ラグナロク」だけならシリーズ（RO 本家など）の記事に分けます。キーワードは `config.json` の `keywords`。

## 使い方

```bash
npm install                          # esbuild / sharp（ビルド用のみ）
node scripts/collect.mjs             # 集めてページを作る
node scripts/collect.mjs --backfill  # 初回だけ。Google ニュースを 90 日さかのぼる
node scripts/build.mjs               # site/ を最小化して docs/ に出力し、ページを作る
python scripts/make-og.py            # ロゴ・ファビコン・OGP 画像を作り直す（普段は不要）
```

画面を確かめるときは、コメントも動くように XAMPP の PHP で `docs/` を配信します（`http://127.0.0.1:3295/`）。

```bash
C:\xampp\php\php.exe -S 127.0.0.1:3295 -t docs
```

編集するのは `site/`・`scripts/`・`config.json`・`content.json` です。`docs/` は直接編集しないでください（次のビルドで上書きされます）。HTML はすべて `scripts/lib/pages.mjs` が作ります。

## ページ

| URL | 内容 |
| --- | --- |
| `/` | 公式のお知らせ・複数媒体が報じた話題・ニュース・公式動画・システム・シリーズの話題 |
| `/official/` `/news/` `/series/` `/videos/` | それぞれの一覧 |
| `/system/` `/system/<id>/` | ゲームシステムごとのページ（公式動画・記事・チャット欄） |
| `/info/` | 基本情報・これまでの動き・キャラクター・事前登録特典・アプリの更新履歴 |
| `/talk/` | 雑談（チャット欄） |
| `/links/` `/about/` `/404.html` `/feed.xml` `/sitemap.xml` | |

## 手で更新するもの

- `content.json` … 基本情報・これまでの動き・キャラクター・事前登録特典。公式サイトとストアの説明から書いたもの。新しい発表があれば足す
- `config.json` の `systems` … ゲームシステムの一覧。`keywords` が動画タイトルや記事の見出しに当たると、そのシステムのページに並ぶ。サービスが始まって新しいコンテンツが出たら足す
- `config.json` の `links` … 攻略サイトなど

## コメント（チャット欄）

naroumatome と同じ仕組みです（`site/api/` の PHP、保存はサーバーの `api/data/`）。コメントを受け付けるページは `docs/data/works-index.json`（`pages.mjs` が書く）にあるものだけ。

**管理画面** `https://ragadmatome.gamelab.website/api/admin.php` を使うには、サーバーの `api/data/admin.php` に次の 1 行だけのファイルを置いてください（FTP の自動アップロードでは送りません）。

```php
<?php return 'ここにパスワード';
```

## 更新の間隔・公開の設定

naroumatome と同じです。GitHub Actions の cron は当てにならないので、ロリポップの cron から `repository_dispatch` を叩きます。trend-video-watcher の `tools/trigger-collect.php` の `REPOS` に `lumieregiurare-ops/ragadmatome` を足してください（サーバーのファイルも差し替える）。

**Secrets**: `LOLIPOP_FTP_SERVER` / `LOLIPOP_FTP_USER` / `LOLIPOP_FTP_PASSWORD`
**Variables**: `DEPLOY_TARGET` = `lolipop`、`LOLIPOP_SERVER_DIR` = サブドメインの公開ディレクトリ（末尾のスラッシュ必須）

サブドメインを変える場合は `config.json` の `site.url`、`site/robots.txt`、`scripts/make-og.py`（OGP 画像の URL）を直してください。アナリティクスを入れるときは `config.json` の `site.gaId` に測定 ID を書きます。
