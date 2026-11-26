// 画面がちらつかないよう、描画前に保存済みのテーマと言語を反映する（既定はダーク・英語）
// 拡張機能のページではインラインの <script> が使えないため、別ファイルにしている
(function () {
  var theme = "dark", lang = "en";
  try {
    theme = localStorage.getItem("tag-checker:theme") || theme;
    lang = localStorage.getItem("tag-checker:lang") || lang;
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  document.documentElement.setAttribute("lang", lang === "ja" ? "ja" : "en");
})();
