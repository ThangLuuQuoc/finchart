/**
 * Codegen: walks AST + SemanticResult → readable TypeScript targeting @finchart/pine-rt.
 *
 * Generated module shape:
 *   export const _inputs = { _inp_length: 14, ... }
 *   const _rsi_1 = new Rsi(_inputs._inp_length)     // hoisted instances
 *   let _var_mySum = 0.0                             // var / varip state
 *   export const meta = { name, overlay, inputs, plots }
 *   export function onBar(bar, barIndex, isLast, hist): { plots, draw }
 */

import type { Script, Stmt, Expr, Arg, Body } from './ast';
import type { SemanticResult, CallSiteInfo, InputInfo, VarInfo } from './semantic';
import { isConstExpr } from './semantic';

const NO_KNOWN: Set<string> = new Set();

// ── Pine built-in → TS mappings ───────────────────────────────────────────────

const BUILTIN_SERIES = new Set(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4']);

const BUILTIN_SERIES_EXPR: Record<string, string> = {
  open:   'bar.open',
  high:   'bar.high',
  low:    'bar.low',
  close:  'bar.close',
  volume: 'bar.volume',
  hl2:    '(bar.high + bar.low) / 2',
  hlc3:   '(bar.high + bar.low + bar.close) / 3',
  ohlc4:  '(bar.open + bar.high + bar.low + bar.close) / 4',
  hlcc4:  '(bar.high + bar.low + bar.close * 2) / 4',
};

const PINE_COLORS: Record<string, string> = {
  'color.red':     "'#FF4136'",
  'color.blue':    "'#2196F3'",
  'color.green':   "'#4CAF50'",
  'color.white':   "'#FFFFFF'",
  'color.black':   "'#000000'",
  'color.orange':  "'#FF9800'",
  'color.yellow':  "'#FFEB3B'",
  'color.purple':  "'#9C27B0'",
  'color.lime':    "'#CDDC39'",
  'color.silver':  "'#9E9E9E'",
  'color.aqua':    "'#00BCD4'",
  'color.navy':    "'#1565C0'",
  'color.maroon':  "'#B71C1C'",
  'color.olive':   "'#827717'",
  'color.teal':    "'#00695C'",
  'color.fuchsia': "'#E91E63'",
  'color.gray':    "'#9E9E9E'",
};

const MATH_MAP: Record<string, string> = {
  'math.abs':              'Math.abs',
  'math.ceil':             'Math.ceil',
  'math.floor':            'Math.floor',
  'math.round':            'Math.round',
  'math.sqrt':             'Math.sqrt',
  'math.exp':              'Math.exp',
  'math.log':              'Math.log',
  'math.log2':             'Math.log2',
  'math.log10':            'Math.log10',
  'math.pow':              'Math.pow',
  'math.sin':              'Math.sin',
  'math.cos':              'Math.cos',
  'math.tan':              'Math.tan',
  'math.asin':             'Math.asin',
  'math.acos':             'Math.acos',
  'math.atan':             'Math.atan',
  'math.sign':             'Math.sign',
  'math.max':              'PineMath.max',
  'math.min':              'PineMath.min',
  'math.avg':              'PineMath.avg',
  'math.sum':              'PineMath.sum',
  'math.round_to_mintick': 'PineMath.round_to_mintick',
  'math.todegrees':        'PineMath.todegrees',
  'math.toradians':        'PineMath.toradians',
  'math.random':           'PineMath.random',
};

const STR_MAP: Record<string, string> = {
  'str.tostring':   'PineStr.tostring',
  'str.tonumber':   'PineStr.tonumber',
  'str.toint':      'PineStr.toint',
  'str.format':     'PineStr.format',
  'str.contains':   'PineStr.contains',
  'str.startswith': 'PineStr.startswith',
  'str.endswith':   'PineStr.endswith',
  'str.length':     'PineStr.length',
  'str.lower':      'PineStr.lower',
  'str.upper':      'PineStr.upper',
  'str.replace':    'PineStr.replace',
  'str.replace_all':'PineStr.replace_all',
  'str.split':      'PineStr.split',
  'str.substring':  'PineStr.substring',
  'str.trim':       'PineStr.trim',
  'str.match':      'PineStr.match',
  'str.pos':        'PineStr.pos',
};

const ARRAY_MAP: Record<string, string> = {
  'array.new_float':  'PineArray.newFloat',
  'array.new_int':    'PineArray.newInt',
  'array.new_bool':   'PineArray.newBool',
  'array.new_string': 'PineArray.newString',
  'array.new_box':    'PineArray.new',
  'array.new_line':   'PineArray.new',
  'array.new_label':  'PineArray.new',
  'array.new_color':  'PineArray.new',
  'array.new':        'PineArray.new',
  'array.from':       'PineArray.from',
  // method-style: array.push(arr, v) → arr.push(v)  — handled separately
};

const ARRAY_METHODS: Record<string, string> = {
  'array.get':        'get',
  'array.set':        'set',
  'array.push':       'push',
  'array.pop':        'pop',
  'array.shift':      'shift',
  'array.unshift':    'unshift',
  'array.insert':     'insert',
  'array.remove':     'remove',
  'array.size':       'size',
  'array.clear':      'clear',
  'array.fill':       'fill',
  'array.reverse':    'reverse',
  'array.sort':       'sort',
  'array.includes':   'includes',
  'array.indexof':    'indexof',
  'array.lastindexof':'lastindexof',
  'array.first':      'first',
  'array.last':       'last',
  'array.sum':        'sum',
  'array.max':        'max',
  'array.min':        'min',
  'array.avg':        'avg',
  'array.stdev':      'stdev',
  'array.variance':   'variance',
  'array.median':     'median',
  'array.mode':       'mode',
  'array.range':      'range',
  'array.join':       'join',
  'array.concat':     'concat',
  'array.slice':      'slice',
  'array.copy':       'copy',
  'array.percentile_nearest_rank':         'percentile_nearest_rank',
  'array.percentile_linear_interpolation': 'percentile_linear_interpolation',
  'array.covariance': 'covariance',
  'array.standardize':'standardize',
};

const BOX_METHODS: Record<string, string> = {
  'box.set_left':         'set_left',
  'box.set_right':        'set_right',
  'box.set_top':          'set_top',
  'box.set_bottom':       'set_bottom',
  'box.set_bgcolor':      'set_bgcolor',
  'box.set_border_color': 'set_border_color',
  'box.set_border_width': 'set_border_width',
  'box.set_text':         'set_text',
};

const LINE_METHODS: Record<string, string> = {
  'line.set_x1': 'set_x1', 'line.set_x2': 'set_x2',
  'line.set_y1': 'set_y1', 'line.set_y2': 'set_y2',
  'line.set_color': 'set_color', 'line.set_width': 'set_width',
  'line.set_extend': 'set_extend',
};

const LABEL_METHODS: Record<string, string> = {
  'label.set_x': 'set_x', 'label.set_y': 'set_y',
  'label.set_text': 'set_text', 'label.set_color': 'set_color',
  'label.set_text_color': 'set_text_color', 'label.set_style': 'set_style',
};

// ── classes we actually need to import ───────────────────────────────────────

const PRIMITIVE_IMPORTS = new Set(['Sma', 'Ema', 'Rma', 'Wma', 'Stdev', 'Change', 'Highest', 'Lowest', 'TrueRange']);
const INDICATOR_IMPORTS = new Set(['Rsi', 'Macd', 'Bollinger', 'Atr', 'Stochastic']);

// ── main entry point ──────────────────────────────────────────────────────────

export function generate(script: Script, sem: SemanticResult): string {
  const ctx = new GenCtx(script, sem);
  return ctx.emit();
}

// ── codegen context ───────────────────────────────────────────────────────────

class GenCtx {
  private indentLevel = 0;
  private lines: string[] = [];
  private usedClasses = new Set<string>();
  private needsHistory = false;
  private needsMath = false;
  private needsStr = false;
  private needsArray = false;
  private needsDrawing = false;
  /** VarDecl stmts hoisted to module scope — skipped when emitting onBar body. */
  private readonly moduleConstStmts: Set<Stmt>;
  /** `var`/`varip` whose init is runtime-dependent — initialized once on bar 1. */
  private deferredVarInits: VarInfo[] = [];

  constructor(private readonly script: Script, private readonly sem: SemanticResult) {
    this.moduleConstStmts = new Set(sem.moduleConsts.map(c => c.stmt));
  }

  emit(): string {
    // Pre-scan to determine what we need
    this.preScan();

    const out: string[] = [];

    // Header comment
    out.push('// Generated by @finchart/pine-parser');
    out.push(`// Source: ${this.sem.scriptName}`);
    out.push('');

    // Imports
    out.push(this.emitImports());
    out.push('');

    // Module-scope constants (option strings, tooltip/group text, …) — must be
    // declared before _inputs/meta, which reference them at module scope.
    if (this.sem.moduleConsts.length > 0) {
      out.push('// ── module constants ──');
      for (const c of this.sem.moduleConsts) {
        const initStr = this.exprToStr(c.initExpr);
        out.push(`const ${c.name} = ${initStr === 'na' ? 'NaN' : initStr};`);
      }
      out.push('');
    }

    // Inputs — module-level DEFAULTS the UI reads. Per-instance overrides are
    // merged inside createInstance() so each mount can have its own params.
    const hasInputs = this.sem.inputs.size > 0;
    if (hasInputs) {
      out.push('// ── inputs (defaults) ──');
      out.push('const _inputDefaults = {');
      for (const [, info] of this.sem.inputs) {
        const defval = this.inputDefvalStr(info);
        const title  = info.titleExpr  ? ` // ${info.fn}(${defval}, ${this.exprToStr(info.titleExpr)})` : ` // ${info.fn}(${defval})`;
        out.push(`  ${info.pineId}: ${defval},${title}`);
      }
      out.push('};');
      out.push('export const _inputs = _inputDefaults;');
      out.push('');
    }

    // meta — static, module-level (the menu/settings UI reads this).
    out.push('// ── metadata ──');
    out.push('export const meta = {');
    out.push(`  name: ${JSON.stringify(this.sem.scriptName)},`);
    out.push(`  overlay: ${this.sem.overlay},`);
    if (hasInputs) {
      out.push('  inputs: [');
      for (const [, info] of this.sem.inputs) {
        out.push(`    ${this.emitInputMeta(info)},`);
      }
      out.push('  ],');
    } else {
      out.push('  inputs: [],');
    }
    if (this.sem.plots.length > 0) {
      out.push('  plots: [');
      for (const p of this.sem.plots) {
        out.push(`    ${this.emitPlotMeta(p)},`);
      }
      out.push('  ],');
    } else {
      out.push('  plots: [],');
    }
    out.push('};');
    out.push('');

    // Bar type
    out.push('export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };');
    out.push('export type Plots = Record<string, number>;');
    if (this.needsDrawing) {
      out.push('export type DrawCmds = DrawCmd[];');
    }
    out.push('');

    // ── instance factory ──
    // Every createInstance() owns its own state (ta.* instances, var state, bar
    // history) and its own resolved inputs, so one indicator can be mounted more
    // than once without sharing state. Maps 1:1 to candlekit's streaming(inputs).
    const inner: string[] = [];

    // ta.* instances (lazy, one per call-site)
    const callSiteList = this.collectCallSiteList();
    const hasTa = callSiteList.length > 0;
    if (hasTa) {
      inner.push('// hoisted ta.* instances');
      for (const cs of callSiteList) inner.push(this.emitHoistedInstance(cs));
      // Mode flag for peek (preview, non-committing) vs next (commit). Closure-
      // scoped so ta.* calls inside nested user functions see it too.
      inner.push('let _commit = true;');
      inner.push('');
    }

    // var / varip state. Pine `var` initializes ONCE on the first bar the line is
    // reached. A constant init can be emitted directly; a runtime init (bar_index,
    // history, chart.*, calls…) is deferred into onBar under a once-guard.
    const varDecls = this.sem.vars;
    if (varDecls.length > 0) {
      inner.push('// var / varip state');
      for (const v of varDecls) {
        const tsType = v.typeRef ? this.pineTypeToTs(v.typeRef) : 'unknown';
        if (!v.initExpr) {
          inner.push(`let _var_${v.name}: ${tsType};`);
          continue;
        }
        if (isConstExpr(v.initExpr, NO_KNOWN)) {
          const initStr = this.exprToStr(v.initExpr);
          inner.push(`let _var_${v.name}: ${tsType} = ${initStr === 'na' ? 'NaN' : initStr};`);
        } else {
          inner.push(`let _var_${v.name}: ${tsType} = NaN as any;`);
          this.deferredVarInits.push(v);
        }
      }
      if (this.deferredVarInits.length > 0) inner.push('let _varsInit = false;');
      inner.push('');
    }

    // BarHistory if needed
    if (this.needsHistory) {
      const depth = Math.max(this.sem.historyDepth + 10, this.sem.maxBarsBack, 60);
      inner.push(`// bar history ring buffer (depth ${depth})`);
      inner.push(`const _hist = new BarHistory(${depth});`);
      inner.push('');
    }

    // Per-instance drawing collection (box/line/label) — NOT the global, so two
    // Pine drawing-indicators (or one across panes) never collide. onBar points
    // the runtime at it before running the body.
    if (this.needsDrawing) {
      inner.push('const _drawings = createDrawings();');
      inner.push('');
    }

    // onBar
    const returnType = this.needsDrawing ? '{ plots: Plots; draw: DrawCmd[]; drawings: Drawings }' : 'Plots';
    // `commit` (default true) = a confirmed bar (advance ta.* + persist history).
    // `commit === false` = a peek/preview of the in-progress bar: ta.* use
    // `.peek()` (no state advance) and the forming bar is pushed then restored,
    // so repeated peeks on the same tick are side-effect-free.
    inner.push(`function onBar(bar: Bar, barIndex: number, isLast: boolean, commit = true): ${returnType} {`);
    inner.push('  const { open, high, low, close, volume, time } = bar;');
    if (hasTa) inner.push('  _commit = commit;');
    if (this.needsDrawing) inner.push('  setActiveDrawings(_drawings);');
    if (this.needsHistory) {
      inner.push('  const _snap = commit ? null : _hist.snapshot();');
      inner.push('  _hist.push(bar);');
    }
    if (this.needsDrawing) inner.push('  const draw: DrawCmd[] = [];');
    inner.push('  const plots: Plots = {};');
    inner.push('');
    if (this.deferredVarInits.length > 0) {
      inner.push('  if (!_varsInit) {');
      for (const v of this.deferredVarInits) {
        inner.push(`    _var_${v.name} = ${this.exprToStr(v.initExpr!)};`);
      }
      inner.push('    _varsInit = true;');
      inner.push('  }');
      inner.push('');
    }
    this.indentLevel = 1;
    const bodyLines = this.emitStmts(this.script.statements);
    for (const l of bodyLines) inner.push(l);
    inner.push('');
    // Peek must not persist the forming bar in history (restore the cursor).
    if (this.needsHistory) inner.push('  if (_snap) _hist.restore(_snap);');
    inner.push(this.needsDrawing ? '  return { plots, draw, drawings: _drawings };' : '  return plots;');
    inner.push('}');

    // Wrap the state + onBar in the instance factory (indent everything by 2).
    out.push('export function createInstance(_overrides) {');
    if (hasInputs) {
      out.push('  const _inputs = Object.assign({}, _inputDefaults, _overrides || {});');
    }
    for (const l of inner) out.push(l === '' ? '' : '  ' + l);
    out.push(this.needsDrawing ? '  return { onBar, drawings: _drawings };' : '  return { onBar };');
    out.push('}');

    return out.join('\n');
  }

  // ── pre-scan ────────────────────────────────────────────────────────────────

  private preScan(): void {
    this.needsHistory = this.sem.historyDepth > 0 || this.sem.maxBarsBack > 0;
    this.walkExprForImports(this.script.statements);
  }

  private walkExprForImports(stmts: Stmt[]): void {
    for (const stmt of stmts) this.scanStmtForImports(stmt);
  }

  private scanStmtForImports(stmt: Stmt): void {
    // We just walk all call expressions to detect what's needed
    switch (stmt.kind) {
      case 'VarDecl': if (stmt.init) this.scanExprForImports(stmt.init); break;
      case 'Assign': this.scanExprForImports(stmt.value); break;
      case 'ExprStmt': this.scanExprForImports(stmt.expr); break;
      case 'TupleDecl': this.scanExprForImports(stmt.init); break;
      case 'If':
        this.scanExprForImports(stmt.cond);
        stmt.then.forEach(s => this.scanStmtForImports(s));
        stmt.else_?.forEach(s => this.scanStmtForImports(s));
        break;
      case 'ForTo':
        this.scanExprForImports(stmt.from); this.scanExprForImports(stmt.to);
        if (stmt.by) this.scanExprForImports(stmt.by);
        stmt.body.forEach(s => this.scanStmtForImports(s));
        break;
      case 'ForIn':
        this.scanExprForImports(stmt.iter);
        stmt.body.forEach(s => this.scanStmtForImports(s));
        break;
      case 'While':
        this.scanExprForImports(stmt.cond);
        stmt.body.forEach(s => this.scanStmtForImports(s));
        break;
      case 'Switch':
        if (stmt.subject) this.scanExprForImports(stmt.subject);
        for (const c of stmt.cases) {
          if (c.cond) this.scanExprForImports(c.cond);
          if (c.body.kind === 'block') c.body.stmts.forEach(s => this.scanStmtForImports(s));
          else this.scanExprForImports(c.body.expr);
        }
        break;
      case 'FnDecl':
        if (stmt.body.kind === 'block') stmt.body.stmts.forEach(s => this.scanStmtForImports(s));
        else this.scanExprForImports(stmt.body.expr);
        break;
      case 'Multi': stmt.stmts.forEach(s => this.scanStmtForImports(s)); break;
    }
  }

  private scanExprForImports(expr: Expr): void {
    if (expr.kind === 'Call') {
      const fn = this.getChain(expr.callee);
      if (fn) {
        if (fn.startsWith('math.')) this.needsMath = true;
        if (fn.startsWith('str.')) this.needsStr = true;
        if (fn.startsWith('array.')) this.needsArray = true;
        if (fn.startsWith('box.') || fn.startsWith('line.') || fn.startsWith('label.') || fn.startsWith('table.')) this.needsDrawing = true;
      }
      const cs = this.sem.callSites.get(expr);
      if (cs) this.usedClasses.add(cs.pineClass);
      for (const a of expr.args) this.scanExprForImports(a.value);
    } else if (expr.kind === 'Member') {
      const chain = this.getChain(expr);
      if (chain) {
        if (chain in PINE_COLORS) return;
        const base = chain.split('.')[0];
        if (base === 'box' || base === 'line' || base === 'label' || base === 'table') this.needsDrawing = true;
        if (base === 'math') this.needsMath = true;
        if (base === 'str') this.needsStr = true;
        if (base === 'array') this.needsArray = true;
      }
      this.scanExprForImports(expr.object);
    } else if (expr.kind === 'Binary') {
      this.scanExprForImports(expr.left);
      this.scanExprForImports(expr.right);
    } else if (expr.kind === 'Unary') {
      this.scanExprForImports(expr.operand);
    } else if (expr.kind === 'Ternary') {
      this.scanExprForImports(expr.cond);
      this.scanExprForImports(expr.then);
      this.scanExprForImports(expr.else_);
    } else if (expr.kind === 'Tuple') {
      expr.items.forEach(i => this.scanExprForImports(i));
    } else if (expr.kind === 'Index') {
      this.scanExprForImports(expr.object);
      expr.indices.forEach(i => this.scanExprForImports(i));
    } else if (expr.kind === 'IfExpr') {
      this.scanStmtForImports(expr.stmt);
    } else if (expr.kind === 'SwitchExpr') {
      this.scanStmtForImports(expr.stmt);
    } else if (expr.kind === 'ForExpr') {
      this.scanStmtForImports(expr.stmt);
    }
  }

  // ── imports ─────────────────────────────────────────────────────────────────

  private emitImports(): string {
    const primitives = [...this.usedClasses].filter(c => PRIMITIVE_IMPORTS.has(c));
    const indicators = [...this.usedClasses].filter(c => INDICATOR_IMPORTS.has(c));
    const coreImports = [...primitives, ...indicators, 'NA', 'na', 'nz', 'PineColor'].join(', ');
    const lines: string[] = [];
    lines.push(`import { ${coreImports} } from '@finchart/pine-rt';`);

    const stdlibImports: string[] = [];
    if (this.needsHistory) stdlibImports.push('BarHistory');
    if (this.needsArray)   stdlibImports.push('PineArray');
    if (this.needsMath)    stdlibImports.push('PineMath');
    if (this.needsStr)     stdlibImports.push('PineStr');
    if (this.needsDrawing) stdlibImports.push('PineBox', 'PineLine', 'PineLabel', 'createDrawings', 'setActiveDrawings');

    if (stdlibImports.length > 0) {
      lines.push(`import { ${stdlibImports.join(', ')} } from '@finchart/pine-rt';`);
    }
    if (this.needsDrawing) {
      lines.push(`import type { DrawCmd, Drawings } from '@finchart/pine-rt';`);
    }
    return lines.join('\n');
  }

  // ── hoisted instances ────────────────────────────────────────────────────────

  private collectCallSiteList(): CallSiteInfo[] {
    const seen = new Set<string>();
    const list: CallSiteInfo[] = [];
    // Walk stmts in AST order; each first-visit to a unique call-site adds it
    this.gatherCallSites(this.script.statements, seen, list);
    return list;
  }

  private gatherCallSites(stmts: Stmt[], seen: Set<string>, list: CallSiteInfo[]): void {
    for (const stmt of stmts) this.gatherFromStmt(stmt, seen, list);
  }

  private gatherFromStmt(stmt: Stmt, seen: Set<string>, list: CallSiteInfo[]): void {
    switch (stmt.kind) {
      case 'VarDecl': if (stmt.init) this.gatherFromExpr(stmt.init, seen, list); break;
      case 'Assign': this.gatherFromExpr(stmt.value, seen, list); break;
      case 'ExprStmt': this.gatherFromExpr(stmt.expr, seen, list); break;
      case 'TupleDecl': this.gatherFromExpr(stmt.init, seen, list); break;
      case 'If':
        this.gatherFromExpr(stmt.cond, seen, list);
        this.gatherCallSites(stmt.then, seen, list);
        if (stmt.else_) this.gatherCallSites(stmt.else_, seen, list);
        break;
      case 'ForTo':
        this.gatherFromExpr(stmt.from, seen, list);
        this.gatherFromExpr(stmt.to, seen, list);
        if (stmt.by) this.gatherFromExpr(stmt.by, seen, list);
        this.gatherCallSites(stmt.body, seen, list);
        break;
      case 'ForIn':
        this.gatherFromExpr(stmt.iter, seen, list);
        this.gatherCallSites(stmt.body, seen, list);
        break;
      case 'While':
        this.gatherFromExpr(stmt.cond, seen, list);
        this.gatherCallSites(stmt.body, seen, list);
        break;
      case 'Switch':
        if (stmt.subject) this.gatherFromExpr(stmt.subject, seen, list);
        for (const c of stmt.cases) {
          if (c.cond) this.gatherFromExpr(c.cond, seen, list);
          if (c.body.kind === 'block') this.gatherCallSites(c.body.stmts, seen, list);
          else this.gatherFromExpr(c.body.expr, seen, list);
        }
        break;
      case 'FnDecl':
        if (stmt.body.kind === 'block') this.gatherCallSites(stmt.body.stmts, seen, list);
        else this.gatherFromExpr(stmt.body.expr, seen, list);
        break;
      case 'Multi': stmt.stmts.forEach(s => this.gatherFromStmt(s, seen, list)); break;
    }
  }

  private gatherFromExpr(expr: Expr, seen: Set<string>, list: CallSiteInfo[]): void {
    if (expr.kind === 'Call') {
      const cs = this.sem.callSites.get(expr);
      if (cs && !seen.has(cs.id)) {
        seen.add(cs.id);
        list.push(cs);
      }
      for (const a of expr.args) this.gatherFromExpr(a.value, seen, list);
    } else if (expr.kind === 'Member') {
      this.gatherFromExpr(expr.object, seen, list);
    } else if (expr.kind === 'Binary') {
      this.gatherFromExpr(expr.left, seen, list);
      this.gatherFromExpr(expr.right, seen, list);
    } else if (expr.kind === 'Unary') {
      this.gatherFromExpr(expr.operand, seen, list);
    } else if (expr.kind === 'Ternary') {
      this.gatherFromExpr(expr.cond, seen, list);
      this.gatherFromExpr(expr.then, seen, list);
      this.gatherFromExpr(expr.else_, seen, list);
    } else if (expr.kind === 'Tuple') {
      expr.items.forEach(i => this.gatherFromExpr(i, seen, list));
    } else if (expr.kind === 'Index') {
      this.gatherFromExpr(expr.object, seen, list);
      expr.indices.forEach(i => this.gatherFromExpr(i, seen, list));
    } else if (expr.kind === 'IfExpr') {
      this.gatherFromStmt(expr.stmt, seen, list);
    } else if (expr.kind === 'SwitchExpr') {
      this.gatherFromStmt(expr.stmt, seen, list);
    } else if (expr.kind === 'ForExpr') {
      this.gatherFromStmt(expr.stmt, seen, list);
    }
  }

  private emitHoistedInstance(cs: CallSiteInfo): string {
    return `let ${cs.id}: ${cs.pineClass} | null = null;`;
  }

  private buildCtorArgs(cs: CallSiteInfo): string {
    const parts: string[] = [];
    if (cs.lenExpr) parts.push(this.exprToStr(cs.lenExpr));
    for (const e of cs.extraCtorExprs) parts.push(this.exprToStr(e));
    return parts.join(', ');
  }

  // ── statements ───────────────────────────────────────────────────────────────

  private emitStmts(stmts: Stmt[]): string[] {
    const out: string[] = [];
    const ind = this.indent();

    // Skip indicator() and library() calls — already processed in semantic
    const SKIP_FNS = new Set(['indicator', 'library', 'strategy', 'import']);

    for (const stmt of stmts) {
      // Skip top-level indicator() call
      if (stmt.kind === 'ExprStmt' && stmt.expr.kind === 'Call') {
        const fn = this.getChain(stmt.expr.callee);
        if (fn && SKIP_FNS.has(fn)) continue;
        // Also skip plot calls — they're handled via plots return value
        if (fn && fn.startsWith('plot')) {
          // Emit as plots assignment
          const plotInfo = this.sem.plots.find(p => p.line === stmt.pos.line);
          if (plotInfo) {
            out.push(`${ind}plots[${JSON.stringify(plotInfo.id)}] = ${this.exprToStr(plotInfo.srcExpr)};`);
            continue;
          }
        }
      }

      // Skip input assignments already lifted to _inputs
      if (stmt.kind === 'VarDecl' && this.sem.inputs.has(stmt.name)) continue;

      // Skip top-level consts already hoisted to module scope
      if (this.moduleConstStmts.has(stmt)) continue;

      const emitted = this.emitStmt(stmt);
      out.push(...emitted.map(l => l === '' ? '' : ind + l));
    }
    return out;
  }

  private emitStmt(stmt: Stmt): string[] {
    switch (stmt.kind) {
      case 'VarDecl': {
        if (this.sem.vars.find(v => v.name === stmt.name)) {
          // var/varip: declared and initialized at module level — skip inside onBar
          // Pine's `var` means "initialize once", so we must NOT re-assign here
          return [];
        }
        if (stmt.init) {
          return [`let ${stmt.name} = ${this.exprToStr(stmt.init)};`];
        }
        const tsType = stmt.typeRef ? this.pineTypeToTs(stmt.typeRef) : 'unknown';
        return [`let ${stmt.name}: ${tsType};`];
      }

      case 'TupleDecl': {
        const rhs = this.exprToStr(stmt.init);
        // Detect if rhs is a ta.* call that returns {macd, signal, hist} or {basis, upper, lower}
        const names = stmt.names;
        const callCs = stmt.init.kind === 'Call' ? this.sem.callSites.get(stmt.init) : null;
        if (callCs) {
          // Multi-output: destructure from object
          const fields = this.getMultiOutputFields(callCs.taFn);
          if (fields && fields.length === names.length) {
            const destructure = names.map((n, i) => `${fields[i]}: ${n}`).join(', ');
            return [`let { ${destructure} } = ${rhs} || {};`];
          }
        }
        return [`let [${names.join(', ')}] = ${rhs} || [];`];
      }

      case 'Assign': {
        const target = this.assignTarget(stmt.target);
        const value  = this.exprToStr(stmt.value);
        const op = stmt.op === ':=' ? '=' : stmt.op.replace(':=', '=');
        if (stmt.target.kind === 'Tuple') {
          return [`${target} ${op} ${value} || [];`];
        }
        return [`${target} ${op} ${value};`];
      }

      case 'ExprStmt':
        return [`${this.exprToStr(stmt.expr)};`];

      case 'If': {
        const lines: string[] = [];
        lines.push(`if (${this.exprToStr(stmt.cond)}) {`);
        this.indentLevel++;
        const thenLines = this.emitStmts(stmt.then);
        this.indentLevel--;
        lines.push(...thenLines.map(l => '  ' + l));
        if (stmt.else_ && stmt.else_.length > 0) {
          lines.push('} else {');
          this.indentLevel++;
          const elseLines = this.emitStmts(stmt.else_);
          this.indentLevel--;
          lines.push(...elseLines.map(l => '  ' + l));
        }
        lines.push('}');
        return lines;
      }

      case 'ForTo': {
        const from = this.exprToStr(stmt.from);
        const to   = this.exprToStr(stmt.to);
        const by   = stmt.by ? this.exprToStr(stmt.by) : '1';
        const v    = stmt.varName;
        const lines: string[] = [];
        lines.push(`for (let ${v} = ${from}; ${v} <= ${to}; ${v} += ${by}) {`);
        this.indentLevel++;
        const bodyLines = this.emitStmts(stmt.body);
        this.indentLevel--;
        lines.push(...bodyLines.map(l => '  ' + l));
        lines.push('}');
        return lines;
      }

      case 'ForIn': {
        const iter  = this.exprToStr(stmt.iter);
        const names = stmt.names.join(', ');
        const lines: string[] = [];
        lines.push(`for (let [${names}] of Object.entries(${iter})) {`);
        this.indentLevel++;
        const bodyLines = this.emitStmts(stmt.body);
        this.indentLevel--;
        lines.push(...bodyLines.map(l => '  ' + l));
        lines.push('}');
        return lines;
      }

      case 'While': {
        const lines: string[] = [];
        lines.push(`while (${this.exprToStr(stmt.cond)}) {`);
        this.indentLevel++;
        const bodyLines = this.emitStmts(stmt.body);
        this.indentLevel--;
        lines.push(...bodyLines.map(l => '  ' + l));
        lines.push('}');
        return lines;
      }

      case 'Switch': {
        const subject = stmt.subject ? this.exprToStr(stmt.subject) : 'true';
        const lines: string[] = [];
        if (!stmt.subject) {
          // Pine switch without subject = if/else chain
          let first = true;
          for (const c of stmt.cases) {
            if (c.cond === null) {
              lines.push('} else {');
            } else if (first) {
              lines.push(`if (${this.exprToStr(c.cond)}) {`);
              first = false;
            } else {
              lines.push(`} else if (${this.exprToStr(c.cond)}) {`);
            }
            this.indentLevel++;
            const bl = c.body.kind === 'block'
              ? this.emitStmts(c.body.stmts)
              : [`${this.exprToStr(c.body.expr)};`];
            this.indentLevel--;
            lines.push(...bl.map(l => '  ' + l));
          }
          lines.push('}');
        } else {
          lines.push(`switch (${subject}) {`);
          for (const c of stmt.cases) {
            if (c.cond === null) {
              lines.push('  default: {');
            } else {
              lines.push(`  case ${this.exprToStr(c.cond)}: {`);
            }
            this.indentLevel++;
            const bl = c.body.kind === 'block'
              ? this.emitStmts(c.body.stmts)
              : [`return ${this.exprToStr(c.body.expr)};`];
            this.indentLevel--;
            lines.push(...bl.map(l => '    ' + l));
            lines.push('    break;');
            lines.push('  }');
          }
          lines.push('}');
        }
        return lines;
      }

      case 'FnDecl': {
        const params = stmt.params.map(p => {
          const t = p.typeRef ? `: ${this.pineTypeToTs(p.typeRef)}` : '';
          const def = p.default_ ? ` = ${this.exprToStr(p.default_)}` : '';
          return `${p.name}${t}${def}`;
        }).join(', ');
        const lines: string[] = [];
        lines.push(`function ${stmt.name}(${params}) {`);
        this.indentLevel++;
        let bodyLines: string[];
        if (stmt.body.kind === 'block') {
          bodyLines = this.emitStmts(stmt.body.stmts);
          // Pine functions implicitly return the last expression.
          // Find the last non-empty line and add 'return' if it's an expression statement
          for (let i = bodyLines.length - 1; i >= 0; i--) {
            const trimmed = bodyLines[i]!.trim();
            if (trimmed === '' || trimmed.startsWith('//')) continue;
            // If the last statement is a bare expression (not assignment, if, for, etc.)
            // and doesn't already have 'return', prepend it
            if (!trimmed.startsWith('return ') && !trimmed.startsWith('if ') &&
                !trimmed.startsWith('for ') && !trimmed.startsWith('while ') &&
                !trimmed.startsWith('switch ') && !trimmed.startsWith('}') &&
                !trimmed.startsWith('const ') && !trimmed.startsWith('let ') &&
                !trimmed.startsWith('var ') && !trimmed.startsWith('break') &&
                !trimmed.startsWith('continue')) {
              // Turn "  expr;" into "  return expr;"
              bodyLines[i] = bodyLines[i]!.replace(/^(\s*)(.+)$/, '$1return $2');
            }
            break;
          }
        } else {
          bodyLines = [`return ${this.exprToStr(stmt.body.expr)};`];
        }
        this.indentLevel--;
        lines.push(...bodyLines.map(l => '  ' + l));
        lines.push('}');
        return lines;
      }

      case 'Multi':
        return stmt.stmts.flatMap(s => this.emitStmt(s));

      case 'Break':    return ['break;'];
      case 'Continue': return ['continue;'];
      case 'TypeDecl': return [`/* type ${stmt.name} — UDT not supported in v1 */`];
      case 'Import':   return [`/* import ${stmt.raw} — library import skipped */`];

      default: return [`/* unhandled statement kind */`];
    }
  }

  private assignTarget(expr: Expr): string {
    if (expr.kind === 'Ident') {
      const isVar = this.sem.vars.some(v => v.name === expr.name);
      return isVar ? `_var_${expr.name}` : expr.name;
    }
    return this.exprToStr(expr);
  }

  // ── expressions ──────────────────────────────────────────────────────────────

  exprToStr(expr: Expr): string {
    switch (expr.kind) {
      case 'Num': {
        if (!isFinite(expr.value)) return 'Infinity';
        // Avoid scientific notation for normal integers
        return String(expr.value);
      }
      case 'Str':   return JSON.stringify(expr.value);
      case 'Color': return JSON.stringify(expr.value);

      case 'Ident': {
        const n = expr.name;
        if (n === 'na' || n === 'NaN')  return 'NaN';
        if (n === 'true')               return 'true';
        if (n === 'false')              return 'false';
        if (n === 'bar_index')          return 'barIndex';
        if (n === 'last_bar_index')     return 'barIndex'; // approx
        if (n === 'timenow')            return 'Date.now()';
        if (n === 'timeframe')          return '"D"';
        // Built-in series
        if (n in BUILTIN_SERIES_EXPR) return BUILTIN_SERIES_EXPR[n]!;
        // var / varip → prefixed
        if (this.sem.vars.some(v => v.name === n)) return `_var_${n}`;
        // input → prefixed (always via _inputs so it works both at module and function scope)
        if (this.sem.inputs.has(n)) return `_inputs.${this.sem.inputs.get(n)!.pineId}`;
        return n;
      }

      case 'Member': {
        const chain = this.getChain(expr);
        if (!chain) return `${this.exprToStr(expr.object)}.${expr.property}`;

        // Color constants
        if (chain in PINE_COLORS) return PINE_COLORS[chain]!;

        // barstate.*
        if (chain === 'barstate.islast')   return 'isLast';
        if (chain === 'barstate.isfirst')  return '(barIndex === 0)';
        if (chain === 'barstate.isrealtime') return 'false';
        if (chain === 'barstate.isconfirmed') return 'true';
        if (chain === 'barstate.isnew') return 'true';

        // timeframe.*
        if (chain.startsWith('timeframe.')) {
          const prop = chain.split('.')[1];
          if (prop === 'period') return '"D"';
          if (prop === 'multiplier') return '1';
          if (prop === 'isintraday') return 'false';
          if (prop === 'isdaily') return 'true';
          if (prop === 'isweekly') return 'false';
          if (prop === 'ismonthly') return 'false';
          if (prop === 'isseconds') return 'false';
          if (prop === 'isminutes') return 'false';
          return 'null /* unknown timeframe prop */';
        }

        // syminfo.*
        if (chain.startsWith('syminfo.')) {
          const prop = chain.split('.')[1];
          if (prop === 'tickerid') return '"EXCHANGE:TICKER"';
          if (prop === 'ticker') return '"TICKER"';
          if (prop === 'currency') return '"USD"';
          if (prop === 'basecurrency') return '"BTC"';
          if (prop === 'mintick') return '0.01';
          if (prop === 'pointvalue') return '1';
          return 'null /* unknown syminfo prop */';
        }

        // chart.* — theme colors (stubbed; real values come from chart theme)
        if (chain.startsWith('chart.')) {
          const prop = chain.split('.')[1];
          if (prop === 'bg_color') return "'#FFFFFF'";
          if (prop === 'fg_color') return "'#131722'";
          return 'null /* unknown chart prop */';
        }

        // math constants
        if (chain === 'math.pi')   return 'Math.PI';
        if (chain === 'math.e')    return 'Math.E';
        if (chain === 'math.phi')  return '1.6180339887498949';
        if (chain === 'math.rphi') return '0.6180339887498949';

        // *.style_solid / *.style_dashed / *.style_label_left … (enum-as-property)
        if (expr.property.startsWith('style_')) return JSON.stringify(expr.property);
        // xloc.* / yloc.* — drawing coordinate spaces (bar_index, bar_time, price, abovebar…)
        if (chain.startsWith('xloc.') || chain.startsWith('yloc.')) return JSON.stringify(chain.split('.')[1]);
        // extend.*
        if (chain.startsWith('extend.')) return JSON.stringify(chain.split('.')[1]);
        // line.style.*
        if (chain.startsWith('line.style.')) return JSON.stringify(chain);
        // label.style.*
        if (chain.startsWith('label.style.')) return JSON.stringify(chain);
        // hline.style.*
        if (chain.startsWith('hline.style.')) return JSON.stringify(chain);
        // size.*
        if (chain.startsWith('size.')) return JSON.stringify(chain.split('.')[1]);
        // position.* / text.* / font.* / display.* / scale.* / barmerge.* / alert.* / dayofweek.*
        if (/^(?:position|text|font|display|scale|barmerge|alert|dayofweek|adjustment)\./.test(chain))
          return JSON.stringify(chain.split('.')[1]);
        // input.*  (e.g. input.integer — legacy)
        if (chain.startsWith('input.')) return JSON.stringify(chain);
        // ta.* constants
        if (chain.startsWith('ta.')) return chain;
        // location.*
        if (chain.startsWith('location.')) return JSON.stringify(chain.split('.')[1]);
        // shape.*
        if (chain.startsWith('shape.')) return JSON.stringify(chain.split('.')[1]);
        // format.*
        if (chain.startsWith('format.')) return JSON.stringify(chain.split('.')[1]);
        // currency.*
        if (chain.startsWith('currency.')) return JSON.stringify(chain.split('.')[1]);
        // order.*
        if (chain.startsWith('order.')) return JSON.stringify(chain.split('.')[1]);
        // strategy.*
        if (chain.startsWith('strategy.')) return `/* strategy.${expr.property} */`;

        return `${this.exprToStr(expr.object)}.${expr.property}`;
      }

      case 'Call': {
        const cs = this.sem.callSites.get(expr);
        if (cs) {
          // ta.* call → use hoisted instance
          return this.emitTaCall(cs, expr);
        }

        const fn = this.getChain(expr.callee);
        if (fn) return this.emitKnownCall(fn, expr);

        // method call: obj.method(args...)
        if (expr.callee.kind === 'Member') {
          const obj  = this.exprToStr(expr.callee.object);
          const meth = expr.callee.property;
          const args = expr.args.map(a => this.exprToStr(a.value)).join(', ');
          return `${obj}.${meth}(${args})`;
        }

        const calleeStr = this.exprToStr(expr.callee);
        const argsStr   = expr.args.map(a => this.exprToStr(a.value)).join(', ');
        return `${calleeStr}(${argsStr})`;
      }

      case 'Index': {
        const obj = expr.object;
        const idx = expr.indices[0];
        if (idx === undefined) return this.exprToStr(obj);

        // Built-in series history: close[1] → _hist.close(1) or hist.close(1)
        if (obj.kind === 'Ident' && BUILTIN_SERIES.has(obj.name)) {
          const histFn = obj.name === 'hl2'   ? `(_hist.high(${this.exprToStr(idx)}) + _hist.low(${this.exprToStr(idx)})) / 2`
                       : obj.name === 'hlc3'  ? `(_hist.high(${this.exprToStr(idx)}) + _hist.low(${this.exprToStr(idx)}) + _hist.close(${this.exprToStr(idx)})) / 3`
                       : obj.name === 'ohlc4' ? `(_hist.open(${this.exprToStr(idx)}) + _hist.high(${this.exprToStr(idx)}) + _hist.low(${this.exprToStr(idx)}) + _hist.close(${this.exprToStr(idx)})) / 4`
                       : `_hist.${obj.name}(${this.exprToStr(idx)})`;
          return histFn;
        }
        // Array index
        if (idx.kind === 'Num' && expr.indices.length === 1) {
          return `${this.exprToStr(obj)}[${this.exprToStr(idx)}]`;
        }
        const idxStr = expr.indices.map(i => this.exprToStr(i)).join('][');
        return `${this.exprToStr(obj)}[${idxStr}]`;
      }

      case 'Unary': {
        const op = expr.op === 'not' ? '!' : expr.op;
        const needParen = expr.operand.kind === 'Binary' || expr.operand.kind === 'Ternary';
        const inner = this.exprToStr(expr.operand);
        return needParen ? `${op}(${inner})` : `${op}${inner}`;
      }

      case 'Binary': {
        const op = this.mapBinaryOp(expr.op);
        const lNeedParen = this.needsParens(expr.left, expr.op, 'left');
        const rNeedParen = this.needsParens(expr.right, expr.op, 'right');
        const l = lNeedParen ? `(${this.exprToStr(expr.left)})` : this.exprToStr(expr.left);
        const r = rNeedParen ? `(${this.exprToStr(expr.right)})` : this.exprToStr(expr.right);
        return `${l} ${op} ${r}`;
      }

      case 'Ternary': {
        const c = this.exprToStr(expr.cond);
        const t = this.exprToStr(expr.then);
        const e = this.exprToStr(expr.else_);
        return `(${c} ? ${t} : ${e})`;
      }

      case 'Tuple':
        return `[${expr.items.map(i => this.exprToStr(i)).join(', ')}]`;

      case 'IfExpr': {
        // Emit as IIFE (immediately invoked function expression)
        const s = expr.stmt;
        const t = s.then.length === 1 ? this.exprToStr(this.stmtToExpr(s.then[0])) : '/* TODO */';
        if (!s.else_ || s.else_.length === 0) return `(${this.exprToStr(s.cond)} ? ${t} : NaN)`;
        const e = s.else_.length === 1 ? this.exprToStr(this.stmtToExpr(s.else_[0])) : '/* TODO */';
        return `(${this.exprToStr(s.cond)} ? ${t} : ${e})`;
      }

      case 'SwitchExpr': {
        // emit as nested ternary chain
        const s = expr.stmt;
        const cases = s.cases;
        const buildChain = (i: number): string => {
          if (i >= cases.length) return 'NaN';
          const c = cases[i]!;
          if (c.cond === null) {
            // default
            return c.body.kind === 'expr'
              ? this.exprToStr(c.body.expr)
              : '/* TODO */';
          }
          const condition = s.subject
            ? `${this.exprToStr(s.subject)} === ${this.exprToStr(c.cond)}`
            : this.exprToStr(c.cond);
          const val = c.body.kind === 'expr' ? this.exprToStr(c.body.expr) : '/* TODO */';
          return `(${condition} ? ${val} : ${buildChain(i + 1)})`;
        };
        return buildChain(0);
      }

      case 'ForExpr':
        return '/* for expression — not supported as inline expr */';

      default:
        return '/* unknown expr */';
    }
  }

  private stmtToExpr(stmt: Stmt): Expr {
    if (stmt.kind === 'ExprStmt') return stmt.expr;
    if (stmt.kind === 'VarDecl' && stmt.init) return stmt.init;
    // Fallback
    return { kind: 'Ident', name: '/* TODO */', pos: stmt.pos };
  }

  private emitTaCall(cs: CallSiteInfo, expr: { args: { name: string | null; value: Expr }[] }): string {
    const meta = cs.meta;
    const ctorArgs = this.buildCtorArgs(cs);
    const instance = `(${cs.id} ??= new ${cs.pineClass}(${ctorArgs}))`;

    if (meta.sig === 'hlc') {
      // Atr, Stochastic
      return `${instance}[_commit ? "next" : "peek"](bar.high, bar.low, bar.close)`;
    }

    // 'src' signature
    let srcStr: string;
    if (cs.singleArgForm) {
      // ta.highest(len) — source is default built-in
      srcStr = meta.defaultSrc ? `bar.${meta.defaultSrc}` : 'bar.close';
    } else if (cs.srcExpr) {
      srcStr = this.exprToStr(cs.srcExpr);
    } else {
      srcStr = meta.defaultSrc ? `bar.${meta.defaultSrc}` : 'bar.close';
    }

    // Special cases
    if (cs.taFn === 'ta.macd') {
      return `${instance}[_commit ? "next" : "peek"](${srcStr})`;  // returns {macd, signal, hist}
    }
    if (cs.taFn === 'ta.bb' || cs.taFn === 'ta.bbw') {
      return `${instance}[_commit ? "next" : "peek"](${srcStr})`; // returns {basis, upper, lower}
    }
    if (cs.taFn === 'ta.stoch') {
      return `${instance}[_commit ? "next" : "peek"](bar.high, bar.low, bar.close)`;
    }
    if (cs.taFn === 'ta.variance') {
      return `Math.pow(${instance}[_commit ? "next" : "peek"](${srcStr}), 2)`;
    }

    return `${instance}[_commit ? "next" : "peek"](${srcStr})`;
  }

  private emitKnownCall(fn: string, expr: { args: { name: string | null; value: Expr }[]; typeArgs?: string }): string {
    const positional = expr.args.filter(a => a.name === null).map(a => this.exprToStr(a.value));
    const allArgs    = expr.args.map(a => this.exprToStr(a.value));

    // input.* → use _inputs value (already resolved)
    if (fn.startsWith('input')) {
      // These are already in _inputs; return the defval expression as a fallback
      const defval = positional[0] ?? 'undefined';
      return defval;
    }

    // nz, na
    if (fn === 'nz') return `nz(${allArgs.join(', ')})`;
    if (fn === 'na')  return `na(${allArgs[0]})`;
    if (fn === 'fixnan') return `(isNaN(${allArgs[0]}) ? 0 : ${allArgs[0]})`;

    // Type casting
    if (fn === 'int') return `Math.trunc(${allArgs[0] ?? 'NaN'})`;
    if (fn === 'float') return `Number(${allArgs[0] ?? 'NaN'})`;
    if (fn === 'bool') return `Boolean(${allArgs[0]})`;
    if (fn === 'string') return `String(${allArgs[0]})`;
    if (fn === 'color' || fn === 'box' || fn === 'line' || fn === 'label' || fn === 'table' || fn === 'array' || fn === 'linefill') return allArgs[0] ?? 'null';

    // math.*
    if (fn in MATH_MAP) return `${MATH_MAP[fn]}(${allArgs.join(', ')})`;

    // str.*
    if (fn in STR_MAP) return `${STR_MAP[fn]}(${allArgs.join(', ')})`;

    // array.new_*
    if (fn in ARRAY_MAP) return `${ARRAY_MAP[fn]}(${allArgs.join(', ')})`;

    // array.<method>(arr, ...)  →  arr.<method>(...)
    if (fn in ARRAY_METHODS && allArgs.length >= 1) {
      const [arr, ...rest] = allArgs;
      const method = ARRAY_METHODS[fn]!;
      return `${arr}.${method}(${rest.join(', ')})`;
    }

    // box.new / line.new / label.new
    if (fn === 'box.new') {
      const namedOpts: Record<string, string> = {};
      for (const a of expr.args) {
        if (a.name) namedOpts[a.name] = this.exprToStr(a.value);
      }
      const optStr = Object.keys(namedOpts).length
        ? `, { ${Object.entries(namedOpts).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
        : '';
      return `PineBox.new(${positional.slice(0, 4).join(', ')}${optStr})`;
    }
    if (fn === 'line.new') {
      const namedOpts: Record<string, string> = {};
      for (const a of expr.args) {
        if (a.name) namedOpts[a.name] = this.exprToStr(a.value);
      }
      const optStr = Object.keys(namedOpts).length
        ? `, { ${Object.entries(namedOpts).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
        : '';
      return `PineLine.new(${positional.slice(0, 4).join(', ')}${optStr})`;
    }
    if (fn === 'label.new') {
      const namedOpts: Record<string, string> = {};
      for (const a of expr.args) {
        if (a.name) namedOpts[a.name] = this.exprToStr(a.value);
      }
      const optStr = Object.keys(namedOpts).length
        ? `, { ${Object.entries(namedOpts).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
        : '';
      return `PineLabel.new(${positional.slice(0, 2).join(', ')}${optStr})`;
    }

    // box.delete / line.delete / label.delete
    if (fn === 'box.delete') return `PineBox.delete(${allArgs[0]})`;
    if (fn === 'line.delete') return `PineLine.delete(${allArgs[0]})`;
    if (fn === 'label.delete') return `PineLabel.delete(${allArgs[0]})`;

    // box.set_* / line.set_* / label.set_*
    if (fn in BOX_METHODS)   return `PineBox.${BOX_METHODS[fn]}(${allArgs.join(', ')})`;
    if (fn in LINE_METHODS)  return `PineLine.${LINE_METHODS[fn]}(${allArgs.join(', ')})`;
    if (fn in LABEL_METHODS) return `PineLabel.${LABEL_METHODS[fn]}(${allArgs.join(', ')})`;

    // color.*
    if (fn === 'color.new')           return `PineColor.new(${allArgs.join(', ')})`;
    if (fn === 'color.rgb')           return `PineColor.rgb(${allArgs.join(', ')})`;
    if (fn === 'color.from_gradient') return `PineColor.from_gradient(${allArgs.join(', ')})`;
    if (fn === 'color.r')             return `parseInt(${allArgs[0]}.slice(1,3), 16)`;
    if (fn === 'color.g')             return `parseInt(${allArgs[0]}.slice(3,5), 16)`;
    if (fn === 'color.b')             return `parseInt(${allArgs[0]}.slice(5,7), 16)`;
    if (fn === 'color.t')             return `(1 - parseInt(${allArgs[0]}.slice(7,9)||'ff', 16)/255) * 100`;

    // plot calls — return the value
    const PLOT_FNS = new Set(['plot', 'plotshape', 'plotchar', 'plotcandle', 'plotarrow', 'hline', 'fill', 'bgcolor', 'barcolor']);
    if (PLOT_FNS.has(fn)) return allArgs[0] ?? 'NaN';

    // request.* (MTF — stub)
    if (fn.startsWith('request.')) return `/* ${fn} — MTF not supported in v1 */ NaN`;

    // strategy.* (stub)
    if (fn.startsWith('strategy.')) return `null /* ${fn} — strategy not supported */`;

    // table.*
    if (fn.startsWith('table.')) return `null /* ${fn} — table rendering not supported */`;

    // alert / alertcondition
    if (fn === 'alert' || fn === 'alertcondition') return `null /* ${fn} stub */`;

    // time / time_close
    if (fn === 'time' || fn === 'time_close') return `/* MTF time not fully supported */ time`;

    // array.*
    if (fn.startsWith('array.')) {
      const method = fn.slice(6);
      if (method.startsWith('new_') || method === 'new' || method === 'from') {
        let mapped = method;
        if (method === 'new_float') mapped = 'newFloat';
        else if (method === 'new_int') mapped = 'newInt';
        else if (method === 'new_bool') mapped = 'newBool';
        else if (method === 'new_string') mapped = 'newString';
        else if (method.startsWith('new_')) mapped = 'new';
        return `PineArray.${mapped}(${allArgs.join(', ')})`;
      }
      if (allArgs.length > 0) {
        const arr = allArgs[0];
        const restArgs = allArgs.slice(1).join(', ');
        return `${arr}.${method}(${restArgs})`;
      }
    }

    // timeframe.* functions
    if (fn === 'timeframe.change') return 'false /* MTF timeframe.change stub */';
    if (fn === 'timeframe.in_seconds') return '86400 /* MTF timeframe.in_seconds stub */';

    // linefill / polyline / log — unsupported drawing/util namespaces: safe no-op value
    if (fn.startsWith('linefill.')) return `null /* ${fn} — linefill not supported */`;
    if (fn.startsWith('polyline.')) return `null /* ${fn} — polyline not supported */`;
    if (fn.startsWith('log.'))      return `undefined /* ${fn} stub */`;

    // Generic pass-through for user-defined functions (bare name, no namespace).
    // A dotted call we didn't recognize would reference an undefined namespace at
    // runtime — stub it to a safe value instead of crashing onBar.
    const typeArgs = (expr as any).typeArgs ? `<${(expr as any).typeArgs}>` : '';
    if (fn.includes('.')) {
      const ns = fn.split('.')[0];
      const KNOWN_LOCAL = this.sem.vars.some(v => v.name === ns) || this.sem.inputs.has(ns);
      if (!KNOWN_LOCAL) return `undefined /* ${fn}() — unsupported builtin */`;
    }
    return `${fn}${typeArgs}(${allArgs.join(', ')})`;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private getChain(expr: Expr): string | null {
    if (expr.kind === 'Ident') return expr.name;
    if (expr.kind === 'Member') {
      const base = this.getChain(expr.object);
      return base ? `${base}.${expr.property}` : null;
    }
    return null;
  }

  private indent(): string {
    return '  '.repeat(this.indentLevel);
  }

  private mapBinaryOp(op: string): string {
    switch (op) {
      case 'and': return '&&';
      case 'or':  return '||';
      case 'not': return '!';
      default:    return op;
    }
  }

  private needsParens(expr: Expr, parentOp: string, side: 'left' | 'right'): boolean {
    if (expr.kind !== 'Binary') return false;
    const prec = (op: string): number => {
      if (op === 'or' || op === '||') return 1;
      if (op === 'and' || op === '&&') return 2;
      if (op === '==' || op === '!=' || op === '>' || op === '<' || op === '>=' || op === '<=') return 3;
      if (op === '+' || op === '-') return 4;
      if (op === '*' || op === '/' || op === '%') return 5;
      return 0;
    };
    return prec(expr.op) < prec(parentOp);
  }

  /** Emit one rich meta.plots entry (id, fn, title, color, lineWidth, style). */
  private emitPlotMeta(p: import('./semantic').PlotInfo): string {
    const parts: string[] = [];
    parts.push(`id: ${JSON.stringify(p.id)}`);
    parts.push(`fn: ${JSON.stringify(p.fn)}`);
    // meta is module-scope and static — only emit CONSTANT color/width. A dynamic
    // per-bar color (e.g. `r > 50 ? up : down`) references runtime vars and would
    // throw at module load; per-bar coloring is a runtime concern (later phase).
    parts.push(`title: ${p.titleExpr && isConstExpr(p.titleExpr, NO_KNOWN) ? this.exprToStr(p.titleExpr) : JSON.stringify(p.id)}`);
    if (p.color && isConstExpr(p.color, NO_KNOWN))                 parts.push(`color: ${this.exprToStr(p.color)}`);
    if (p.linewidthExpr && isConstExpr(p.linewidthExpr, NO_KNOWN)) parts.push(`lineWidth: ${this.exprToStr(p.linewidthExpr)}`);
    const style = this.plotStyle(p);
    if (style)                                                     parts.push(`style: ${JSON.stringify(style)}`);
    return `{ ${parts.join(', ')} }`;
  }

  /** Normalize a plot's render style → "line" | "histogram" | "area" | "columns". */
  private plotStyle(p: import('./semantic').PlotInfo): string | null {
    if (p.fn === 'plotcandle' || p.fn === 'plotbar') return null; // own series type
    if (p.styleExpr) {
      const raw = this.exprToStr(p.styleExpr).replace(/['"]/g, '').toLowerCase();
      if (raw.includes('histogram')) return 'histogram';
      if (raw.includes('column'))    return 'columns';
      if (raw.includes('area'))      return 'area';
      if (raw.includes('line'))      return 'line';
    }
    return p.fn === 'plot' ? 'line' : null;
  }

  /** Emit one rich meta.inputs entry matching candlekit's InputConfig shape. */
  private emitInputMeta(info: InputInfo): string {
    const parts: string[] = [];
    parts.push(`id: ${JSON.stringify(info.pineId)}`);
    parts.push(`fn: ${JSON.stringify(info.fn)}`);
    parts.push(`type: ${JSON.stringify(this.inputType(info))}`);
    parts.push(`defval: ${this.inputDefvalStr(info)}`);
    parts.push(`title: ${info.titleExpr ? this.exprToStr(info.titleExpr) : 'null'}`);
    if (info.minExpr)     parts.push(`minval: ${this.exprToStr(info.minExpr)}`);
    if (info.maxExpr)     parts.push(`maxval: ${this.exprToStr(info.maxExpr)}`);
    if (info.stepExpr)    parts.push(`step: ${this.exprToStr(info.stepExpr)}`);
    if (info.optionsExpr) parts.push(`options: ${this.exprToStr(info.optionsExpr)}`);
    if (info.groupExpr)   parts.push(`group: ${this.exprToStr(info.groupExpr)}`);
    if (info.tooltipExpr) parts.push(`tooltip: ${this.exprToStr(info.tooltipExpr)}`);
    if (info.inlineExpr)  parts.push(`inline: ${this.exprToStr(info.inlineExpr)}`);
    return `{ ${parts.join(', ')} }`;
  }

  /**
   * Default value string for an input. A `source` input defaults to a series
   * NAME ("close") resolved per-bar by the host — emitting `bar.close` here
   * would reference the onBar param at module scope (ReferenceError).
   */
  private inputDefvalStr(info: InputInfo): string {
    const d = info.defvalExpr;
    if (!d) return 'null';
    if (this.inputType(info) === 'source' && d.kind === 'Ident' && BUILTIN_SERIES.has(d.name)) {
      return JSON.stringify(d.name);
    }
    return this.exprToStr(d);
  }

  /** Resolve the InputConfig "type" used by the settings UI. */
  private inputType(info: InputInfo): string {
    switch (info.fn) {
      case 'input.int':       return 'int';
      case 'input.float':     return 'float';
      case 'input.bool':      return 'bool';
      case 'input.string':    return 'string';
      case 'input.color':     return 'color';
      case 'input.source':    return 'source';
      case 'input.timeframe': return 'string';
    }
    // generic input(...) — infer from the default value
    const d = info.defvalExpr;
    if (d) {
      if (d.kind === 'Ident' && (d.name === 'true' || d.name === 'false')) return 'bool';
      if (d.kind === 'Ident' && BUILTIN_SERIES.has(d.name)) return 'source';
      if (d.kind === 'Num')   return Number.isInteger(d.value) ? 'int' : 'float';
      if (d.kind === 'Str')   return 'string';
      if (d.kind === 'Color') return 'color';
    }
    return 'string';
  }

  private pineTypeToTs(typeRef: string): string {
    switch (typeRef.toLowerCase()) {
      case 'int':    return 'number';
      case 'float':  return 'number';
      case 'bool':   return 'boolean';
      case 'string': return 'string';
      case 'color':  return 'string';
      case 'line':   return 'DrawLine | null';
      case 'label':  return 'DrawLabel | null';
      case 'box':    return 'DrawBox | null';
      default: {
        // array<float> etc.
        const m = typeRef.match(/^array<(.+)>$/i);
        if (m) return `PineArray<${this.pineTypeToTs(m[1]!)}>`;
        return 'unknown';
      }
    }
  }

  private getMultiOutputFields(taFn: string): string[] | null {
    switch (taFn) {
      case 'ta.macd':  return ['macd', 'signal', 'hist'];
      case 'ta.bb':    return ['upper', 'basis', 'lower'];
      case 'ta.bbw':   return ['upper', 'basis', 'lower'];
      case 'ta.stoch': return ['k', 'd'];
      default: return null;
    }
  }
}
