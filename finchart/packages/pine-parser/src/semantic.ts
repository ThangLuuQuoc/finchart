/**
 * Semantic pass: walks the AST and annotates ta.* call sites with unique IDs,
 * collects input/plot/var declarations, detects series history depth.
 *
 * Key invariant (the "trick bắt buộc"):
 *   Each physical ta.* Call expression in the source → one stateful instance.
 *   We use a WeakMap<Expr, CallSiteInfo> so codegen can look up any Call node.
 */

import type { Script, Stmt, Expr, Arg, Body, SwitchCase } from './ast';

// ── ta.* function registry ────────────────────────────────────────────────────

interface TaFunMeta {
  cls: string;
  /** 'src' = single numeric source arg + optional length; 'hlc' = (high,low,close) bar args */
  sig: 'src' | 'hlc';
  /** Index of length arg among positional args (0-based). null = no length (e.g. atr uses arg0). */
  lenArgIdx: number | null;
  /** Source arg index. null = no explicit source (atr/stoch use bar). */
  srcArgIdx: number | null;
  /** Default source series when source is omitted (single-arg highest/lowest). */
  defaultSrc: string | null;
  /** Extra constructor args beyond length (e.g. Macd has fast/slow/signal). */
  extraCtorArgIndices: number[];
}

const TA_FUNS: Record<string, TaFunMeta> = {
  'ta.sma':      { cls: 'Sma',        sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.ema':      { cls: 'Ema',        sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.rma':      { cls: 'Rma',        sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.wma':      { cls: 'Wma',        sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.vwma':     { cls: 'Sma',        sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] }, // approx as SMA
  'ta.stdev':    { cls: 'Stdev',      sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.variance': { cls: 'Stdev',      sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.change':   { cls: 'Change',     sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.highest':  { cls: 'Highest',    sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'high',  extraCtorArgIndices: [] },
  'ta.lowest':   { cls: 'Lowest',     sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'low',   extraCtorArgIndices: [] },
  'ta.rsi':      { cls: 'Rsi',        sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.atr':      { cls: 'Atr',        sig: 'hlc', lenArgIdx: 0, srcArgIdx: null, defaultSrc: null, extraCtorArgIndices: [] },
  'ta.bb':       { cls: 'Bollinger',  sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [2] },
  'ta.bbw':      { cls: 'Bollinger',  sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [2] },
  'ta.stoch':    { cls: 'Stochastic', sig: 'hlc', lenArgIdx: 2, srcArgIdx: null, defaultSrc: null, extraCtorArgIndices: [2, 3] },
  'ta.macd':     { cls: 'Macd',       sig: 'src', lenArgIdx: null, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [1, 2, 3] },
  'ta.cci':      { cls: 'Sma',        sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] }, // approx
  'ta.cmo':      { cls: 'Change',     sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
  'ta.mom':      { cls: 'Change',     sig: 'src', lenArgIdx: 1, srcArgIdx: 0, defaultSrc: 'close', extraCtorArgIndices: [] },
};

// ── output types ──────────────────────────────────────────────────────────────

export interface CallSiteInfo {
  id: string;
  pineClass: string;
  /** True if the call has only 1 positional arg (length), no explicit source. */
  singleArgForm: boolean;
  /** Resolved ta function name, e.g. 'ta.rsi' */
  taFn: string;
  /** ta function metadata */
  meta: TaFunMeta;
  /** The source Expr (arg 0 for 2-arg form), or null for hlc / single-arg form. */
  srcExpr: Expr | null;
  /** The length Expr for ctor. */
  lenExpr: Expr | null;
  /** Extra ctor arg expressions (e.g. mult for Bollinger). */
  extraCtorExprs: Expr[];
  line: number;
}

export interface InputInfo {
  varName: string;
  pineId: string;        // "_inp_length"
  fn: string;            // "input.int"
  defvalExpr: Expr | null;
  titleExpr: Expr | null;
  minExpr: Expr | null;
  maxExpr: Expr | null;
  stepExpr: Expr | null;
  /** `options = [ ... ]` dropdown choices (for input.string / input.int). */
  optionsExpr: Expr | null;
  groupExpr: Expr | null;
  tooltipExpr: Expr | null;
  inlineExpr: Expr | null;
}

export interface PlotInfo {
  id: string;
  fn: string;
  srcExpr: Expr;
  color: Expr | null;
  titleExpr: Expr | null;
  styleExpr: Expr | null;
  linewidthExpr: Expr | null;
  line: number;
}

export interface VarInfo {
  name: string;
  mode: 'var' | 'varip';
  initExpr: Expr | null;
  typeRef: string | null;
}

/**
 * Top-level plain `name = <const expr>` declaration that must live at module
 * scope (e.g. option strings used as `input.string` defaults, tooltip/group
 * text). These are referenced by `_inputs`/`meta` which are emitted at module
 * scope, so they cannot stay inside `onBar`. Bar-dependent decls (`src = close`)
 * are NOT collected — they stay per-bar inside `onBar`.
 */
export interface ModuleConst {
  name: string;
  initExpr: Expr;
  /** The originating VarDecl, so codegen can skip re-emitting it inside onBar. */
  stmt: Extract<Stmt, { kind: 'VarDecl' }>;
}

export interface SemanticResult {
  scriptName: string;
  overlay: boolean;
  /** Map from Call Expr object → CallSiteInfo (uses object identity). */
  callSites: WeakMap<object, CallSiteInfo>;
  inputs: Map<string, InputInfo>;
  plots: PlotInfo[];
  vars: VarInfo[];
  /** Top-level constant decls hoisted to module scope (see ModuleConst). */
  moduleConsts: ModuleConst[];
  /** Max bars-back found in series[n] access (determines BarHistory capacity). */
  historyDepth: number;
  /** `max_bars_back` declared on indicator()/strategy() — author's lookback budget. */
  maxBarsBack: number;
  warnings: string[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getMemberChain(expr: Expr): string | null {
  if (expr.kind === 'Ident') return expr.name;
  if (expr.kind === 'Member') {
    const base = getMemberChain(expr.object);
    return base ? `${base}.${expr.property}` : null;
  }
  return null;
}

function getNamedArg(args: Arg[], name: string): Expr | null {
  return args.find(a => a.name === name)?.value ?? null;
}

function getPosArg(args: Arg[], idx: number): Expr | null {
  const positional = args.filter(a => a.name === null);
  return positional[idx]?.value ?? null;
}

function getAnyArg(args: Arg[], name: string, idx: number): Expr | null {
  return getNamedArg(args, name) ?? getPosArg(args, idx);
}

function getStringLit(expr: Expr | null): string | null {
  if (!expr) return null;
  if (expr.kind === 'Str') return expr.value;
  return null;
}

function inputPineId(varName: string): string {
  return `_inp_${varName}`;
}

// ── analyzer ──────────────────────────────────────────────────────────────────

export function analyze(script: Script): SemanticResult {
  const result: SemanticResult = {
    scriptName: 'Unnamed',
    overlay: false,
    callSites: new WeakMap(),
    inputs: new Map(),
    plots: [],
    vars: [],
    moduleConsts: [],
    historyDepth: 0,
    maxBarsBack: 0,
    warnings: [],
  };

  let taCallCounter: Record<string, number> = {};
  let plotCounter = 0;

  // First pass: collect all inputs assigned to named variables.
  // We do this first so ta.* constructor arg resolution can reference input IDs.
  collectInputs(script.statements, result);

  // Hoist top-level constant decls to module scope (option strings, tooltips…).
  // Must run after collectInputs so we can skip names that are inputs.
  collectModuleConsts(script.statements, result);

  // Second pass: walk everything to find ta.* calls, plots, vars, history.
  walkStmts(script.statements, result, taCallCounter, plotCounter);

  return result;
}

function collectInputs(stmts: Stmt[], result: SemanticResult): void {
  for (const stmt of stmts) {
    if (stmt.kind === 'VarDecl' && stmt.init) {
      const inputInfo = tryExtractInput(stmt.name, stmt.init);
      if (inputInfo) result.inputs.set(stmt.name, inputInfo);
    }
    // Recurse into blocks
    walkStmtBody(stmt, s => collectInputs(s, result));
  }
}

function tryExtractInput(varName: string, expr: Expr): InputInfo | null {
  if (expr.kind !== 'Call') return null;
  const fn = getMemberChain(expr.callee);
  if (!fn?.startsWith('input')) return null;

  const INPUT_FNS = ['input.int', 'input.float', 'input.bool', 'input.string',
                     'input.color', 'input.timeframe', 'input.source', 'input'];
  if (!INPUT_FNS.includes(fn)) return null;

  const defvalExpr = getPosArg(expr.args, 0) ?? getNamedArg(expr.args, 'defval');
  const titleExpr  = getPosArg(expr.args, 1) ?? getNamedArg(expr.args, 'title');
  const minExpr    = getNamedArg(expr.args, 'minval');
  const maxExpr    = getNamedArg(expr.args, 'maxval');
  const stepExpr   = getNamedArg(expr.args, 'step');
  const optionsExpr= getNamedArg(expr.args, 'options');
  const groupExpr  = getNamedArg(expr.args, 'group');
  const tooltipExpr= getNamedArg(expr.args, 'tooltip');
  const inlineExpr = getNamedArg(expr.args, 'inline');

  return {
    varName,
    pineId: inputPineId(varName),
    fn,
    defvalExpr,
    titleExpr,
    minExpr,
    maxExpr,
    stepExpr,
    optionsExpr,
    groupExpr,
    tooltipExpr,
    inlineExpr,
  };
}

/**
 * Collect top-level `name = <const>` decls (mode === null, not an input, not a
 * var/varip) whose initializer is bar-independent. They are emitted at module
 * scope before `_inputs`, since `_inputs`/`meta` reference them there.
 * Only the top level is scanned — nested const decls stay inside onBar.
 */
function collectModuleConsts(stmts: Stmt[], result: SemanticResult): void {
  const known = new Set<string>();
  for (const stmt of stmts) {
    if (stmt.kind !== 'VarDecl') continue;
    if (stmt.mode === 'var' || stmt.mode === 'varip') continue; // → vars, per-bar init
    if (!stmt.init) continue;
    if (result.inputs.has(stmt.name)) continue;                 // → lifted to _inputs
    if (!isConstExpr(stmt.init, known)) continue;               // bar-dependent → stays in onBar
    result.moduleConsts.push({ name: stmt.name, initExpr: stmt.init, stmt });
    known.add(stmt.name);
  }
}

/** Conservative: literals, enum/color namespaces, and operations over those. */
export function isConstExpr(expr: Expr, known: Set<string>): boolean {
  switch (expr.kind) {
    case 'Num': case 'Str': case 'Color':
      return true;
    case 'Ident':
      return expr.name === 'true' || expr.name === 'false' || expr.name === 'na'
        || known.has(expr.name);
    case 'Unary':
      return isConstExpr(expr.operand, known);
    case 'Binary':
      return isConstExpr(expr.left, known) && isConstExpr(expr.right, known);
    case 'Ternary':
      return isConstExpr(expr.cond, known) && isConstExpr(expr.then, known) && isConstExpr(expr.else_, known);
    case 'Member': {
      const chain = getMemberChain(expr);
      // enum / color / style namespaces are compile-time constants
      return !!chain && /^(?:color|size|line|label|plot|plotshape|location|shape|xloc|yloc|extend|format|position|text|font|display|scale|barmerge|hline|currency|dayofweek|session|adjustment|math)\./.test(chain);
    }
    default:
      return false;
  }
}

function walkStmtBody(stmt: Stmt, cb: (stmts: Stmt[]) => void): void {
  switch (stmt.kind) {
    case 'If':
      cb(stmt.then);
      if (stmt.else_) cb(stmt.else_);
      break;
    case 'ForTo': case 'ForIn': case 'While':
      cb(stmt.body);
      break;
    case 'Switch':
      for (const c of stmt.cases) {
        if (c.body.kind === 'block') cb(c.body.stmts);
      }
      break;
    case 'FnDecl':
      if (stmt.body.kind === 'block') cb(stmt.body.stmts);
      break;
    case 'Multi':
      cb(stmt.stmts);
      break;
  }
}

function walkStmts(
  stmts: Stmt[],
  result: SemanticResult,
  taCounter: Record<string, number>,
  plotCounter: number,
): number {
  for (const stmt of stmts) {
    plotCounter = walkStmt(stmt, result, taCounter, plotCounter);
  }
  return plotCounter;
}

function walkStmt(
  stmt: Stmt,
  result: SemanticResult,
  taCounter: Record<string, number>,
  plotCounter: number,
): number {
  switch (stmt.kind) {
    case 'VarDecl': {
      if (stmt.mode === 'var' || stmt.mode === 'varip') {
        result.vars.push({ name: stmt.name, mode: stmt.mode, initExpr: stmt.init, typeRef: stmt.typeRef });
      }
      if (stmt.init) plotCounter = walkExprFull(stmt.init, result, taCounter, plotCounter, null);
      break;
    }
    case 'Assign':
      plotCounter = walkExprFull(stmt.value, result, taCounter, plotCounter, null);
      plotCounter = walkExprFull(stmt.target, result, taCounter, plotCounter, null);
      break;
    case 'ExprStmt':
      plotCounter = walkExprFull(stmt.expr, result, taCounter, plotCounter, stmt.expr);
      break;
    case 'TupleDecl':
      plotCounter = walkExprFull(stmt.init, result, taCounter, plotCounter, stmt.init);
      break;
    case 'If':
      plotCounter = walkExprFull(stmt.cond, result, taCounter, plotCounter, null);
      plotCounter = walkStmts(stmt.then, result, taCounter, plotCounter);
      if (stmt.else_) plotCounter = walkStmts(stmt.else_, result, taCounter, plotCounter);
      break;
    case 'ForTo':
      plotCounter = walkExprFull(stmt.from, result, taCounter, plotCounter, null);
      plotCounter = walkExprFull(stmt.to, result, taCounter, plotCounter, null);
      if (stmt.by) plotCounter = walkExprFull(stmt.by, result, taCounter, plotCounter, null);
      plotCounter = walkStmts(stmt.body, result, taCounter, plotCounter);
      break;
    case 'ForIn':
      plotCounter = walkExprFull(stmt.iter, result, taCounter, plotCounter, null);
      plotCounter = walkStmts(stmt.body, result, taCounter, plotCounter);
      break;
    case 'While':
      plotCounter = walkExprFull(stmt.cond, result, taCounter, plotCounter, null);
      plotCounter = walkStmts(stmt.body, result, taCounter, plotCounter);
      break;
    case 'Switch':
      if (stmt.subject) plotCounter = walkExprFull(stmt.subject, result, taCounter, plotCounter, null);
      for (const c of stmt.cases) {
        if (c.cond) plotCounter = walkExprFull(c.cond, result, taCounter, plotCounter, null);
        if (c.body.kind === 'block') plotCounter = walkStmts(c.body.stmts, result, taCounter, plotCounter);
        else plotCounter = walkExprFull(c.body.expr, result, taCounter, plotCounter, null);
      }
      break;
    case 'FnDecl':
      if (stmt.body.kind === 'block') plotCounter = walkStmts(stmt.body.stmts, result, taCounter, plotCounter);
      else plotCounter = walkExprFull(stmt.body.expr, result, taCounter, plotCounter, null);
      break;
    case 'Multi':
      for (const s of stmt.stmts) plotCounter = walkStmt(s, result, taCounter, plotCounter);
      break;
    default:
      break;
  }
  return plotCounter;
}

function walkExprFull(
  expr: Expr,
  result: SemanticResult,
  taCounter: Record<string, number>,
  plotCounter: number,
  stmtExpr: Expr | null,
): number {
  switch (expr.kind) {
    case 'Call': {
      const fn = getMemberChain(expr.callee);

      // ta.* — hoist as call site
      if (fn && fn in TA_FUNS) {
        const meta = TA_FUNS[fn]!;
        const shortName = fn.replace('ta.', '');
        taCounter[shortName] = (taCounter[shortName] ?? 0) + 1;
        const id = `_${shortName}_${taCounter[shortName]}`;

        const positional = expr.args.filter(a => a.name === null);
        const single = meta.srcArgIdx !== null && positional.length === 1;

        let srcExpr: Expr | null = null;
        let lenExpr: Expr | null = null;
        const extraCtorExprs: Expr[] = [];

        if (meta.sig === 'hlc') {
          // atr(len), stoch(close, high, low, kLen, dLen)
          lenExpr = meta.lenArgIdx !== null ? (getPosArg(expr.args, meta.lenArgIdx) ?? null) : null;
          for (const idx of meta.extraCtorArgIndices) {
            const e = getPosArg(expr.args, idx);
            if (e) extraCtorExprs.push(e);
          }
        } else if (single) {
          // Check if the single argument is length or source
          const singleIsLen = fn === 'ta.highest' || fn === 'ta.lowest';
          if (singleIsLen) {
            lenExpr = positional[0]?.value ?? null;
          } else {
            srcExpr = positional[0]?.value ?? null;
          }
        } else {
          srcExpr = meta.srcArgIdx !== null ? (getPosArg(expr.args, meta.srcArgIdx) ?? null) : null;
          lenExpr = meta.lenArgIdx !== null ? (getPosArg(expr.args, meta.lenArgIdx) ?? null) : null;
          for (const idx of meta.extraCtorArgIndices) {
            const e = getPosArg(expr.args, idx);
            if (e) extraCtorExprs.push(e);
          }
        }

        const info: CallSiteInfo = {
          id,
          pineClass: meta.cls,
          singleArgForm: single,
          taFn: fn,
          meta,
          srcExpr,
          lenExpr,
          extraCtorExprs,
          line: expr.pos.line,
        };
        result.callSites.set(expr, info);
      }

      // indicator() / strategy() — extract name/overlay/max_bars_back
      if (fn === 'indicator' || fn === 'strategy') {
        const titleExpr = getPosArg(expr.args, 0) ?? getNamedArg(expr.args, 'title');
        if (titleExpr?.kind === 'Str') result.scriptName = titleExpr.value;
        const overlayExpr = getNamedArg(expr.args, 'overlay') ?? getPosArg(expr.args, 1);
        if (overlayExpr?.kind === 'Ident' && overlayExpr.name === 'true') result.overlay = true;
        const mbb = getNamedArg(expr.args, 'max_bars_back');
        if (mbb?.kind === 'Num') result.maxBarsBack = Math.ceil(mbb.value);
      }

      // plot / plotshape / plotchar / hline / fill / bgcolor
      const PLOT_FNS = new Set(['plot', 'plotshape', 'plotchar', 'plotcandle', 'plotarrow', 'hline', 'fill', 'bgcolor', 'barcolor']);
      if (fn && PLOT_FNS.has(fn)) {
        plotCounter++;
        const srcExpr = getPosArg(expr.args, 0) ?? getNamedArg(expr.args, 'series') ?? getNamedArg(expr.args, 'hline1');
        if (srcExpr) {
          // `plot(series, title, color, linewidth, style, …)` — known positions.
          // Other plot-family fns vary, so fall back to named args only.
          const isPlot = fn === 'plot';
          result.plots.push({
            id: `_plot_${plotCounter}`,
            fn: fn,
            srcExpr,
            titleExpr:     isPlot ? getAnyArg(expr.args, 'title', 1)     : getNamedArg(expr.args, 'title'),
            color:         isPlot ? getAnyArg(expr.args, 'color', 2)     : getNamedArg(expr.args, 'color'),
            linewidthExpr: isPlot ? getAnyArg(expr.args, 'linewidth', 3) : getNamedArg(expr.args, 'linewidth'),
            styleExpr:     isPlot ? getAnyArg(expr.args, 'style', 4)     : getNamedArg(expr.args, 'style'),
            line: expr.pos.line,
          });
        }
      }

      // Recurse into args
      for (const a of expr.args) {
        plotCounter = walkExprFull(a.value, result, taCounter, plotCounter, null);
      }
      break;
    }

    case 'Index': {
      // Series history access: x[n]
      plotCounter = walkExprFull(expr.object, result, taCounter, plotCounter, null);
      for (const idx of expr.indices) {
        // Try to determine how far back
        if (idx.kind === 'Num') {
          result.historyDepth = Math.max(result.historyDepth, Math.ceil(idx.value));
        } else {
          // Dynamic index — assume we need a large buffer
          result.historyDepth = Math.max(result.historyDepth, 500);
        }
        plotCounter = walkExprFull(idx, result, taCounter, plotCounter, null);
      }
      break;
    }

    case 'Member':
      plotCounter = walkExprFull(expr.object, result, taCounter, plotCounter, null);
      break;

    case 'Binary':
      plotCounter = walkExprFull(expr.left, result, taCounter, plotCounter, null);
      plotCounter = walkExprFull(expr.right, result, taCounter, plotCounter, null);
      break;

    case 'Unary':
      plotCounter = walkExprFull(expr.operand, result, taCounter, plotCounter, null);
      break;

    case 'Ternary':
      plotCounter = walkExprFull(expr.cond, result, taCounter, plotCounter, null);
      plotCounter = walkExprFull(expr.then, result, taCounter, plotCounter, null);
      plotCounter = walkExprFull(expr.else_, result, taCounter, plotCounter, null);
      break;

    case 'Tuple':
      for (const item of expr.items) {
        plotCounter = walkExprFull(item, result, taCounter, plotCounter, null);
      }
      break;

    case 'IfExpr':
      plotCounter = walkStmt(expr.stmt, result, taCounter, plotCounter);
      break;

    case 'SwitchExpr':
      plotCounter = walkStmt(expr.stmt, result, taCounter, plotCounter);
      break;

    case 'ForExpr':
      plotCounter = walkStmt(expr.stmt, result, taCounter, plotCounter);
      break;

    default:
      break;
  }
  return plotCounter;
}
