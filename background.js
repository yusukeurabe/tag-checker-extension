// =============================================================
// バックグラウンド（サービスワーカー）
// タブごとに「どのタグが読み込まれ、何が送信されたか」と
// 「広告クリック用パラメータがリダイレクトで残ったか」を記録する。
// 監視するのは vendors.js に書いた計測サービスの通信だけ（負荷を抑えるため）。
// 記録はブラウザ内（chrome.storage.session）にだけ保存し、外部には送らない。
// =============================================================
importScripts("vendors.js");

const TC = self.TAG_CHECKER;
const MAX_EVENTS = 300;
const SAVE_DELAY = 200;

const tabs = new Map(); // tabId → 記録
const pending = new Map(); // tabId → 確定前のナビゲーション { chain: [url...] }
const saveTimers = new Map();

// サービスワーカーは止まることがあるので、再開時に保存済みの記録を読み戻す
let loadPromise = null;
function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = chrome.storage.session.get(null).then((all) => {
      for (const [k, v] of Object.entries(all)) {
        const m = /^tab:(\d+)$/.exec(k);
        if (m && !tabs.has(Number(m[1]))) tabs.set(Number(m[1]), v);
      }
    }).catch(() => {});
  }
  return loadPromise;
}

function newState(url, initialUrl, chain, partial = false) {
  return { url, initialUrl, chain, partial, startedAt: Date.now(), vendors: {} };
}

function scheduleSave(tabId) {
  clearTimeout(saveTimers.get(tabId));
  saveTimers.set(
    tabId,
    setTimeout(() => {
      saveTimers.delete(tabId);
      const st = tabs.get(tabId);
      if (!st) return;
      chrome.storage.session.set({ ["tab:" + tabId]: st }).catch(() => {});
      updateBadge(tabId, st);
    }, SAVE_DELAY)
  );
}

function firedCount(st) {
  let n = 0;
  for (const v of TC.VENDORS) {
    const s = st.vendors[v.id];
    if (s && (s.hitCount > 0 || (v.loadCountsAsFired && s.loaded))) n++;
  }
  return n;
}

function updateBadge(tabId, st) {
  const n = firedCount(st);
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#217a45" }).catch(() => {});
}

// ---- ページの移動（リダイレクトの経路を記録） ----------------------
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0) return;
  pending.set(d.tabId, { chain: [d.url] });
});

chrome.webRequest.onBeforeRedirect.addListener(
  (d) => {
    if (d.tabId < 0) return;
    const p = pending.get(d.tabId) || { chain: [d.url] };
    p.chain.push(d.redirectUrl);
    pending.set(d.tabId, p);
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  await ensureLoaded();
  const p = pending.get(d.tabId) || { chain: [d.url] };
  pending.delete(d.tabId);

  let chain = p.chain.slice();
  if (chain[chain.length - 1] !== d.url) chain.push(d.url);

  // JavaScript による転送（location.replace など）は、前のページからの続きとして扱う
  const prev = tabs.get(d.tabId);
  let initialUrl = chain[0];
  if (prev && (d.transitionQualifiers || []).includes("client_redirect")) {
    initialUrl = prev.initialUrl;
    chain = prev.chain.concat(chain[0] === prev.url ? chain.slice(1) : chain);
  }

  tabs.set(d.tabId, newState(d.url, initialUrl, chain));
  scheduleSave(d.tabId);
});

// ---- 計測タグの通信 --------------------------------------------------
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    const results = TC.classify(d.url, d.requestBody);
    if (!results) return;
    ensureLoaded().then(() => record(d.tabId, results));
  },
  { urls: TC.allHosts() },
  ["requestBody"]
);

function record(tabId, results) {
  let st = tabs.get(tabId);
  if (!st) {
    // 拡張機能を入れる前から開いていたページ（途中からの記録）
    st = newState("", "", [], true);
    tabs.set(tabId, st);
  }
  const now = Date.now();
  for (const r of results) {
    const v = (st.vendors[r.vendor] ||= { loaded: false, hitCount: 0, ids: [], events: [] });
    for (const id of r.ids) if (id && !v.ids.includes(id)) v.ids.push(id);
    if (r.kind === "load") {
      v.loaded = true;
    } else {
      v.hitCount++;
      for (const e of r.events) {
        v.events.push({ name: e.name, detail: e.detail || "", id: r.ids[0] || "", t: now });
      }
      if (v.events.length > MAX_EVENTS) v.events.splice(0, v.events.length - MAX_EVENTS);
    }
  }
  scheduleSave(tabId);
}

// ---- 後片付け --------------------------------------------------------
chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  pending.delete(tabId);
  clearTimeout(saveTimers.get(tabId));
  saveTimers.delete(tabId);
  chrome.storage.session.remove("tab:" + tabId).catch(() => {});
});
