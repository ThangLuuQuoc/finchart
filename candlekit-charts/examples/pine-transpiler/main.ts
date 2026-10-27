import { ChartController, type Bar } from "@getcandlekit/charts";
import { StreamingIndicatorController, type StreamingEngineDef } from "../stress/streaming-controller";
import { parse, analyze, generate } from "@finchart/pine-parser";
import * as PineRT from "@finchart/pine-rt";
import { compileAndLoad } from "./compiler";

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_moduleId: any, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  }
};

// Map PineRT to global window so the dynamically imported module can access it
(window as any).PineRT = PineRT;

const $ = (id: string) => document.getElementById(id)!;

const DEFAULT_SCRIPT = `//@version=5
indicator("My Custom RSI", overlay=false)
length = input.int(14, "RSI Length", minval=1)
up_color = input.color(color.green, "Up Color")
down_color = input.color(color.red, "Down Color")

r = ta.rsi(close, length)
plot(r, title="RSI", color = r > 50 ? up_color : down_color, linewidth=2)
hline(70, title="Overbought", color=color.gray, linestyle=hline.style_dashed)
hline(30, title="Oversold", color=color.gray, linestyle=hline.style_dashed)
`;

let editor: monaco.editor.IStandaloneCodeEditor;
let chart: ChartController;
let streamingController: StreamingIndicatorController;
let bars: Bar[] = [];
let currentIndicatorId: string | null = null;

async function initData() {
  setStatus("Fetching 50k real BTCUSDT bars…");
  const raw = await (await fetch("/data-50k.json")).json();
  bars = raw.bars.map((b: number[]) => ({
    ts: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5],
  }));
  setStatus(`Loaded ${bars.length} bars`, "success");
}

class PineDrawingsPrimitive {
  private chart: any;
  private series: any;
  private reqUpdate: any;

  attached({ chart, series, requestUpdate }: any) {
    this.chart = chart;
    this.series = series;
    this.reqUpdate = requestUpdate;
    (window as any).pineRequestUpdate = requestUpdate;
  }
  detached() {}
  paneViews() {
    return [{
      zOrder: () => 'normal',
      update: () => {},
      renderer: () => ({
        draw: (target: any) => {
          target.useMediaCoordinateSpace(({ context: ctx }: any) => {
            if (!this.series || !this.chart) return;
            
            // DEBUG LOGS
            if (!(window as any)._loggedDrawings) {
              console.log("Drawings count:", PineRT.activeDrawings.boxes.size, PineRT.activeDrawings.lines.size);
              if (PineRT.activeDrawings.boxes.size > 0) {
                 const b = Array.from(PineRT.activeDrawings.boxes)[0] as any;
                 console.log("First box:", b);
              }
              (window as any)._loggedDrawings = true;
            }

            ctx.save();
            const series = this.series;
            const tScale = this.chart.timeScale();

            const getTimeCoord = (val: number, isTime: boolean) => {
               const idx = isTime ? bars.findIndex(b => b.ts >= val) : Math.floor(val);
               const b = bars[Math.max(0, Math.min(bars.length - 1, idx >= 0 ? idx : 0))];
               return b ? tScale.timeToCoordinate(b.ts / 1000) : null;
            };

            PineRT.activeDrawings.boxes.forEach((b: any) => {
              const isTime = b.xloc === 'bar_time';
              const x1 = getTimeCoord(b.left, isTime);
              const x2 = getTimeCoord(b.right, isTime);
              const y1 = series.priceToCoordinate(b.top);
              const y2 = series.priceToCoordinate(b.bottom);
              if (x1 == null || x2 == null || y1 == null || y2 == null) return;

              ctx.fillStyle = b.bgcolor || 'rgba(0,0,0,0)';
              ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
              
              if (b.border_color && b.border_color !== 'rgba(0,0,0,0)') {
                ctx.strokeStyle = b.border_color;
                ctx.lineWidth = b.border_width || 1;
                ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
              }
            });

            PineRT.activeDrawings.lines.forEach((l: any) => {
              const isTime = l.xloc === 'bar_time';
              const x1 = getTimeCoord(l.x1, isTime);
              const x2 = getTimeCoord(l.x2, isTime);
              const y1 = series.priceToCoordinate(l.y1);
              const y2 = series.priceToCoordinate(l.y2);
              if (x1 == null || x2 == null || y1 == null || y2 == null) return;

              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.strokeStyle = l.color || '#000';
              ctx.lineWidth = l.width || 1;
              ctx.stroke();
            });

            ctx.restore();
          });
        }
      })
    }];
  }
  updateAllViews() {
     if (this.reqUpdate) this.reqUpdate();
  }
}

function initUI() {
  editor = monaco.editor.create($("editor-container"), {
    value: DEFAULT_SCRIPT,
    language: "typescript", // fallback since no pine highlighter yet
    theme: "vs-dark",
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    automaticLayout: true,
  });

  chart = new ChartController($("chart"), {
    theme: "dark",
    seriesType: "candlestick",
    showVolume: true,
  });
  
  chart.getSeries().attachPrimitive(new PineDrawingsPrimitive() as any);
  
  streamingController = new StreamingIndicatorController();
  chart.use(streamingController);

  $("btn-run").addEventListener("click", runTranspiler);
}

