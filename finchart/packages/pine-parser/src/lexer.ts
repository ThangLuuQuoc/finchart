/**
 * Pine Script lexer — hai tầng:
 *
 * 1. Tầng dòng (ở đây): Pine là ngôn ngữ nhạy newline + indentation (block
 *    thụt 4 space / 1 tab; dòng nối tiếp của một statement phải thụt KHÔNG
 *    chia hết cho 4 — luật chính thức của TradingView). Tầng này ghép
 *    "logical line", strip comment (string-aware), tính indent level và
 *    sinh token ảo NEWLINE / INDENT / DEDENT.
 *
 * 2. Tầng token: chevrotain Lexer chạy trên nội dung từng logical line.
 *
 * Lưu ý chủ đích: các tên kiểu (int/float/bool/color/line/label/box/...) KHÔNG
 * phải keyword — `line` vừa là kiểu vừa là namespace (`line.new`), parser xử
 * lý theo ngữ cảnh.
 */

import { createToken, Lexer, type IToken, type TokenType } from "chevrotain";

// ── token definitions ──────────────────────────────────────────────────────

const kw = (name: string, pattern: RegExp) =>
  createToken({ name, pattern, longer_alt: Identifier });

export const Identifier = createToken({ name: "Identifier", pattern: /[a-zA-Z_][a-zA-Z0-9_]*/ });

export const If = kw("If", /if/);
export const Else = kw("Else", /else/);
export const For = kw("For", /for/);
export const While = kw("While", /while/);
export const Switch = kw("Switch", /switch/);
export const Var = kw("Var", /varip|var/);
export const Import = kw("Import", /import/);
export const Export = kw("Export", /export/);
export const And = kw("And", /and/);
export const Or = kw("Or", /or/);
export const Not = kw("Not", /not/);
export const Break = kw("Break", /break/);
export const Continue = kw("Continue", /continue/);
// LƯU Ý: `type`, `method`, `in`, `to`, `by` KHÔNG phải keyword ở đây — Pine v4
// dùng chúng làm tên đối số/biến (vd `input(..., type=...)` rất phổ biến).
// Parser nhận diện theo ngữ cảnh qua image của Identifier.

