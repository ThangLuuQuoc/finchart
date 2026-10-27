import { useMemo, useState, type CSSProperties } from "react";
import type { IndicatorDef, InputConfig, PlotStyle } from "../indicators/types";
import { useChartApi } from "./context";

/**
 * Per-indicator settings dialog (TradingView "gear"): an Inputs tab (params by
 * type, grouped) and a Style tab (per-plot color / width / line style /
 * visibility). Controlled by `name`; renders nothing when null. Writes straight
 * to the controller — `add` for inputs, `setStyle` for plot styling.
 */
export interface IndicatorSettingsDialogProps {
  /** Active indicator name to edit, or null to hide. */
  name: string | null;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}

type Tab = "inputs" | "style";

const SOURCES = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"];
const toHex6 = (c: string): string => {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec((c ?? "").trim());
  if (!m) return "#888888";
  const h = m[1]!;
  return h.length === 3 ? "#" + h.split("").map((x) => x + x).join("") : "#" + h.slice(0, 6);
};

export function IndicatorSettingsDialog({ name, onClose, className, style }: IndicatorSettingsDialogProps) {
  const { indicators } = useChartApi();
  const [tab, setTab] = useState<Tab>("inputs");
  const [, force] = useState(0);
  const sync = () => force((n) => n + 1);

  const def: IndicatorDef | null = useMemo(() => {
    if (!indicators || !name) return null;
    const g = indicators.available();
    return [...g.overlay, ...g.oscillator, ...g.pattern].find((d) => d.name === name) ?? null;
  }, [indicators, name]);

  if (!indicators || !name || !def) return null;
  const act = indicators.getActive(name);
  if (!act) return null;

  const setParam = (key: string, val: unknown) => {
    indicators.add(name, { ...act.params, [key]: val });
    sync();
  };
  const setStyle = (plotId: string, patch: PlotStyle) => {
    indicators.setStyle(name, plotId, patch);
    sync();
  };

  // Group inputs by their `group` field, preserving first-seen order.
  const groups: { group: string | undefined; items: InputConfig[] }[] = [];
  for (const cfg of def.inputConfig) {
    const g = (cfg as { group?: string }).group;
    let bucket = groups.find((x) => x.group === g);
    if (!bucket) { bucket = { group: g, items: [] }; groups.push(bucket); }
    bucket.items.push(cfg);
  }

  return (
    <div className={className ?? "ck-im-overlay"} style={style} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ck-set" role="dialog" aria-label={`Cài đặt ${def.title}`}>
        <div className="ck-im-head">
          <span className="ck-im-h-title">{def.title}</span>
          <button type="button" className="ck-im-x" title="Đóng" onClick={onClose}>✕</button>
        </div>

        <div className="ck-set-tabs">
          <button type="button" className={`ck-set-tab${tab === "inputs" ? " ck-set-tab--active" : ""}`} onClick={() => setTab("inputs")}>Đầu vào</button>
          <button type="button" className={`ck-set-tab${tab === "style" ? " ck-set-tab--active" : ""}`} onClick={() => setTab("style")}>Kiểu hiển thị</button>
        </div>

        <div className="ck-set-body">
          {tab === "inputs" && (
            def.inputConfig.length === 0
              ? <div className="ck-set-empty">Chỉ báo này không có tham số.</div>
              : groups.map((grp, gi) => (
                <div key={gi} className="ck-set-group">
                  {grp.group && <div className="ck-set-group-label">{grp.group}</div>}
                  {grp.items.map((cfg) => (
                    <InputField key={cfg.name} cfg={cfg} value={act.params[cfg.name]} onChange={(v) => setParam(cfg.name, v)} />
                  ))}
                </div>
              ))
          )}

          {tab === "style" && (
            def.plotConfig.length === 0
              ? <div className="ck-set-empty">Chỉ báo này không có plot.</div>
              : def.plotConfig.map((pc) => {
                const st = act.styles?.[pc.id] ?? {};
                const color = st.color ?? act.colors[pc.id] ?? pc.color ?? "#888888";
                const width = st.lineWidth ?? pc.lineWidth ?? 1;
                const lineStyle = st.lineStyle ?? "solid";
                const visible = st.visible ?? true;
                const isHist = pc.style === "histogram" || pc.style === "columns";
                return (
                  <div key={pc.id} className="ck-set-row">
                    <input type="checkbox" checked={visible} title="Hiện/ẩn" onChange={(e) => setStyle(pc.id, { visible: e.target.checked })} />
                    <span className="ck-set-row-label" title={pc.title || pc.id}>{pc.title || pc.id}</span>
                    <input type="color" value={toHex6(color)} title="Màu" onChange={(e) => setStyle(pc.id, { color: e.target.value })} />
                    {!isHist && (
                      <>
                        <select value={width} title="Độ dày" onChange={(e) => setStyle(pc.id, { lineWidth: Number(e.target.value) })}>
                          {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}
                        </select>
                        <select value={lineStyle} title="Kiểu nét" onChange={(e) => setStyle(pc.id, { lineStyle: e.target.value as PlotStyle["lineStyle"] })}>
                          <option value="solid">─ liền</option>
                          <option value="dashed">╌ đứt</option>
                          <option value="dotted">··· chấm</option>
                        </select>
                      </>
                    )}
                  </div>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}

interface InputFieldProps {
  cfg: InputConfig;
  value: unknown;
  onChange: (val: unknown) => void;
}

function InputField({ cfg, value, onChange }: InputFieldProps) {
  const labelText = cfg.title ?? cfg.name;
  const opts = Array.isArray(cfg.options) ? cfg.options : null;
  return (
    <div className="ck-set-field">
      <span className="ck-set-field-label" title={labelText}>{labelText}</span>
      {(cfg.type === "int" || cfg.type === "float") && (
        <input
          type="number"
          value={String(value ?? cfg.defval ?? "")}
          step={cfg.type === "int" ? 1 : "any"}
          min={typeof cfg.minval === "number" ? cfg.minval : undefined}
          max={typeof cfg.maxval === "number" ? cfg.maxval : undefined}
          onChange={(e) => {
            const v = cfg.type === "int" ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
        />
      )}
      {cfg.type === "bool" && (
        <input type="checkbox" checked={Boolean(value ?? cfg.defval)} onChange={(e) => onChange(e.target.checked)} />
      )}
      {cfg.type === "source" && (
        <select value={String(value ?? cfg.defval ?? "close")} onChange={(e) => onChange(e.target.value)}>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {cfg.type === "color" && (
        <input type="color" value={toHex6(String(value ?? cfg.defval ?? "#888888"))} onChange={(e) => onChange(e.target.value)} />
      )}
      {cfg.type === "string" && opts && (
        <select value={String(value ?? cfg.defval ?? "")} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
        </select>
      )}
      {cfg.type === "string" && !opts && (
        <input type="text" value={String(value ?? cfg.defval ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
      {!cfg.type && (
        <input type="text" value={String(value ?? cfg.defval ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