function setStatus(msg: string, type: "normal" | "success" | "error" = "normal") {
  const overlay = $("status-overlay");
  overlay.textContent = msg;
  overlay.className = "visible";
  if (type === "error") overlay.classList.add("error-text");
  if (type === "success") overlay.classList.add("success-text");
  
  if (type === "success") {
    setTimeout(() => overlay.classList.remove("visible"), 3000);
  }
}

async function runTranspiler() {
  const code = editor.getValue();
  const t0 = performance.now();
  
  try {
    setStatus("Parsing...");
    const parsed = parse(code);
    if (parsed.errors.length > 0) {
      throw new Error("Syntax Error: " + parsed.errors[0].msg);
    }
    
    setStatus("Semantic Analysis...");
    const sem = analyze(parsed.script!);
    
    setStatus("Generating TypeScript...");
    const tsCode = generate(parsed.script!, sem);
    $("ts-output").textContent = tsCode;
    
    setStatus("Compiling in browser...");
    const module = await compileAndLoad(tsCode);
    
    $("compile-time").textContent = `(${(performance.now() - t0).toFixed(1)}ms)`;
    
    // Setup UI inputs
    renderSettingsForm(module._inputs, module.meta.inputs, module);
    
    // Mount to chart
    mountIndicator(module);
    
    setStatus(`Success!`, "success");
  } catch (err: any) {
    setStatus(err.message, "error");
    console.error(err);
  }
}

function renderSettingsForm(currentInputs: any, inputMeta: any[], compiledModule: any) {
  const form = $("settings-form");
  form.innerHTML = "";
  
  if (!currentInputs || Object.keys(currentInputs).length === 0) {
    form.innerHTML = `<div style="color:#64748b; font-size:13px;">No configurable inputs found.</div>`;
    return;
  }

  for (const meta of inputMeta) {
    const key = meta.id;
    const group = document.createElement("div");
    group.className = "input-group";
    
    const label = document.createElement("label");
    label.textContent = meta.title || key;
    
    let inputEl: HTMLInputElement | HTMLSelectElement;
    
    if (meta.fn === "input.bool") {
      group.classList.add("checkbox-row");
      inputEl = document.createElement("input");
      inputEl.type = "checkbox";
      inputEl.checked = currentInputs[key];
      group.appendChild(inputEl);
      group.appendChild(label);
    } else {
      inputEl = document.createElement("input");
      inputEl.type = (meta.fn === "input.int" || meta.fn === "input.float") ? "number" : "text";
      inputEl.value = currentInputs[key];
      if (meta.minval !== undefined) inputEl.min = meta.minval;
      if (meta.maxval !== undefined) inputEl.max = meta.maxval;
      if (meta.step !== undefined) inputEl.step = meta.step;
      
      group.appendChild(label);
      group.appendChild(inputEl);
    }
    
    inputEl.addEventListener("change", (e: any) => {
      let val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (meta.fn === "input.int") val = parseInt(val, 10);
      if (meta.fn === "input.float") val = parseFloat(val);
      
      currentInputs[key] = val;
      mountIndicator(compiledModule); // re-run indicator with new inputs
    });
    
    if (meta.fn !== "input.bool") form.appendChild(group);
  }
}

function mountIndicator(module: any) {
  if (currentIndicatorId) {
    streamingController.remove(currentIndicatorId);
  }
  
  const { meta } = module;
  const overlay = meta.overlay || false;

  const plots = meta.plots.map((p: any) => ({
    id: p.id,
    color: p.color || "#a78bfa",
    lineWidth: p.lineWidth || p.linewidth || 2,
    style: p.style === "histogram" ? "histogram" : "line"
  }));

  const def: StreamingEngineDef = {
    name: meta.name || "Pine Indicator",
    overlay,
    plots,
    create() {
      PineRT.activeDrawings.clear(); // reset drawings
      // Fresh stateful instance per mount (own ta.* state, var state, history).
      const inst = module.createInstance(module._inputs);
      let barIndex = 0;
      return {
        next: (b: Bar) => {
          barIndex++;
          const res = inst.onBar(b, barIndex, barIndex === bars.length - 1);
          if (barIndex === bars.length - 1 && (window as any).pineRequestUpdate) {
             (window as any).pineRequestUpdate();
          }
          return res.plots ? res.plots : res;
        },
        peek: (b: Bar) => {
          const res = inst.onBar(b, barIndex + 1, true, false);
          if ((window as any).pineRequestUpdate) {
             (window as any).pineRequestUpdate();
          }
          return res.plots ? res.plots : res;
        }
      };
    }
  };
  
  currentIndicatorId = def.name;
  streamingController.add(def);
}

async function boot() {
  initUI();
  await initData();
  chart.setData(bars);
}

boot().catch(console.error);