export const NumberLit = createToken({
  name: "NumberLit",
  pattern: /(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/,
});
export const StringLit = createToken({
  name: "StringLit",
  pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
});
export const ColorLit = createToken({ name: "ColorLit", pattern: /#[0-9a-fA-F]{6,8}/ });

export const FatArrow = createToken({ name: "FatArrow", pattern: /=>/ });
export const Walrus = createToken({ name: "Walrus", pattern: /:=/ });
export const PlusEq = createToken({ name: "PlusEq", pattern: /\+=/ });
export const MinusEq = createToken({ name: "MinusEq", pattern: /-=/ });
export const StarEq = createToken({ name: "StarEq", pattern: /\*=/ });
export const SlashEq = createToken({ name: "SlashEq", pattern: /\/=/ });
export const PercentEq = createToken({ name: "PercentEq", pattern: /%=/ });
export const EqEq = createToken({ name: "EqEq", pattern: /==/ });
export const NotEq = createToken({ name: "NotEq", pattern: /!=/ });
export const LtEq = createToken({ name: "LtEq", pattern: /<=/ });
export const GtEq = createToken({ name: "GtEq", pattern: />=/ });
export const Eq = createToken({ name: "Eq", pattern: /=/ });
export const Lt = createToken({ name: "Lt", pattern: /</ });
export const Gt = createToken({ name: "Gt", pattern: />/ });
export const Plus = createToken({ name: "Plus", pattern: /\+/ });
export const Minus = createToken({ name: "Minus", pattern: /-/ });
export const Star = createToken({ name: "Star", pattern: /\*/ });
export const Slash = createToken({ name: "Slash", pattern: /\// });
export const Percent = createToken({ name: "Percent", pattern: /%/ });
export const Question = createToken({ name: "Question", pattern: /\?/ });
export const Colon = createToken({ name: "Colon", pattern: /:/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
export const Dot = createToken({ name: "Dot", pattern: /\./ });
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
export const RBracket = createToken({ name: "RBracket", pattern: /\]/ });

export const Newline = createToken({ name: "Newline", pattern: Lexer.NA });
export const Indent = createToken({ name: "Indent", pattern: Lexer.NA });
export const Dedent = createToken({ name: "Dedent", pattern: Lexer.NA });

const WS = createToken({ name: "WS", pattern: /[ \t]+/, group: Lexer.SKIPPED });

export const allTokens: TokenType[] = [
  WS,
  // multi-char trước single-char
  FatArrow, Walrus, PlusEq, MinusEq, StarEq, SlashEq, PercentEq,
  EqEq, NotEq, LtEq, GtEq,
  // keywords trước Identifier (có longer_alt)
  If, Else, For, While, Switch, Var, Import, Export,
  And, Or, Not, Break, Continue,
  Identifier, NumberLit, StringLit, ColorLit,
  Eq, Lt, Gt, Plus, Minus, Star, Slash, Percent, Question, Colon, Comma, Dot,
  LParen, RParen, LBracket, RBracket,
  Newline, Indent, Dedent,
];

const lineLexer = new Lexer(allTokens, { ensureOptimizations: false });

// ── tầng dòng ───────────────────────────────────────────────────────────────

export interface LexError {
  line: number;
  message: string;
}

interface LogicalLine {
  text: string;
  startLine: number; // 1-based dòng vật lý đầu
  level: number;
}

/**
 * Quét một dòng vật lý với state string mang từ dòng trước (TradingView cho
 * phép string literal wrap qua nhiều dòng tiếp diễn): strip comment (chỉ khi
 * ngoài string), giữ nguyên nội dung string, đồng thời tính delta ngoặc.
 */
function scanLine(line: string, inStr0: string | null): { text: string; inStr: string | null; delta: number } {
  let out = "";
  let inStr = inStr0;
  let delta = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        if (i + 1 < line.length) out += line[++i];
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      out += c;
      continue;
    }
    if (c === "/" && line[i + 1] === "/") break;
    if (c === "(" || c === "[") delta++;
    else if (c === ")" || c === "]") delta--;
    out += c;
  }
  return { text: out, inStr, delta };
}

function indentWidth(line: string): number {
  let w = 0;
  for (const c of line) {
    if (c === " ") w += 1;
    else if (c === "\t") w += 4;
    else break;
  }
  return w;
}

/**
 * Dòng kết thúc bằng toán tử mở (trừ `=>`) → dòng sau là tiếp diễn, kể cả khi
 * thụt lề chia hết cho 4 (code GitHub viết tay hay wrap kiểu này dù TV cấm).
 */
function endsWithOpenOperator(text: string): boolean {
  const t = text.trimEnd();
  if (t.endsWith("=>")) return false;
  return /[+\-*/%,<>=?:([]$/.test(t) || /\b(?:and|or|not)$/.test(t);
}

/**
 * Ghép logical lines theo luật Pine: tiếp diễn khi (a) đang trong string
 * chưa đóng, (b) trong ngoặc chưa đóng, (c) dòng thụt lề KHÔNG chia hết
 * cho 4 (luật wrap chính thức của TradingView), hoặc (d) dòng trước kết
 * thúc bằng toán tử mở.
 */
export function assembleLogicalLines(source: string): LogicalLine[] {
  const physical = source.split("\n");
  const out: LogicalLine[] = [];
  let cur: LogicalLine | null = null;
  let depth = 0;
  let inStr: string | null = null;

  for (let i = 0; i < physical.length; i++) {
    const scanned = scanLine(physical[i], inStr);
    const wasInStr = inStr !== null;
    inStr = scanned.inStr;
    if (!wasInStr && scanned.text.trim() === "") continue;
    const indent = indentWidth(scanned.text);
    const isContinuation =
      cur !== null && (wasInStr || depth > 0 || indent % 4 !== 0 || endsWithOpenOperator(cur.text));
    if (isContinuation && cur) {
      // trong string giữ nguyên nội dung (escape \n đã nằm trong text), ngoài string nối bằng space
      cur.text += wasInStr ? scanned.text : " " + scanned.text.trim();
    } else {
      if (cur) out.push(cur);
      cur = { text: scanned.text.trim(), startLine: i + 1, level: Math.floor(indent / 4) };
    }
    depth += scanned.delta;
    if (depth < 0) depth = 0; // lỗi ngoặc — không để âm phá luật nối dòng
  }
  if (cur) out.push(cur);
  return out;
}

export interface LexResult {
  tokens: IToken[];
  errors: LexError[];
}

/** Tokenize toàn bộ script: token thật + NEWLINE/INDENT/DEDENT ảo. */
export function tokenize(source: string): LexResult {
  const lines = assembleLogicalLines(source);
  const tokens: IToken[] = [];
  const errors: LexError[] = [];
  const levels: number[] = [0];

  const synth = (tokType: TokenType, line: number): IToken =>
    ({
      image: tokType.name,
      startOffset: 0,
      startLine: line,
      startColumn: 1,
      endOffset: 0,
      endLine: line,
      endColumn: 1,
      tokenType: tokType,
      tokenTypeIdx: tokType.tokenTypeIdx!,
    }) as IToken;

  for (const ll of lines) {
    // indent bookkeeping
    const top = levels[levels.length - 1];
    if (ll.level > top) {
      // Pine chỉ tăng 1 level mỗi block; tăng nhiều hơn vẫn xử lý là 1 INDENT/level
      for (let l = top + 1; l <= ll.level; l++) {
        levels.push(l);
        tokens.push(synth(Indent, ll.startLine));
      }
    } else if (ll.level < top) {
      while (levels.length > 1 && levels[levels.length - 1] > ll.level) {
        levels.pop();
        tokens.push(synth(Dedent, ll.startLine));
      }
    }

    const res = lineLexer.tokenize(ll.text);
    for (const e of res.errors) {
      errors.push({ line: ll.startLine, message: e.message });
    }
    for (const t of res.tokens) {
      t.startLine = ll.startLine;
      t.endLine = ll.startLine;
      tokens.push(t);
    }
    tokens.push(synth(Newline, ll.startLine));
  }
  const lastLine = lines.length ? lines[lines.length - 1].startLine : 1;
  while (levels.length > 1) {
    levels.pop();
    tokens.push(synth(Dedent, lastLine));
  }
  return { tokens, errors };
}
