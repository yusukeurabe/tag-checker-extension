// =============================================================
// 検出する計測タグの定義と、通信（リクエスト）の解析
// -------------------------------------------------------------
// ・background.js（importScripts）と popup.html（<script>）の両方で読み込む。
// ・各タグは「読み込み（load）」と「発火（hit）」の2種類の通信で判定する。
//     load … タグ本体の JavaScript が読み込まれた
//     hit  … 計測データが実際に送信された（PageView・コンバージョンなど）
// ・媒体の仕様変更で通信先が変わることがあります。その場合はここを更新してください。
// =============================================================
(function (root) {
  "use strict";

  // --- 共通ヘルパー --------------------------------------------------
  const qp = (url, ...names) => {
    for (const n of names) {
      const v = url.searchParams.get(n);
      if (v) return v;
    }
    return "";
  };

  // リクエスト本文を文字列で取り出す（POST で送られる計測データ用）
  function bodyText(body) {
    if (!body) return "";
    if (body.raw && body.raw.length) {
      try {
        return body.raw
          .filter((p) => p.bytes)
          .map((p) => new TextDecoder().decode(p.bytes))
          .join("");
      } catch (e) {
        return "";
      }
    }
    return "";
  }
  const formValue = (body, name) => (body && body.formData && body.formData[name] ? body.formData[name][0] : "");

  // --- タグの定義 -----------------------------------------------------
  // match(url: URL, body) → null | { kind: "load"|"hit", ids: string[], events: [{ name, detail }] }
  const VENDORS = [
    {
      id: "gtm",
      name: { en: "Google Tag Manager", ja: "Google タグマネージャー" },
      hosts: ["*://www.googletagmanager.com/*"],
      match(u) {
        if (u.hostname === "www.googletagmanager.com" && u.pathname === "/gtm.js") {
          return { kind: "load", ids: [qp(u, "id")].filter(Boolean), events: [] };
        }
        return null;
      },
      // GTM はコンテナが読み込まれれば動作しているとみなす
      loadCountsAsFired: true,
    },
    {
      id: "ga4",
      name: { en: "Google Analytics 4", ja: "Google アナリティクス 4" },
      hosts: [
        "*://www.googletagmanager.com/*",
        "*://*.google-analytics.com/*",
        "*://analytics.google.com/*",
      ],
      match(u, body) {
        if (u.hostname === "www.googletagmanager.com" && u.pathname === "/gtag/js") {
          const id = qp(u, "id");
          return /^G-/i.test(id) ? { kind: "load", ids: [id], events: [] } : null;
        }
        if (/(^|\.)google-analytics\.com$|^analytics\.google\.com$/.test(u.hostname) && /\/g\/collect$/.test(u.pathname)) {
          const tid = qp(u, "tid");
          const events = [];
          if (u.searchParams.get("en")) events.push({ name: u.searchParams.get("en"), detail: "" });
          // まとめて送られた場合は本文に1行ずつ入っている
          for (const line of bodyText(body).split(/\r?\n/)) {
            const m = /(?:^|&)en=([^&]+)/.exec(line);
            if (m) events.push({ name: decodeURIComponent(m[1]), detail: "" });
          }
          if (!events.length) events.push({ name: "hit", detail: "" });
          return { kind: "hit", ids: [tid].filter(Boolean), events };
        }
        return null;
      },
    },
    {
      id: "gads",
      name: { en: "Google Ads", ja: "Google 広告" },
      hosts: [
        "*://www.googletagmanager.com/*",
        "*://www.googleadservices.com/*",
        "*://googleads.g.doubleclick.net/*",
        "*://www.google.com/pagead/*",
        "*://www.google.co.jp/pagead/*",
      ],
      match(u) {
        if (u.hostname === "www.googletagmanager.com" && u.pathname === "/gtag/js") {
          const id = qp(u, "id");
          return /^AW-/i.test(id) ? { kind: "load", ids: [id], events: [] } : null;
        }
        let m = /\/pagead\/(?:conversion|1p-conversion)\/(\d+)\/?/.exec(u.pathname);
        if (m && /googleadservices\.com$|^www\.google\./.test(u.hostname)) {
          const label = qp(u, "label");
          return { kind: "hit", ids: ["AW-" + m[1]], events: [{ name: "conversion", detail: label ? "label: " + label : "" }] };
        }
        m = /\/pagead\/(?:viewthroughconversion|1p-user-list)\/(\d+)\/?/.exec(u.pathname);
        if (m) {
          return { kind: "hit", ids: ["AW-" + m[1]], events: [{ name: "remarketing", detail: "" }] };
        }
        return null;
      },
    },
    {
      id: "meta",
      name: { en: "Meta Pixel", ja: "Meta ピクセル" },
      hosts: ["*://connect.facebook.net/*", "*://www.facebook.com/tr*", "*://facebook.com/tr*"],
      match(u, body) {
        if (u.hostname === "connect.facebook.net" && /fbevents\.js$/.test(u.pathname)) {
          return { kind: "load", ids: [], events: [] };
        }
        if (u.hostname === "connect.facebook.net" && /\/signals\/config\/(\d+)/.test(u.pathname)) {
          return { kind: "load", ids: [/\/signals\/config\/(\d+)/.exec(u.pathname)[1]], events: [] };
        }
        if (/(^|\.)facebook\.com$/.test(u.hostname) && /^\/tr\/?$/.test(u.pathname)) {
          const id = qp(u, "id") || formValue(body, "id");
          const ev = qp(u, "ev") || formValue(body, "ev") || "hit";
          return { kind: "hit", ids: [id].filter(Boolean), events: [{ name: ev, detail: "" }] };
        }
        return null;
      },
    },
    {
      id: "yahoo",
      name: { en: "Yahoo! Ads", ja: "Yahoo!広告" },
      hosts: ["*://s.yimg.jp/*", "*://*.yahoo.co.jp/*"],
      match(u) {
        if (u.hostname === "s.yimg.jp" && /\/ytag\.js$/.test(u.pathname)) {
          return { kind: "load", ids: [], events: [] };
        }
        if (/^b9\d\.yahoo\.co\.jp$/.test(u.hostname)) {
          // パラメータ名に yahoo_ が付くID（コンバージョンID・リターゲティングIDなど）を拾う
          const ids = [];
          for (const [k, v] of u.searchParams) {
            if (/^yahoo_.*(id|io)$/i.test(k) && v) ids.push(v);
          }
          const s = u.pathname + u.search;
          let name = "hit";
          if (/retargeting/i.test(s)) name = "retargeting";
          else if (/ydn_conv|\/c$|\/c\?/i.test(s)) name = "conversion (display)";
          else if (/conversion/i.test(s)) name = "conversion (search)";
          else if (/sgt|general/i.test(s)) name = "site general tag";
          const label = qp(u, "label", "yahoo_conversion_label");
          return { kind: "hit", ids, events: [{ name, detail: label ? "label: " + label : "" }] };
        }
        return null;
      },
    },
    {
      id: "line",
      name: { en: "LINE Tag", ja: "LINE Tag" },
      hosts: ["*://d.line-scdn.net/*", "*://tr.line.me/*"],
      match(u) {
        if (u.hostname === "d.line-scdn.net" && /line_tag/.test(u.pathname)) {
          return { kind: "load", ids: [], events: [] };
        }
        if (u.hostname === "tr.line.me") {
          const id = qp(u, "t_id", "tid", "id");
          const ev = qp(u, "e", "ev", "event") || "hit";
          return { kind: "hit", ids: [id].filter(Boolean), events: [{ name: ev, detail: "" }] };
        }
        return null;
      },
    },
    {
      id: "tiktok",
      name: { en: "TikTok Pixel", ja: "TikTok ピクセル" },
      hosts: ["*://analytics.tiktok.com/*"],
      match(u, body) {
        if (/\/pixel\/events\.js$/.test(u.pathname)) {
          return { kind: "load", ids: [qp(u, "sdkid")].filter(Boolean), events: [] };
        }
        if (/\/api\/v\d\/pixel/.test(u.pathname)) {
          const ids = [];
          const events = [];
          try {
            const j = JSON.parse(bodyText(body) || "{}");
            for (const e of j.batch || [j]) {
              const code = e.context && e.context.pixel && e.context.pixel.code;
              if (code && !ids.includes(code)) ids.push(code);
              if (e.event) events.push({ name: e.event, detail: "" });
            }
          } catch (e) { /* 本文が読めなくても発火は記録する */ }
          if (!events.length) events.push({ name: "hit", detail: "" });
          return { kind: "hit", ids, events };
        }
        return null;
      },
    },
    {
      id: "x",
      name: { en: "X (Twitter) Pixel", ja: "X（Twitter）ピクセル" },
      hosts: ["*://static.ads-twitter.com/*", "*://analytics.twitter.com/*", "*://t.co/i/adsct*"],
      match(u) {
        if (u.hostname === "static.ads-twitter.com" && /uwt\.js$/.test(u.pathname)) {
          return { kind: "load", ids: [], events: [] };
        }
        if (/\/i\/adsct/.test(u.pathname)) {
          const id = qp(u, "txn_id", "p_id");
          let ev = "hit";
          const raw = qp(u, "events");
          const m = /\[\s*\[\s*"([^"]+)"/.exec(raw);
          if (m) ev = m[1];
          return { kind: "hit", ids: [id].filter(Boolean), events: [{ name: ev, detail: "" }] };
        }
        return null;
      },
    },
    {
      id: "uet",
      name: { en: "Microsoft Ads (UET)", ja: "Microsoft 広告（UET）" },
      hosts: ["*://bat.bing.com/*"],
      match(u) {
        if (/\/bat\.js$/.test(u.pathname)) return { kind: "load", ids: [], events: [] };
        if (/^\/action\//.test(u.pathname)) {
          const evt = qp(u, "evt") || "hit";
          const ea = qp(u, "ea");
          return {
            kind: "hit",
            ids: [qp(u, "ti")].filter(Boolean),
            events: [{ name: ea ? `${evt}: ${ea}` : evt, detail: qp(u, "gv") ? "value: " + qp(u, "gv") : "" }],
          };
        }
        return null;
      },
    },
    {
      id: "smartnews",
      name: { en: "SmartNews Ads", ja: "SmartNews 広告" },
      hosts: ["*://*.smartnews-ads.com/*"],
      match(u) {
        if (/pixel\.js$/.test(u.pathname)) return { kind: "load", ids: [], events: [] };
        if (/smartnews-ads\.com$/.test(u.hostname)) {
          return {
            kind: "hit",
            ids: [qp(u, "pixel_id", "id")].filter(Boolean),
            events: [{ name: qp(u, "e", "event", "ev") || "hit", detail: "" }],
          };
        }
        return null;
      },
    },
  ];

  // 広告クリック時に付く計測用パラメータ（リダイレクトで落ちていないかを確認する）
  const TRACKING_PARAMS = [
    "gclid", "gbraid", "wbraid", "dclid", // Google
    "yclid", "ysclid",                    // Yahoo!
    "fbclid",                             // Meta
    "ldtag_cl",                           // LINE
    "ttclid",                             // TikTok
    "twclid",                             // X
    "msclkid",                            // Microsoft
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  ];

  // 1件のリクエストを判定する。該当しなければ null
  function classify(urlString, body) {
    let u;
    try {
      u = new URL(urlString);
    } catch (e) {
      return null;
    }
    const results = [];
    for (const v of VENDORS) {
      let r = null;
      try {
        r = v.match(u, body);
      } catch (e) {
        r = null;
      }
      if (r) results.push({ vendor: v.id, ...r });
    }
    return results.length ? results : null;
  }

  function trackingParamsOf(urlString) {
    const out = {};
    try {
      const u = new URL(urlString);
      for (const p of TRACKING_PARAMS) {
        if (u.searchParams.has(p)) out[p] = u.searchParams.get(p);
      }
    } catch (e) { /* noop */ }
    return out;
  }

  const allHosts = () => [...new Set(VENDORS.flatMap((v) => v.hosts))];

  root.TAG_CHECKER = { VENDORS, TRACKING_PARAMS, classify, trackingParamsOf, allHosts };
})(typeof self !== "undefined" ? self : this);
