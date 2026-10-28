import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { assetUrl } from "./data.js";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const displayMode = window.matchMedia("(display-mode: standalone)");
const appleStandalone = () =>
  !!(window.navigator as Navigator & { standalone?: boolean }).standalone;
let installedThisVisit = false;
let installation = {
  installed: displayMode.matches || appleStandalone(),
  prompt: null as InstallPrompt | null,
};
const listeners = new Set<() => void>();
function update(next: typeof installation) {
  installation = next;
  listeners.forEach((listener) => listener());
}
// Capture eligibility before React mounts; a prompt may only be used once.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (!installation.installed)
    update({ ...installation, prompt: event as InstallPrompt });
});
window.addEventListener("appinstalled", () => {
  installedThisVisit = true;
  update({ installed: true, prompt: null });
});
displayMode.addEventListener("change", () =>
  update({
    ...installation,
    installed: installedThisVisit || displayMode.matches || appleStandalone(),
  }),
);
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const snapshot = () => installation;

function installationSteps() {
  const ua = window.navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
  if (ios)
    return (
      <>
        Open the browser’s <b>Share</b> menu, choose <b>Add to Home Screen</b>,
        then <b>Add</b>. Leave <b>Open as Web App</b> enabled if shown. If the
        option is missing, open this site in Safari.
      </>
    );
  if (/Android/.test(ua))
    return (
      <>
        Open the browser’s menu and choose <b>Install app</b> or{" "}
        <b>Add to Home screen</b>. If the option is missing, open this site in
        Chrome.
      </>
    );
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Edg/.test(ua))
    return (
      <>
        In Safari, choose <b>File → Add to Dock</b>, then <b>Add</b>.
      </>
    );
  return (
    <>
      Use the install icon in the address bar or the browser’s{" "}
      <b>Install app</b> menu. If this browser has no install option, open this
      site in Chrome, Edge or Safari.
    </>
  );
}

export function InstallApp() {
  const { installed, prompt } = useSyncExternalStore(subscribe, snapshot);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setMessage("");
    update({ ...installation, prompt: null });
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        setOpen(false);
        trigger.current?.focus();
      } else setMessage("Installation cancelled. You can keep using this tab.");
    } catch {
      setMessage("Use your browser’s menu to install Gaugecraft.");
    } finally {
      setBusy(false);
    }
  }
  if (installed) return null;
  return (
    <div
      className="install-app"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="install-button"
        ref={trigger}
        aria-expanded={open}
        aria-controls="install-gaugecraft"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5" />
        </svg>
        Install app
      </button>
      {open && (
        <section
          className="install-popover"
          id="install-gaugecraft"
          aria-label="Install Gaugecraft"
        >
          <div className="install-heading">
            <img src={assetUrl("apple-touch-icon.png")} alt="" />
            <div>
              <h2>Gaugecraft, one tap away</h2>
              <p>Open your research from your home screen or desktop.</p>
            </div>
          </div>
          {prompt ? (
            <button
              className="button"
              disabled={busy}
              onClick={() => void install()}
            >
              Install Gaugecraft
            </button>
          ) : busy ? (
            <p role="status">Follow the browser’s installation prompt.</p>
          ) : (
            <p className="install-steps">{installationSteps()}</p>
          )}
          {message && <p role="status">{message}</p>}
          <p className="install-note">
            An internet connection is required to load observations. Your
            allocation inputs stay on this device.
          </p>
          <button
            className="text-link"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            Close
          </button>
        </section>
      )}
    </div>
  );
}
