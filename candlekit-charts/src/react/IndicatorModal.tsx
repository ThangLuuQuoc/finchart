import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { IndicatorCategory, IndicatorDef } from "../indicators/types";
import { useChartApi } from "./context";
import { useIndicatorPrefs } from "./indicatorPrefs";

/**
 * TradingView-style indicator browser as a centered modal: left sidebar groups
 * (favorites / recents / built-in / TradingView catalog / user Pine scripts),
 * a search box, category tabs, and a scrollable list with per-row favorite star
 * and add/remove toggle. Wired to the enclosing {@link ChartView} controller.
 *
 * This component lives in candlekit and MUST NOT depend on the Pine toolchain.
 * The "add Pine script" feature is injected via {@link onAddPineScript}; when
 * the prop is absent the entry is hidden.
 */
export interface IndicatorModalProps {
  className?: string;
  style?: CSSProperties;
  /** Trigger button label. Default `"Chỉ báo"`. */
  label?: string;
  /**
   * Host-provided hook to compile + register a pasted Pine script and add it to
   * the registry this controller reads. Returns the new indicator name on
   * success or an error message. Absent → the "Thêm Pine script" UI is hidden.
   */
  onAddPineScript?: (source: string) => { ok: boolean; name?: string; error?: string };
  /** Open the settings dialog for an active indicator (gear icon on its row). */
  onOpenSettings?: (name: string) => void;
}

type Section = "favorites" | "recents" | "builtin" | "tv" | "pine";
type Tab = "indicators" | "strategies" | "profiles" | "patterns";

const SECTION_GROUPS: { key: "favorites" | "recents"; label: string; icon: string }[] = [
  { key: "favorites", label: "Yêu thích", icon: "★" },
  { key: "recents", label: "Gần đây", icon: "🕘" },
];
const SOURCE_SECTIONS: { key: "builtin" | "tv" | "pine"; label: string }[] = [
  { key: "builtin", label: "Chỉ số kỹ thuật" },
  { key: "tv", label: "TradingView" },
  { key: "pine", label: "Pine của tôi" },
];
const TABS: { id: Tab; label: string }[] = [
  { id: "indicators", label: "Các chỉ báo" },
  { id: "strategies", label: "Chiến lược" },
  { id: "profiles", label: "Hồ sơ" },
  { id: "patterns", label: "Mô hình" },
];

const CAT_BADGE: Record<IndicatorCategory, string> = {
  overlay: "ck-im-cat--overlay",
  oscillator: "ck-im-cat--oscillator",
  pattern: "ck-im-cat--pattern",
};

function sourceOf(def: IndicatorDef): "builtin" | "tv" | "pine" {
  return def.source ?? "builtin";
}

