import { useMemo, useState, type CSSProperties } from "react";
import type { IndicatorCategory, IndicatorDef } from "../indicators/types";
import { useChartApi } from "./context";
import { useIndicatorPrefs } from "./indicatorPrefs";

/**
 * Always-visible quick-toggle panel — the second of the two indicator views
 * (the catalog is {@link IndicatorModal}). Lists only the indicators that matter
 * for fast on/off: the ones currently active plus the user's favorites, grouped
 * by category. Shares the favorites store + controller with the modal, so the
 * two stay in sync. Renders nothing if there is nothing to show.
 */
export interface IndicatorQuickPanelProps {
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Open the settings dialog for an active indicator (gear icon on its row). */
  onOpenSettings?: (name: string) => void;
}

const GROUPS: { cat: IndicatorCategory; label: string }[] = [
  { cat: "overlay", label: "OVERLAYS" },
  { cat: "oscillator", label: "OSCILLATORS" },
  { cat: "pattern", label: "PATTERNS" },
];

export function IndicatorQuickPanel({ className, style, title = "Đang dùng", onOpenSettings }: IndicatorQuickPanelProps) {
  const { indicators } = useChartApi();
  const { favorites, toggleFavorite } = useIndicatorPrefs();
  const [, force] = useState(0);
  const sync = () => force((n) => n + 1);

  const grouped = useMemo(() => indicators?.available() ?? null, [indicators, favorites, force]);
  if (!indicators || !grouped) return null;

  const all: IndicatorDef[] = [...grouped.overlay, ...grouped.oscillator, ...grouped.pattern];
  const activeNames = new Set(indicators.activeNames());

  // Show = active ∪ favorites (resolved + de-duped), preserving registry order.
  const shown = all.filter((d) => activeNames.has(d.name) || favorites.includes(d.name));
  if (shown.length === 0) return null;

  return (
    <div className={className ?? "ck-iq"} style={style}>
      <div className="ck-iq-head">{title}</div>
      {GROUPS.map(({ cat, label }) => {
        const rows = shown.filter((d) => d.category === cat);
        if (rows.length === 0) return null;
        return (
          <div key={cat} className="ck-iq-group">
            <div className="ck-iq-group-label">{label}</div>
            {rows.map((def) => {
              const active = activeNames.has(def.name);
              const fav = favorites.includes(def.name);
              return (
                <label key={def.name} className="ck-iq-row">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => { indicators.toggle(def.name); sync(); }}
                  />
                  <span className="ck-iq-title" title={def.title}>{def.title}</span>
                  {active && onOpenSettings && (
                    <button
                      type="button"
                      className="ck-iq-gear"
                      title="Cài đặt"
                      onClick={(e) => { e.preventDefault(); onOpenSettings(def.name); }}
                    >⚙</button>
                  )}
                  <button
                    type="button"
                    className={`ck-iq-star${fav ? " ck-iq-star--on" : ""}`}
                    title={fav ? "Bỏ ghim" : "Ghim"}
                    onClick={(e) => { e.preventDefault(); toggleFavorite(def.name); }}
                  >
                    {fav ? "★" : "☆"}
                  </button>
                </label>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
