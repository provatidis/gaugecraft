import { useEffect, useState } from "react";

// Observation age must advance even when every subsequent network request fails.
export function useObservationClock() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000);
    const timer = window.setInterval(tick, 15000);
    window.addEventListener("focus", tick);
    window.addEventListener("pageshow", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      window.removeEventListener("pageshow", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return now;
}
