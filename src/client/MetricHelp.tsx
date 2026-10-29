import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function MetricHelp({ label, text }: { label: string; text: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !panel.current?.contains(e.target as Node)
      )
        close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="metric-help"
        aria-label={`About ${label}`}
        aria-expanded={!!position}
        aria-describedby={position ? id : undefined}
        onBlur={() => setPosition(null)}
        onClick={() => {
          if (position) {
            setPosition(null);
            return;
          }
          const rect = trigger.current!.getBoundingClientRect();
          const above = rect.bottom > window.innerHeight - 220;
          setPosition({
            left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
            top: above ? rect.top - 8 : rect.bottom + 8,
            above,
          });
        }}
      >
        ⓘ
      </button>
      {position &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            className="metric-help-popover"
            style={{
              left: position.left,
              top: position.top,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
          >
            <b>{label}</b>
            <p>{text}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
