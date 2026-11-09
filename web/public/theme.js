(function () {
  var theme = "dark";
  try {
    var stored = localStorage.getItem("psephex-theme");
    if (stored === "light" || stored === "dark") theme = stored;
  } catch (e) {}
  var root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
})();
