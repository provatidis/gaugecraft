// Runs before app styles so the first paint uses the saved or system appearance.
(() => {
  const root = window.document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const key = "gc-theme";
  const valid = (value) => ["system", "dark", "light"].includes(value);
  const read = () => {
    try {
      const value = window.localStorage.getItem(key);
      return valid(value) ? value : "system";
    } catch {
      return "system";
    }
  };
  let preference = read();
  const apply = () => {
    const theme =
      preference === "system"
        ? system.matches
          ? "dark"
          : "light"
        : preference;
    root.dataset.themePreference = preference;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const color = theme === "dark" ? "#101318" : "#eef0f3";
    // Also covers the brief interval before the stylesheet arrives.
    root.style.backgroundColor = color;
    window.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", color);
    window.dispatchEvent(new window.Event("gaugecraft:theme-changed"));
  };
  window.addEventListener("gaugecraft:theme-preference", (event) => {
    if (!valid(event.detail)) return;
    preference = event.detail;
    try {
      window.localStorage.setItem(key, preference);
    } catch {
      // Keep the choice for this page when browser storage is unavailable.
    }
    apply();
  });
  system.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      preference = read();
      apply();
    }
  });
  apply();
})();
