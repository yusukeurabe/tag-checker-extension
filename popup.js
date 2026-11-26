(() => {
  "use strict";

  const TC = self.TAG_CHECKER;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------
  // 文言
  // ---------------------------------------------------------------
  const I18N = {
    en: {
      title: "Ad Tag Checker",
      reload: "Reload page",
      copy: "Copy report",
      copied: "Report copied",
      demo: "Preview",
      params: "Click parameters",
      tags: "Tags on this page",
      noParams: "No ad click parameters in this URL.",
      paramHint: "To check for drops, open the ad's landing URL with a test parameter, e.g. <code>?gclid=test</code>.",
      kept: "Kept",
      dropped: "Dropped",
      changed: "Changed",
      redirects: (n) => (n === 1 ? "1 redirect" : `${n} redirects`),
      noRedirect: "No redirects",
      fired: "Fired",
      loadedOnly: "Loaded, not fired",
      notFound: "Not detected:",
      noneFound: "No supported tags detected yet.",
      events: (list) => list,
      noData: "No data for this tab yet. Reload the page to start checking.",
      partial: "This page was open before the extension started. Reload for a full check.",
      unsupported: "This page can't be checked (browser or extension page).",
      themeLabel: "Switch color theme",
      langLabel: "Language",
      reportHead: "Ad Tag Checker report",
      reportPage: "Page",
      reportLanded: "Landing URL",
    },
    ja: {
      title: "広告タグチェッカー",
      reload: "ページを再読み込み",
      copy: "結果をコピー",
      copied: "結果をコピーしました",
      demo: "プレビュー",
      params: "クリック計測パラメータ",
      tags: "このページのタグ",
      noParams: "このURLには広告クリック用のパラメータがありません。",
      paramHint: "パラメータ落ちを確認するには、広告のリンク先URLに <code>?gclid=test</code> などを付けて開いてください。",
      kept: "残っている",
      dropped: "消えている",
      changed: "値が変わった",
      redirects: (n) => `リダイレクト ${n}回`,
      noRedirect: "リダイレクトなし",
      fired: "発火",
      loadedOnly: "読み込みのみ（未発火）",
      notFound: "未検出：",
      noneFound: "対応しているタグはまだ検出されていません。",
      events: (list) => list,
      noData: "このタブの記録はまだありません。ページを再読み込みすると確認を始めます。",
      partial: "拡張機能が動き出す前から開いていたページです。正確に確認するには再読み込みしてください。",
      unsupported: "このページは確認できません（ブラウザや拡張機能のページ）。",
      themeLabel: "配色を切り替える",
      langLabel: "言語",
      reportHead: "広告タグチェッカーの結果",
      reportPage: "ページ",
      reportLanded: "最初に開いたURL",
    },
  };

  const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } };
  let lang = load("tag-checker:lang") === "ja" ? "ja" : "en";
  let theme = load("tag-checker:theme") === "light" ? "light" : "dark";
  const t = () => I18N[lang];
  const L = (v) => (v && typeof v === "object" ? v[lang] ?? v.en : v);

  // ---------------------------------------------------------------
  // データ（拡張機能として開いたとき）／デモデータ（ファイルとして直接開いたとき）
  // ---------------------------------------------------------------
  const isExtension = !!(self.chrome && chrome.storage && chrome.storage.session && chrome.tabs);
  let tabId = null;
  let tabUrl = "";
  let state = null;
  const openVendors = new Set();

  const DEMO = (() => {
    const now = Date.now();
    const ev = (name, sec, id, detail = "") => ({ name, id, detail, t: now - sec * 1000 });
    return {
      url: "https://shop.example.com/lp/serum?utm_source=google&utm_medium=cpc",
      initialUrl: "https://ad.example.com/r?gclid=TeSt123abc&utm_source=google&utm_medium=cpc",
      chain: [
        "https://ad.example.com/r?gclid=TeSt123abc&utm_source=google&utm_medium=cpc",
        "https://shop.example.com/lp/serum?utm_source=google&utm_medium=cpc",
      ],
      partial: false,
      vendors: {
        gtm: { loaded: true, hitCount: 0, ids: ["GTM-AB12CD3"], events: [] },
        ga4: { loaded: true, hitCount: 3, ids: ["G-XYZ987ABC"], events: [ev("page_view", 12, "G-XYZ987ABC"), ev("scroll", 6, "G-XYZ987ABC"), ev("view_item", 4, "G-XYZ987ABC")] },
        gads: { loaded: true, hitCount: 1, ids: ["AW-123456789"], events: [ev("remarketing", 11, "AW-123456789")] },
        meta: { loaded: true, hitCount: 2, ids: ["1234567890123456"], events: [ev("PageView", 11, "1234567890123456"), ev("ViewContent", 4, "1234567890123456")] },
        yahoo: { loaded: true, hitCount: 0, ids: [], events: [] },
        line: { loaded: true, hitCount: 1, ids: ["a1b2c3d4-0000"], events: [ev("pv", 10, "a1b2c3d4-0000")] },
      },
    };
  })();

  // ---------------------------------------------------------------
  // 判定
  // ---------------------------------------------------------------
  function vendorStatus(v, s) {
    if (!s) return "none";
    if (s.hitCount > 0 || (v.loadCountsAsFired && s.loaded)) return "fired";
    if (s.loaded) return "loaded";
    return "none";
  }

  function paramRows(st) {
    const before = TC.trackingParamsOf(st.initialUrl || "");
    const after = TC.trackingParamsOf(st.url || "");
    return Object.keys(before).map((k) => {
      let status = "kept";
      if (!(k in after)) status = "dropped";
      else if (after[k] !== before[k]) status = "changed";
      return { key: k, value: before[k], status };
    });
  }

  function summarizeEvents(events) {
    const counts = new Map();
    for (const e of events) counts.set(e.name, (counts.get(e.name) || 0) + 1);
    return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
  }

  const hhmmss = (ms) => {
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  };

  // ---------------------------------------------------------------
  // 表示
  // ---------------------------------------------------------------
  function renderChrome() {
    const T = t();
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = theme;
    $$("[data-i18n]").forEach((el) => { el.textContent = T[el.dataset.i18n]; });
    $$("#langSwitch [data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    $("#langSwitch").setAttribute("aria-label", T.langLabel);
    $("#themeBtn").setAttribute("aria-label", T.themeLabel);
    $("#themeBtn").title = T.themeLabel;
  }

  function renderPage() {
    const T = t();
    const url = (state && state.url) || tabUrl;
    let host = url;
    let path = "";
    try {
      const u = new URL(url);
      host = u.hostname;
      path = u.pathname + u.search;
    } catch (e) { /* noop */ }
    $("#page").innerHTML = `<div class="host">${esc(host || "—")}${isExtension ? "" : `<span class="demo-badge">${esc(T.demo)}</span>`}</div>
      ${path ? `<div class="path">${esc(path.length > 120 ? path.slice(0, 120) + "…" : path)}</div>` : ""}`;
  }

  function renderMain() {
    const T = t();
    const main = $("#main");

    if (isExtension && !/^https?:/.test(tabUrl)) {
      main.innerHTML = `<p class="notice info">${esc(T.unsupported)}</p>`;
      $("#btnReload").disabled = true;
      return;
    }
    if (!state) {
      main.innerHTML = `<p class="notice info">${esc(T.noData)}</p>`;
      $("#btnReload").classList.add("primary");
      return;
    }
    $("#btnReload").classList.toggle("primary", !!state.partial);

    let html = "";
    if (state.partial) html += `<p class="notice warn">${esc(T.partial)}</p>`;

    // --- クリック計測パラメータ ---
    const rows = paramRows(state);
    const redirects = Math.max(0, (state.chain || []).length - 1);
    html += `<section><h2>${esc(T.params)}</h2>`;
    if (!rows.length) {
      html += `<p class="muted">${esc(T.noParams)}</p><p class="hint">${T.paramHint}</p>`;
    } else {
      const cls = { kept: "ok", dropped: "error", changed: "warn" };
      html += `<ul class="params">${rows
        .map(
          (r) => `<li class="param"><span class="k">${esc(r.key)}<small>=${esc(r.value.length > 24 ? r.value.slice(0, 24) + "…" : r.value)}</small></span>
            <span class="tag ${cls[r.status]}">${esc(T[r.status])}</span></li>`
        )
        .join("")}</ul>`;
    }
    if (redirects > 0) {
      html += `<details class="redirects"><summary>${esc(T.redirects(redirects))}</summary><ol>${state.chain
        .map((u) => `<li>${esc(u)}</li>`)
        .join("")}</ol></details>`;
    } else if (rows.length) {
      html += `<p class="hint">${esc(T.noRedirect)}</p>`;
    }
    html += `</section>`;

    // --- タグ ---
    const order = { fired: 0, loaded: 1, none: 2 };
    const list = TC.VENDORS.map((v) => ({ v, s: state.vendors[v.id], status: vendorStatus(v, state.vendors[v.id]) })).sort(
      (a, b) => order[a.status] - order[b.status]
    );
    const found = list.filter((x) => x.status !== "none");
    const missing = list.filter((x) => x.status === "none");

    html += `<section><h2>${esc(T.tags)}</h2>`;
    if (!found.length) html += `<p class="muted">${esc(T.noneFound)}</p>`;
    html += `<ul class="vendors">${found
      .map(({ v, s, status }) => {
        const ev = summarizeEvents(s.events);
        const hasLog = s.events.length > 0;
        const open = openVendors.has(v.id) && hasLog;
        return `<li class="vendor${open ? " open" : ""}" data-vendor="${v.id}">
          <button type="button" ${hasLog ? `aria-expanded="${open}"` : "disabled"}>
            <span class="v-head">
              <span class="dot ${status}"></span>
              <span class="v-name">${esc(L(v.name))}</span>
              <span class="tag ${status === "fired" ? "ok" : "warn"}">${esc(status === "fired" ? T.fired : T.loadedOnly)}</span>
              ${hasLog ? `<span class="chev" aria-hidden="true">▶</span>` : ""}
            </span>
            ${s.ids.length ? `<span class="v-ids">${s.ids.map((id) => `<span class="chip">${esc(id)}</span>`).join("")}</span>` : ""}
            ${ev.length ? `<span class="v-events">${ev.map((e) => `<b>${esc(e)}</b>`).join(", ")}</span>` : ""}
          </button>
          ${hasLog
            ? `<ul class="log">${s.events
                .slice()
                .reverse()
                .map(
                  (e) => `<li><time>${hhmmss(e.t)}</time><span class="ev">${esc(e.name)}${e.detail ? ` <small>${esc(e.detail)}</small>` : ""}${
                    e.id && s.ids.length > 1 ? ` <small>(${esc(e.id)})</small>` : ""
                  }</span></li>`
                )
                .join("")}</ul>`
            : ""}
        </li>`;
      })
      .join("")}</ul>`;
    if (missing.length) {
      html += `<p class="not-found"><b>${esc(T.notFound)}</b> ${missing.map((x) => esc(L(x.v.name))).join(", ")}</p>`;
    }
    html += `</section>`;

    main.innerHTML = html;
  }

  function renderAll() {
    renderChrome();
    renderPage();
    renderMain();
  }

  // ---------------------------------------------------------------
  // 結果のテキスト化（チャットや報告用）
  // ---------------------------------------------------------------
  function reportText() {
    const T = t();
    const lines = [T.reportHead, `${T.reportPage}: ${(state && state.url) || tabUrl}`];
    if (!state) return lines.join("\n");
    if (state.initialUrl && state.initialUrl !== state.url) lines.push(`${T.reportLanded}: ${state.initialUrl}`);
    const rows = paramRows(state);
    lines.push("", `[${T.params}]`);
    if (!rows.length) lines.push(T.noParams);
    for (const r of rows) lines.push(`- ${r.key}: ${T[r.status]}`);
    const redirects = Math.max(0, (state.chain || []).length - 1);
    lines.push(redirects ? T.redirects(redirects) : T.noRedirect);
    lines.push("", `[${T.tags}]`);
    const missing = [];
    for (const v of TC.VENDORS) {
      const s = state.vendors[v.id];
      const st = vendorStatus(v, s);
      if (st === "none") { missing.push(L(v.name)); continue; }
      const ids = s.ids.length ? ` (${s.ids.join(", ")})` : "";
      const ev = summarizeEvents(s.events);
      lines.push(`- ${L(v.name)}${ids}: ${st === "fired" ? T.fired : T.loadedOnly}${ev.length ? " / " + ev.join(", ") : ""}`);
    }
    if (missing.length) lines.push(`${T.notFound} ${missing.join(", ")}`);
    return lines.join("\n");
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1600);
  }

  // ---------------------------------------------------------------
  // イベント
  // ---------------------------------------------------------------
  $("#langSwitch").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    store("tag-checker:lang", lang);
    renderAll();
  });

  $("#themeBtn").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    store("tag-checker:theme", theme);
    renderChrome();
  });

  $("#main").addEventListener("click", (e) => {
    const li = e.target.closest(".vendor");
    if (!li || !e.target.closest("button") || e.target.closest("button").disabled) return;
    const id = li.dataset.vendor;
    if (openVendors.has(id)) openVendors.delete(id);
    else openVendors.add(id);
    renderMain();
  });

  $("#btnReload").addEventListener("click", () => {
    if (isExtension && tabId != null) {
      chrome.tabs.reload(tabId);
      window.close();
    }
  });

  $("#btnCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(reportText());
      toast(t().copied);
    } catch (e) { /* noop */ }
  });

  // ---------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------
  async function init() {
    renderChrome();
    if (!isExtension) {
      state = DEMO;
      tabUrl = DEMO.url;
      renderAll();
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return renderAll();
    tabId = tab.id;
    tabUrl = tab.url || "";
    const key = "tab:" + tabId;
    const got = await chrome.storage.session.get(key);
    state = got[key] || null;
    renderAll();

    // 開いている間に届いた通信も反映する
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "session" || !changes[key]) return;
      state = changes[key].newValue || null;
      renderPage();
      renderMain();
    });
  }

  init();
})();
