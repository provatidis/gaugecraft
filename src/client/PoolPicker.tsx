import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MarketRow } from "../shared/types.js";
import { findPools } from "./pool-search.js";

const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
const pair = ({ snapshot: s }: MarketRow) =>
  `${s.token0.symbol} / ${s.token1.symbol}`;

export function PoolPicker({
  row,
  rows,
  select,
  watch,
}: {
  row: MarketRow;
  rows: MarketRow[];
  select: (id: string) => void;
  watch: string[];
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [activeId, setActiveId] = useState("");
  const matches = useMemo(
    () => findPools(rows, query, row.snapshot.id, watch, watchOnly),
    [rows, query, row.snapshot.id, watch, watchOnly],
  );
  const visible = matches.slice(0, 12);
  const activeIndex = Math.max(
    0,
    visible.findIndex((r) => r.snapshot.id === activeId),
  );
  const active = visible[activeIndex];
  const watched = new Set(watch);
  const watchCount = rows.filter((r) => watched.has(r.snapshot.id)).length;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function choose(id: string) {
    select(id);
    close(true);
  }
  useEffect(() => {
    if (!open) return;
    input.current?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const resize = () => {
      root.current?.style.setProperty(
        "--pool-picker-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      root.current?.style.setProperty(
        "--pool-picker-top",
        `${(viewport?.offsetTop ?? 0) + 12}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  useEffect(() => {
    if (open && active)
      document
        .getElementById(`${id}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, id, activeIndex, active?.snapshot.id]);

  return (
    <div
      className="pool-picker"
      ref={root}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="pool-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        aria-label={`Change pool: ${pair(row)}, ${row.snapshot.chain}, ${row.snapshot.address}`}
        onClick={() => {
          if (open) close();
          else {
            setQuery("");
            setActiveId("");
            setOpen(true);
          }
        }}
      >
        <span className="pool-picker-selected">
          <strong>{pair(row)}</strong>
          <span>
            {row.snapshot.chain} · {row.snapshot.poolType > 0 ? "CL" : "Basic"}{" "}
            · {short(row.snapshot.address)}
          </span>
        </span>
        <span className="pool-picker-action" aria-hidden="true">
          Find pool <span>⌕</span>
        </span>
      </button>
      {open && (
        <div
          id={`${id}-dialog`}
          className="pool-picker-popover"
          role="dialog"
          aria-label="Choose a pool"
        >
          <div className="pool-picker-heading">
            <label htmlFor={`${id}-search`}>Find a pool</label>
            <button
              type="button"
              className="pool-picker-close"
              aria-label="Close pool search"
              onClick={() => close(true)}
            >
              ×
            </button>
          </div>
          <input
            ref={input}
            id={`${id}-search`}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-results`}
            aria-activedescendant={
              active ? `${id}-option-${activeIndex}` : undefined
            }
            aria-describedby={`${id}-help`}
            autoComplete="off"
            spellCheck={false}
            placeholder="Token, network or address"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId("");
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                visible.length
              ) {
                event.preventDefault();
                const next =
                  (activeIndex +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    visible.length) %
                  visible.length;
                setActiveId(visible[next].snapshot.id);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (active) choose(active.snapshot.id);
              }
            }}
          />
          <div className="pool-picker-tools">
            <span id={`${id}-help`}>Combine terms, e.g. USDC Base</span>
            {watchCount > 0 && (
              <button
                type="button"
                className="pool-picker-watch"
                aria-pressed={watchOnly}
                onClick={() => {
                  setWatchOnly(!watchOnly);
                  setActiveId("");
                  input.current?.focus({ preventScroll: true });
                }}
              >
                <span aria-hidden="true">☆</span> Watchlist ({watchCount})
              </button>
            )}
          </div>
          <ul
            id={`${id}-results`}
            className="pool-picker-results"
            role="listbox"
            aria-label="Matching pools"
          >
            {visible.map((r, i) => (
              <li key={r.snapshot.id} role="presentation">
                <button
                  id={`${id}-option-${i}`}
                  className={`pool-picker-option ${i === activeIndex ? "is-active" : ""}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={r.snapshot.id === row.snapshot.id}
                  aria-label={`${pair(r)}, ${r.snapshot.chain}, ${r.snapshot.poolType > 0 ? "CL" : "Basic"}, ${r.snapshot.address}${watched.has(r.snapshot.id) ? ", watchlist" : ""}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(r.snapshot.id)}
                >
                  <span className="pool-picker-result">
                    <strong>
                      {pair(r)}{" "}
                      {watched.has(r.snapshot.id) && (
                        <span className="pool-picker-star" aria-hidden="true">
                          ★
                        </span>
                      )}
                    </strong>
                    <span>
                      {r.snapshot.chain} ·{" "}
                      {r.snapshot.poolType > 0 ? "CL" : "Basic"} ·{" "}
                      <code title={r.snapshot.id}>
                        {short(r.snapshot.address)}
                      </code>
                    </span>
                  </span>
                  {r.snapshot.id === row.snapshot.id && (
                    <span className="pool-picker-current">Current</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="pool-picker-count" role="status" aria-live="polite">
            {matches.length === 0
              ? "No matching pools. Try another token, network or address."
              : matches.length > visible.length
                ? `${visible.length} of ${matches.length} matches shown. Type to narrow the list.`
                : `${matches.length} ${matches.length === 1 ? "pool" : "pools"} found`}
          </div>
        </div>
      )}
    </div>
  );
}