export function IndicatorModal({ className, style, label = "Chỉ báo", onAddPineScript, onOpenSettings }: IndicatorModalProps) {
  const { indicators } = useChartApi();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<Section>("builtin");
  const [tab, setTab] = useState<Tab>("indicators");
  const { favorites, recents, toggleFavorite, pushRecent } = useIndicatorPrefs();
  const [pineOpen, setPineOpen] = useState(false);
  const [pineSrc, setPineSrc] = useState("");
  const [pineErr, setPineErr] = useState<string | null>(null);
  // Bumped after registry mutations (add Pine) + controller toggles to re-read.
  const [version, force] = useState(0);
  const sync = () => force((n) => n + 1);

  const grouped = useMemo(() => (indicators?.available() ?? null), [indicators, open, version]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!indicators) return null;

  const all: IndicatorDef[] = grouped
    ? [...grouped.overlay, ...grouped.oscillator, ...grouped.pattern]
    : [];
  const byName = new Map(all.map((d) => [d.name, d]));
  const favSet = new Set(favorites);

  const counts = {
    favorites: favorites.filter((n) => byName.has(n)).length,
    recents: recents.filter((n) => byName.has(n)).length,
    builtin: all.filter((d) => sourceOf(d) === "builtin").length,
    tv: all.filter((d) => sourceOf(d) === "tv").length,
    pine: all.filter((d) => sourceOf(d) === "pine").length,
  };

  const q = search.trim().toLowerCase();

  // Tab filter: v1 only "indicators" (all) + "patterns" (category) have data.
  const passesTab = (d: IndicatorDef): boolean => {
    if (tab === "patterns") return d.category === "pattern";
    if (tab === "strategies" || tab === "profiles") return false;
    return true;
  };

  // Search spans everything; otherwise show the selected section.
  let list: IndicatorDef[];
  if (q) {
    list = all.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.shortTitle.toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  } else if (section === "favorites") {
    list = favorites.map((n) => byName.get(n)).filter(Boolean) as IndicatorDef[];
  } else if (section === "recents") {
    list = recents.map((n) => byName.get(n)).filter(Boolean) as IndicatorDef[];
  } else {
    list = all.filter((d) => sourceOf(d) === section).sort((a, b) => a.title.localeCompare(b.title));
  }
  list = list.filter(passesTab);

  const toggleIndicator = (def: IndicatorDef) => {
    const wasActive = indicators.getActive(def.name) !== undefined;
    indicators.toggle(def.name);
    if (!wasActive) pushRecent(def.name);
    sync();
  };

  const submitPine = () => {
    if (!onAddPineScript) return;
    const res = onAddPineScript(pineSrc);
    if (res.ok) {
      setPineOpen(false);
      setPineSrc("");
      setPineErr(null);
      setSection("pine");
      setSearch("");
      sync();
    } else {
      setPineErr(res.error ?? "Biên dịch thất bại");
    }
  };

  const activeCount = indicators.activeNames().length;

  return (
    <div className={className ?? "ck-im-root"} style={style}>
      <button type="button" className="ck-im-trigger" title="Chỉ báo, chỉ số & chiến lược" onClick={() => setOpen(true)}>
        <span className="ck-im-trigger-icon">ƒ</span>
        {label}
        {activeCount > 0 && <span className="ck-im-count">{activeCount}</span>}
      </button>

      {open && (
        <div className="ck-im-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="ck-im-modal" role="dialog" aria-label="Chỉ báo, chỉ số và chiến lược">
            <div className="ck-im-head">
              <span className="ck-im-h-title">Chỉ báo, chỉ số và chiến lược</span>
              <button type="button" className="ck-im-x" title="Đóng" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="ck-im-search">
              <span className="ck-im-search-icon">⌕</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm kiếm" autoFocus />
            </div>

            <div className="ck-im-body">
              <aside className="ck-im-side">
                <div className="ck-im-side-group">CÁ NHÂN</div>
                {SECTION_GROUPS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`ck-im-side-item${section === s.key && !q ? " ck-im-side-item--active" : ""}`}
                    onClick={() => { setSection(s.key); setSearch(""); }}
                  >
                    <span className="ck-im-side-ic">{s.icon}</span>{s.label}
                    <span className="ck-im-side-n">{counts[s.key]}</span>
                  </button>
                ))}
                <div className="ck-im-side-group">TÍCH HỢP SẴN / CỘNG ĐỒNG</div>
                {SOURCE_SECTIONS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`ck-im-side-item${section === s.key && !q ? " ck-im-side-item--active" : ""}`}
                    onClick={() => { setSection(s.key); setSearch(""); }}
                  >
                    {s.label}
                    <span className="ck-im-side-n">{counts[s.key]}</span>
                  </button>
                ))}
              </aside>

              <main className="ck-im-main">
                <div className="ck-im-tabs">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`ck-im-tab${tab === t.id ? " ck-im-tab--active" : ""}`}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="ck-im-listhead">{q ? "KẾT QUẢ TÌM KIẾM" : "TÊN TẬP LỆNH"}</div>
                <div className="ck-im-list">
                  {list.length === 0 && (
                    <div className="ck-im-empty">
                      {tab === "strategies" || tab === "profiles"
                        ? "Chưa hỗ trợ trong phiên bản này"
                        : "Không có chỉ báo nào"}
                    </div>
                  )}
                  {list.map((def) => {
                    const active = indicators.getActive(def.name) !== undefined;
                    const fav = favSet.has(def.name);
                    const src = sourceOf(def);
                    return (
                      <div
                        key={def.name}
                        className={`ck-im-li${active ? " ck-im-li--active" : ""}`}
                        onClick={() => toggleIndicator(def)}
                      >
                        <button
                          type="button"
                          className={`ck-im-star${fav ? " ck-im-star--on" : ""}`}
                          title={fav ? "Bỏ ghim" : "Ghim vào Yêu thích"}
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(def.name); }}
                        >
                          {fav ? "★" : "☆"}
                        </button>
                        <span className="ck-im-li-title">{def.title}</span>
                        {src === "pine" && <span className="ck-im-badge ck-im-badge--pine">PINE</span>}
                        {src === "tv" && <span className="ck-im-badge ck-im-badge--tv">TV</span>}
                        {(def.tags ?? [])
                          .filter((t) => t !== "pine")
                          .slice(0, 2)
                          .map((t) => (
                            <span key={t} className="ck-im-badge">{t.toUpperCase()}</span>
                          ))}
                        <span className="ck-im-spacer" />
                        <span className={`ck-im-cat ${CAT_BADGE[def.category]}`}>
                          {def.category.slice(0, 3).toUpperCase()}
                        </span>
                        {active && onOpenSettings && (
                          <button
                            type="button"
                            className="ck-im-gear"
                            title="Cài đặt"
                            onClick={(e) => { e.stopPropagation(); onOpenSettings(def.name); }}
                          >⚙</button>
                        )}
                        {active && <span className="ck-im-check" title="Đang bật">✓</span>}
                      </div>
                    );
                  })}
                </div>
              </main>
            </div>

            <div className="ck-im-foot">
              <span className="ck-im-foot-hint">Nhấn ★ để ghim · {activeCount} đang bật</span>
              {onAddPineScript && (
                <button type="button" className="ck-im-addpine" onClick={() => { setPineOpen(true); setPineErr(null); }}>
                  + Thêm Pine script
                </button>
              )}
            </div>

            {pineOpen && onAddPineScript && (
              <div className="ck-im-pine-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPineOpen(false); }}>
                <div className="ck-im-pine">
                  <div className="ck-im-head">
                    <span className="ck-im-h-title">Thêm Pine script</span>
                    <button type="button" className="ck-im-x" title="Đóng" onClick={() => setPineOpen(false)}>✕</button>
                  </div>
                  <textarea
                    className="ck-im-pine-ta"
                    value={pineSrc}
                    onChange={(e) => setPineSrc(e.target.value)}
                    placeholder={`//@version=5\nindicator("My Indicator", overlay=true)\nplot(ta.ema(close, 21))`}
                    spellCheck={false}
                    autoFocus
                  />
                  {pineErr && <div className="ck-im-pine-err">{pineErr}</div>}
                  <div className="ck-im-pine-actions">
                    <button type="button" className="ck-im-btn" onClick={() => setPineOpen(false)}>Huỷ</button>
                    <button type="button" className="ck-im-btn ck-im-btn--primary" onClick={submitPine}>Biên dịch & thêm</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
