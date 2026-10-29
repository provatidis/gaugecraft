import { useEffect, useRef, useState } from "react";
import type { Mode } from "../shared/types.js";
import { readRoute, routeHash, type ResearchRoute } from "./research-route.js";

export function useResearchRoute(defaultMode: Mode) {
  const [route, setRoute] = useState(() =>
    readRoute(location.hash, defaultMode),
  );
  const current = useRef(route);
  const [scrollRevision, setScrollRevision] = useState(0);
  const scrollTarget = useRef(0);
  const rememberedScroll = useRef(new Map<string, number>());
  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    history.replaceState(
      { ...history.state, gcScroll: window.scrollY },
      "",
      routeHash(current.current),
    );
    const saveScroll = () => {
      rememberedScroll.current.set(location.hash, window.scrollY);
    };
    const changed = () => {
      const parsed = readRoute(location.hash, current.current.mode);
      if (parsed.page !== "markets") parsed.market = current.current.market;
      if (!parsed.pool && !["analysis", "simulator"].includes(parsed.page))
        parsed.pool = current.current.pool;
      current.current = parsed;
      setRoute(parsed);
      scrollTarget.current =
        rememberedScroll.current.get(location.hash) ??
        history.state?.gcScroll ??
        0;
      setScrollRevision((v) => v + 1);
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    window.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      history.scrollRestoration = previousRestoration;
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("scroll", saveScroll);
    };
  }, []);
  function update(patch: Partial<ResearchRoute>, replace = false) {
    const next = { ...current.current, ...patch };
    const hash = routeHash(next);
    if (hash === location.hash) {
      current.current = next;
      setRoute(next);
      return;
    }
    rememberedScroll.current.set(location.hash, window.scrollY);
    const nextScroll = replace
      ? window.scrollY
      : (rememberedScroll.current.get(hash) ?? 0);
    history.replaceState({ ...history.state, gcScroll: window.scrollY }, "");
    history[replace ? "replaceState" : "pushState"](
      { gcScroll: nextScroll },
      "",
      hash,
    );
    current.current = next;
    setRoute(next);
    if (!replace) {
      scrollTarget.current = nextScroll;
      setScrollRevision((v) => v + 1);
    }
  }
  return { route, update, scrollRevision, scrollTarget };
}
