import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("gaugecraft:theme-changed", onChange);
  return () => window.removeEventListener("gaugecraft:theme-changed", onChange);
}
function preference() {
  return document.documentElement.dataset.themePreference ?? "system";
}

export function ThemeSelect() {
  const value = useSyncExternalStore(subscribe, preference);
  return (
    <label className="theme-control">
      <span>Theme</span>
      <select
        aria-label="Color theme"
        title="System follows your device. Your choice stays in this browser."
        value={value}
        onChange={(event) =>
          window.dispatchEvent(
            new CustomEvent("gaugecraft:theme-preference", {
              detail: event.target.value,
            }),
          )
        }
      >
        <option value="system">System</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </label>
  );
}
