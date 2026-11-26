# Ad Tag Checker（広告タグチェッカー）

A Chrome extension that shows which ad and analytics tags fire on the current page — across platforms, in one popup — and whether ad click IDs survive redirects.

表示中のページで、どの広告・計測タグが発火しているかを媒体横断で一覧表示する Chrome 拡張機能です。広告クリック用のパラメータがリダイレクトで消えていないかも確認できます。

## Supported tags / 対応タグ

| Tag | 判定に使う通信 |
|---|---|
| Google Tag Manager | `gtm.js` の読み込み（コンテナID） |
| Google Analytics 4 | `/g/collect`（イベント名・測定ID。まとめ送信にも対応） |
| Google 広告 | コンバージョン（ラベル付き）、リマーケティング |
| Meta ピクセル | `/tr`（イベント名・ピクセルID。POST にも対応） |
| Yahoo!広告 | `ytag.js`、`b9x.yahoo.co.jp` への送信（コンバージョン・リターゲティングを推定） |
| LINE Tag | `tr.line.me` |
| TikTok ピクセル | `/api/v2/pixel`（イベント名・ピクセルコード） |
| X（Twitter）ピクセル | `/i/adsct` |
| Microsoft 広告（UET） | `bat.bing.com/action`（イベント・金額） |
| SmartNews 広告 | `smartnews-ads.com` |

Status: **Fired**（送信あり）/ **Loaded, not fired**（タグは読み込まれたが送信なし）/ Not detected（未検出）

## Click parameter check / パラメータ落ちチェック

`gclid` `gbraid` `wbraid` `yclid` `fbclid` `ldtag_cl` `ttclid` `twclid` `msclkid` `utm_*` が、最初に開いたURLから最終的なページまで残っているかを表示します（サーバー側・JavaScript のリダイレクトの両方を追跡）。

広告のリンク先URLに `?gclid=test` などを付けて開くと確認できます。

## Install / インストール（開発版）

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」をオン
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
4. 確認したいページを開き（または再読み込みし）、ツールバーのアイコンをクリック

インストール時に「すべてのサイトのデータの読み取りと変更」の権限が表示されます。どのサイトでもタグの通信を確認するために必要な権限です。記録はブラウザ内（タブを閉じると消える一時領域）にだけ保存し、外部には送信しません。

## Files / ファイル構成

| File | Role |
|---|---|
| `manifest.json` | 拡張機能の設定 |
| `vendors.js` | タグの定義と通信の解析（媒体の仕様が変わったらここを更新） |
| `background.js` | タブごとの記録（リダイレクト経路・タグの通信） |
| `popup.html` / `popup.css` / `popup.js` | ポップアップ画面（英語・日本語、ダーク・ライト切り替え） |
| `theme-init.js` | 表示前にテーマと言語を反映 |
| `_locales/` | 拡張機能名・説明文（英語・日本語） |
| `icons/` | アイコン |

`popup.html` をブラウザで直接開くと、デモデータで画面を確認できます。

## Notes / 注意

- Yahoo!広告・LINE・SmartNews の送信先は公開仕様が少ないため、通信先からの推定で判定しています。
- サーバーサイド計測（サーバー GTM・Conversions API など）はブラウザの通信に現れないため検出できません。
