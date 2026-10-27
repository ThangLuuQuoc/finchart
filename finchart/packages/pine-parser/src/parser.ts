/**
 * Recursive-descent parser cho subset Pine v4/v5 (scope T3).
 *
 * Chạy trên token stream của lexer.ts (token thật + NEWLINE/INDENT/DEDENT ảo).
 * Hand-rolled thay vì grammar engine vì Pine cần lookahead tuỳ ý ở vài chỗ
 * (function decl `name(args) =>`, typed declarations `color x =`,
 * if/switch dùng được như expression) — RD cho kiểm soát trực tiếp và
 * error message kèm số dòng.
 */

import type { IToken, TokenType } from "chevrotain";
import * as T from "./lexer";
import type { Arg, Body, Expr, Param, Pos, Script, Stmt, SwitchCase } from "./ast";

export interface ParseError {
  line: number;
  message: string;
}

export class ParseFailure extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
  }
}

const ASSIGN_OPS = new Set(["Walrus", "PlusEq", "MinusEq", "StarEq", "SlashEq", "PercentEq"]);

export class Parser {
  private i = 0;

  constructor(private readonly tokens: IToken[]) {}

  // ── helpers ────────────────────────────────────────────────────────────────

  private peek(k = 0): IToken | undefined {
    return this.tokens[this.i + k];
  }

  private typeName(k = 0): string {
    return this.tokens[this.i + k]?.tokenType.name ?? "EOF";
  }

  private at(tok: TokenType, k = 0): boolean {
    return this.typeName(k) === tok.name;
  }

  private pos(): Pos {
    return { line: this.peek()?.startLine ?? this.tokens[this.tokens.length - 1]?.endLine ?? 0 };
  }

  private next(): IToken {
    const t = this.tokens[this.i++];
    if (!t) throw new ParseFailure(this.pos().line, "unexpected end of input");
    return t;
  }

  private expect(tok: TokenType, ctx: string): IToken {
    if (!this.at(tok)) {
      throw new ParseFailure(this.pos().line, `expected ${tok.name} ${ctx}, got ${this.typeName()} '${this.peek()?.image ?? ""}'`);
    }
    return this.next();
  }

  private eat(tok: TokenType): boolean {
    if (this.at(tok)) {
      this.i++;
      return true;
    }
    return false;
  }

  /** Keyword theo ngữ cảnh (`type`, `method`, `in`, `to`, `by` là Identifier thường). */
  private isWord(w: string, k = 0): boolean {
    const t = this.peek(k);
    return t?.tokenType.name === "Identifier" && t.image === w;
  }

  private expectWord(w: string, ctx: string): void {
    if (!this.isWord(w)) {
      throw new ParseFailure(this.pos().line, `expected '${w}' ${ctx}, got ${this.typeName()} '${this.peek()?.image ?? ""}'`);
    }
    this.i++;
  }

  private skipNewlines(): void {
    while (this.at(T.Newline)) this.i++;
  }

  // ── entry ──────────────────────────────────────────────────────────────────

  parseScript(): Script {
    const statements: Stmt[] = [];
    this.skipNewlines();
    while (this.i < this.tokens.length) {
      statements.push(this.statement());
      this.skipNewlines();
    }
    return { statements };
  }

  // ── statements ─────────────────────────────────────────────────────────────

  private statement(): Stmt {
    const pos = this.pos();
    switch (this.typeName()) {
      case "If":
        return this.ifStmt();
      case "For":
        return this.forStmt();
      case "While":
        return this.whileStmt();
      case "Switch":
        return this.switchStmt();
      case "Import":
        return this.importStmt();
      case "Identifier":
        // `type Name` mở UDT (phân biệt với `type = ...` named-arg/biến)
        if (this.isWord("type") && this.at(T.Identifier, 1) && this.typeName(2) === "Newline") {
          return this.typeDecl(false);
        }
        break;
      case "Export": {
        // export fn / export type / export method
        if (this.isWord("type", 1) && this.at(T.Identifier, 2)) {
          this.next();
          return this.typeDecl(true);
        }
        return this.simpleLine();
      }
      case "Break":
        this.next();
        this.expect(T.Newline, "after break");
        return { kind: "Break", pos };
      case "Continue":
        this.next();
        this.expect(T.Newline, "after continue");
        return { kind: "Continue", pos };
    }
    return this.simpleLine();
  }

  /** Block = INDENT stmts DEDENT. */
  private block(ctx: string): Stmt[] {
    this.expect(T.Indent, `to open block ${ctx}`);
    const stmts: Stmt[] = [];
    this.skipNewlines();
    while (!this.at(T.Dedent)) {
      stmts.push(this.statement());
      this.skipNewlines();
      if (this.i >= this.tokens.length) break;
    }
    this.eat(T.Dedent);
    return stmts;
  }

  private ifStmt(): Extract<Stmt, { kind: "If" }> {
    const pos = this.pos();
    this.expect(T.If, "");
    const cond = this.expression();
    this.expect(T.Newline, "after if condition");
    const then = this.block("of if");
    let else_: Stmt[] | null = null;
    if (this.at(T.Else)) {
      this.next();
      if (this.at(T.If)) {
        else_ = [this.ifStmt()];
      } else {
        this.expect(T.Newline, "after else");
        else_ = this.block("of else");
      }
    }
    return { kind: "If", cond, then, else_, pos };
  }

  private forStmt(): Stmt {
    const pos = this.pos();
    this.expect(T.For, "");
    if (this.at(T.LBracket)) {
      // for [i, v] in arr
      this.next();
      const names = [this.expect(T.Identifier, "in for-tuple").image];
      while (this.eat(T.Comma)) names.push(this.expect(T.Identifier, "in for-tuple").image);
      this.expect(T.RBracket, "to close for-tuple");
      this.expectWord("in", "in for-in");
      const iter = this.expression();
      this.expect(T.Newline, "after for header");
      return { kind: "ForIn", names, iter, body: this.block("of for"), pos };
    }
    const name = this.expect(T.Identifier, "as loop variable").image;
    if (this.isWord("in")) {
      this.i++;
      const iter = this.expression();
      this.expect(T.Newline, "after for header");
      return { kind: "ForIn", names: [name], iter, body: this.block("of for"), pos };
    }
    this.expect(T.Eq, "in for-to");
    // `to`/`by` là Identifier thường nhưng không bao giờ ở vị trí toán tử —
    // expression() dừng tự nhiên trước chúng.
    const from = this.expression();
    this.expectWord("to", "in for-to");
    const to = this.expression();
    let by: Expr | null = null;
    if (this.isWord("by")) {
      this.i++;
      by = this.expression();
    }
    this.expect(T.Newline, "after for header");
    return { kind: "ForTo", varName: name, from, to, by, body: this.block("of for"), pos };
  }

  private whileStmt(): Stmt {
    const pos = this.pos();
    this.expect(T.While, "");
    const cond = this.expression();
    this.expect(T.Newline, "after while condition");
    return { kind: "While", cond, body: this.block("of while"), pos };
  }

  private switchStmt(): Extract<Stmt, { kind: "Switch" }> {
    const pos = this.pos();
    this.expect(T.Switch, "");
    const subject = this.at(T.Newline) ? null : this.expression();
    this.expect(T.Newline, "after switch");
    this.expect(T.Indent, "to open switch cases");
    const cases: SwitchCase[] = [];
    this.skipNewlines();
    while (!this.at(T.Dedent) && this.i < this.tokens.length) {
      const cond = this.at(T.FatArrow) ? null : this.expression();
      this.expect(T.FatArrow, "in switch case");
      cases.push({ cond, body: this.bodyAfterArrow("switch case") });
      this.skipNewlines();
    }
    this.eat(T.Dedent);
    return { kind: "Switch", subject, cases, pos };
  }

  private importStmt(): Stmt {
    const pos = this.pos();
    this.expect(T.Import, "");
    const parts: string[] = [];
    while (!this.at(T.Newline) && this.i < this.tokens.length) parts.push(this.next().image);
    this.eat(T.Newline);
    return { kind: "Import", raw: parts.join(""), pos };
  }

  private typeDecl(exported: boolean): Stmt {
    void exported;
    const pos = this.pos();
    this.expectWord("type", "to open type declaration");
    const name = this.expect(T.Identifier, "as type name").image;
    this.expect(T.Newline, "after type name");
    this.expect(T.Indent, "to open type fields");
    const fields: { typeRef: string; name: string; init: Expr | null }[] = [];
    this.skipNewlines();
    while (!this.at(T.Dedent) && this.i < this.tokens.length) {
      const typeRef = this.typeRef();
      const fieldName = this.expect(T.Identifier, "as field name").image;
      const init = this.eat(T.Eq) ? this.expression() : null;
      fields.push({ typeRef, name: fieldName, init });
      this.expect(T.Newline, "after type field");
      this.skipNewlines();
    }
    this.eat(T.Dedent);
    return { kind: "TypeDecl", name, fields, pos };
  }

  /**
   * Một "atom" kiểu: `float`, `chart.point`, `array<float>`, `map<string, float>`,
   * `float[]`. Trả về dạng chuỗi; ném lỗi nếu không bắt đầu bằng Identifier.
   */
  private typeRefAtom(): string {
    let s = this.expect(T.Identifier, "as type").image;
    while (this.at(T.Dot) && this.at(T.Identifier, 1)) {
      this.i++;
      s += "." + this.next().image;
    }
    if (this.at(T.Lt) && this.at(T.Identifier, 1)) {
      this.next();
      const args: string[] = [];
      do {
        let g = this.expect(T.Identifier, "in generic type").image;
        while (this.eat(T.Dot)) g += "." + this.expect(T.Identifier, "in generic type").image;
        args.push(g);
      } while (this.eat(T.Comma));
      this.expect(T.Gt, "to close generic type");
      s += `<${args.join(", ")}>`;
    } else if (this.at(T.LBracket) && this.at(T.RBracket, 1)) {
      this.i += 2;
      s += "[]";
    }
    return s;
  }

  /** typeRef cho field của UDT (một atom, có thể kèm qualifier phía trước). */
  private typeRef(): string {
    const words = [this.typeRefAtom()];
    while (this.at(T.Identifier) && this.at(T.Identifier, 1)) words.push(this.typeRefAtom());
    return words.join(" ");
  }

  /**
   * Một dòng "đơn": 1+ piece phân cách bằng dấu phẩy (Pine cho phép
   * `var box b = na , box.delete(b)`), mỗi piece là function decl / typed
   * decl / var decl / tuple decl / (re)assignment / bare expression.
   */
  private simpleLine(): Stmt {
    const pos = this.pos();
    const first = this.simplePiece();
    if (first.terminated) return first.stmt;
    if (!this.at(T.Comma)) {
      this.expect(T.Newline, "at end of statement");
      return first.stmt;
    }
    const stmts = [first.stmt];
    while (this.eat(T.Comma)) {
      const p = this.simplePiece();
      stmts.push(p.stmt);
      if (p.terminated) return { kind: "Multi", stmts, pos };
    }
    this.expect(T.Newline, "at end of statement");
    return { kind: "Multi", stmts, pos };
  }

  /** Một piece; `terminated` = piece đã nuốt hết phần cuối dòng (compound RHS / fn body). */
  private simplePiece(): { stmt: Stmt; terminated: boolean } {
    const pos = this.pos();

    // export? method? name(params) =>  — function declaration
    if (this.fnDeclAhead()) return { stmt: this.fnDecl(), terminated: true };

    // var/varip [type] name = rhs
    if (this.at(T.Var)) {
      const mode = this.next().image as "var" | "varip";
      const typed = this.tryTypedDecl(mode, pos, true);
      if (typed) return typed;
      throw new ParseFailure(pos.line, `expected declaration after '${mode}'`);
    }

    // [a, b] = expr — tuple destructuring
    if (this.at(T.LBracket) && this.tupleDeclAhead()) {
      this.next();
      const names = [this.expect(T.Identifier, "in tuple target").image];
      while (this.eat(T.Comma)) names.push(this.expect(T.Identifier, "in tuple target").image);
      this.expect(T.RBracket, "to close tuple target");
      this.expect(T.Eq, "in tuple declaration");
      const r = this.rhs();
      return { stmt: { kind: "TupleDecl", names, init: r.expr, pos }, terminated: r.terminated };
    }

    // typed decl: `color x = ...`, `const string g = ...`, `map<string,float> m = ...`
    const typed = this.tryTypedDecl(null, pos, false);
    if (typed) return typed;

    // expression rồi xét assignment
    const expr = this.expression();
    if (this.at(T.Eq)) {
      this.next();
      const r = this.rhs();
      const stmt: Stmt =
        expr.kind === "Ident"
          ? { kind: "VarDecl", mode: null, typeRef: null, name: expr.name, init: r.expr, pos }
          : { kind: "Assign", op: "=", target: expr, value: r.expr, pos };
      return { stmt, terminated: r.terminated };
    }
    if (ASSIGN_OPS.has(this.typeName())) {
      const op = this.next().image;
      const r = this.rhs();
      return { stmt: { kind: "Assign", op, target: expr, value: r.expr, pos }, terminated: r.terminated };
    }
    return { stmt: { kind: "ExprStmt", expr, pos }, terminated: false };
  }

  /**
   * Thử parse `[qualifier...] type name (= rhs)?` bằng backtracking.
   * Không khớp → trả null và phục hồi vị trí. Khi không có `var`, đòi ít
   * nhất 2 từ (type + name) để không nuốt nhầm `name = expr`.
   */
  private tryTypedDecl(
    mode: "var" | "varip" | null,
    pos: Pos,
    allowBare: boolean,
  ): { stmt: Stmt; terminated: boolean } | null {
    const save = this.i;
    const words: string[] = [];
    try {
      while (this.at(T.Identifier)) {
        const before = this.i;
        const atom = this.typeRefAtom();
        const plainIdent = this.i === before + 1; // atom là 1 identifier trần
        const nextIsEnd = this.at(T.Eq) || this.at(T.Newline) || this.at(T.Comma);
        if (plainIdent && nextIsEnd) {
          // atom này là TÊN biến
          const enough = words.length >= 1 || (allowBare && mode !== null);
          if (!enough) break;
          const typeRef = words.length ? words.join(" ") : null;
          if (this.eat(T.Eq)) {
            const r = this.rhs();
            return { stmt: { kind: "VarDecl", mode, typeRef, name: atom, init: r.expr, pos }, terminated: r.terminated };
          }
          return { stmt: { kind: "VarDecl", mode, typeRef, name: atom, init: null, pos }, terminated: false };
        }
        words.push(atom);
      }
    } catch {
      /* rollback */
    }
    this.i = save;
    return null;
  }

  /** RHS của khai báo/gán: expression thường HOẶC if/switch/for/while-as-expression. */
  private rhs(): { expr: Expr; terminated: boolean } {
    const pos = this.pos();
    if (this.at(T.If)) {
      return { expr: { kind: "IfExpr", stmt: this.ifStmt(), pos }, terminated: true };
    }
    if (this.at(T.Switch)) {
      return { expr: { kind: "SwitchExpr", stmt: this.switchStmt(), pos }, terminated: true };
    }
    if (this.at(T.For) || this.at(T.While)) {
      const stmt = this.at(T.While) ? this.whileStmt() : this.forStmt();
      return { expr: { kind: "ForExpr", stmt: stmt as never, pos }, terminated: true };
    }
    return { expr: this.expression(), terminated: false };
  }

  // ── lookahead gates ────────────────────────────────────────────────────────

  /** `[export] [method] ident ( ... ) =>` trước Newline, ngoặc cân bằng. */
  private fnDeclAhead(): boolean {
    let k = 0;
    if (this.at(T.Export, k)) k++;
    if (this.isWord("method", k) && this.at(T.Identifier, k + 1) && this.at(T.LParen, k + 2)) k++;
    if (!this.at(T.Identifier, k)) return false;
    if (!this.at(T.LParen, k + 1)) return false;
    let depth = 0;
    for (let j = k + 1; ; j++) {
      const n = this.typeName(j);
      if (n === "Newline" || n === "EOF") return false;
      if (n === "LParen" || n === "LBracket") depth++;
      else if (n === "RParen" || n === "RBracket") {
        depth--;
        if (depth === 0) return this.at(T.FatArrow, j + 1);
      }
    }
  }

  /** `[ id, id, ... ] =` — tuple declaration (phân biệt với array literal). */
  private tupleDeclAhead(): boolean {
    let depth = 0;
    for (let j = 0; ; j++) {
      const n = this.typeName(j);
      if (n === "Newline" || n === "EOF") return false;
      if (n === "LBracket" || n === "LParen") depth++;
      else if (n === "RBracket" || n === "RParen") {
        depth--;
        if (depth === 0) return this.typeName(j + 1) === "Eq";
      }
    }
  }

  // ── function declarations ──────────────────────────────────────────────────

  private fnDecl(): Stmt {
    const pos = this.pos();
    const exported = this.eat(T.Export);
    let isMethod = false;
    if (this.isWord("method") && this.at(T.Identifier, 1) && this.at(T.LParen, 2)) {
      this.i++;
      isMethod = true;
    }
    const name = this.expect(T.Identifier, "as function name").image;
    this.expect(T.LParen, "to open parameters");
    const params: Param[] = [];
    if (!this.at(T.RParen)) {
      do {
        params.push(this.param());
      } while (this.eat(T.Comma));
    }
    this.expect(T.RParen, "to close parameters");
    this.expect(T.FatArrow, "in function declaration");
    return { kind: "FnDecl", name, exported, isMethod, params, body: this.bodyAfterArrow("function"), pos };
  }

  private param(): Param {
    // dạng: [series|simple]? [type] name [= default] — gom mọi Identifier đứng trước
    // tên cuối làm typeRef (lỏng nhưng đúng cho corpus).
    const parts: string[] = [];
    let name = this.expect(T.Identifier, "as parameter").image;
    for (;;) {
      if (this.at(T.Identifier)) {
        parts.push(name);
        name = this.next().image;
        continue;
      }
      if (this.at(T.Dot) && this.at(T.Identifier, 1)) {
        // qualified type part: chart.point p
        parts.push(name + "." + this.tokens[this.i + 1].image);
        this.i += 2;
        name = this.expect(T.Identifier, "as parameter name").image;
        continue;
      }
      if (this.at(T.Lt) && this.at(T.Identifier, 1)) {
        // generic: array<float> a, map<string, float> m
        this.next();
        const args: string[] = [];
        do {
          let g = this.expect(T.Identifier, "in generic").image;
          while (this.eat(T.Dot)) g += "." + this.expect(T.Identifier, "in generic").image;
          args.push(g);
        } while (this.eat(T.Comma));
        this.expect(T.Gt, "to close generic");
        parts.push(`${name}<${args.join(", ")}>`);
        name = this.expect(T.Identifier, "as parameter name").image;
        continue;
      }
      if (this.at(T.LBracket) && this.at(T.RBracket, 1)) {
        this.i += 2;
        parts.push(name + "[]");
        name = this.expect(T.Identifier, "as parameter name").image;
        continue;
      }
      break;
    }
    const default_ = this.eat(T.Eq) ? this.expression() : null;
    return { typeRef: parts.length ? parts.join(" ") : null, name, default_ };
  }

  /** Sau `=>`: expression cùng dòng, hoặc block thụt lề. */
  private bodyAfterArrow(ctx: string): Body {
    if (this.eat(T.Newline)) {
      return { kind: "block", stmts: this.block(`of ${ctx}`) };
    }
    // thân một dòng — có thể là statement-ish (vd `strategy.entry(...)`) hoặc expr
    const stmts: Stmt[] = [this.simpleLine()];
    if (stmts[0].kind === "ExprStmt") return { kind: "expr", expr: stmts[0].expr };
    return { kind: "block", stmts };
  }

  // ── expressions (precedence climbing) ─────────────────────────────────────

  private expression(): Expr {
    return this.ternary();
  }

  private ternary(): Expr {
    const pos = this.pos();
    const cond = this.orExpr();
    if (this.eat(T.Question)) {
      const then = this.ternary();
      this.expect(T.Colon, "in ternary");
      const else_ = this.ternary();
      return { kind: "Ternary", cond, then, else_, pos };
    }
    return cond;
  }

  private orExpr(): Expr {
    let left = this.andExpr();
    while (this.at(T.Or)) {
      const pos = this.pos();
      this.next();
      left = { kind: "Binary", op: "or", left, right: this.andExpr(), pos };
    }
    return left;
  }

  private andExpr(): Expr {
    let left = this.equality();
    while (this.at(T.And)) {
      const pos = this.pos();
      this.next();
      left = { kind: "Binary", op: "and", left, right: this.equality(), pos };
    }
    return left;
  }

  private equality(): Expr {
    let left = this.relational();
    while (this.at(T.EqEq) || this.at(T.NotEq)) {
      const pos = this.pos();
      const op = this.next().image;
      left = { kind: "Binary", op, left, right: this.relational(), pos };
    }
    return left;
  }

  private relational(): Expr {
    let left = this.additive();
    while (this.at(T.Lt) || this.at(T.Gt) || this.at(T.LtEq) || this.at(T.GtEq)) {
      const pos = this.pos();
      const op = this.next().image;
      left = { kind: "Binary", op, left, right: this.additive(), pos };
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.at(T.Plus) || this.at(T.Minus)) {
      const pos = this.pos();
      const op = this.next().image;
      left = { kind: "Binary", op, left, right: this.multiplicative(), pos };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.at(T.Star) || this.at(T.Slash) || this.at(T.Percent)) {
      const pos = this.pos();
      const op = this.next().image;
      left = { kind: "Binary", op, left, right: this.unary(), pos };
    }
    return left;
  }

  private unary(): Expr {
    const pos = this.pos();
    if (this.at(T.Not) || this.at(T.Minus) || this.at(T.Plus)) {
      const op = this.next().image;
      return { kind: "Unary", op, operand: this.unary(), pos };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    let pendingTypeArgs: string | undefined;
    for (;;) {
      const pos = this.pos();
      if (this.eat(T.Dot)) {
        const prop = this.expect(T.Identifier, "after '.'").image;
        e = { kind: "Member", object: e, property: prop, pos };
        continue;
      }
      // generic call: name<type, ...>(args) — phân biệt với phép so sánh `<`
      if (this.at(T.Lt) && this.genericCallAhead()) {
        this.next();
        const args: string[] = [];
        do {
          let g = this.expect(T.Identifier, "in type arguments").image;
          while (this.eat(T.Dot)) g += "." + this.expect(T.Identifier, "in type arguments").image;
          args.push(g);
        } while (this.eat(T.Comma));
        this.expect(T.Gt, "to close type arguments");
        pendingTypeArgs = args.join(", ");
        continue;
      }
      if (this.at(T.LParen)) {
        this.next();
        const args: Arg[] = [];
        if (!this.at(T.RParen)) {
          do {
            args.push(this.arg());
          } while (this.eat(T.Comma));
        }
        this.expect(T.RParen, "to close call");
        e = { kind: "Call", callee: e, args, typeArgs: pendingTypeArgs, pos };
        pendingTypeArgs = undefined;
        continue;
      }
      if (this.at(T.LBracket)) {
        this.next();
        const indices = [this.expression()];
        while (this.eat(T.Comma)) indices.push(this.expression());
        this.expect(T.RBracket, "to close index");
        e = { kind: "Index", object: e, indices, pos };
        continue;
      }
      return e;
    }
  }

  /** `<Identifier(.Identifier)*(, ...)>` theo sau là `(` — chắc chắn là generic call. */
  private genericCallAhead(): boolean {
    let j = 1; // đứng tại Lt
    for (;;) {
      if (this.typeName(j) !== "Identifier") return false;
      j++;
      while (this.typeName(j) === "Dot" && this.typeName(j + 1) === "Identifier") j += 2;
      if (this.typeName(j) === "Comma") {
        j++;
        continue;
      }
      return this.typeName(j) === "Gt" && this.typeName(j + 1) === "LParen";
    }
  }

  private arg(): Arg {
    // named arg: ident = expr (không nhầm với == )
    if (this.at(T.Identifier) && this.at(T.Eq, 1)) {
      const name = this.next().image;
      this.next();
      return { name, value: this.expression() };
    }
    return { name: null, value: this.expression() };
  }

  private primary(): Expr {
    const pos = this.pos();
    const t = this.peek();
    if (!t) throw new ParseFailure(pos.line, "unexpected end of input in expression");
    switch (t.tokenType.name) {
      case "NumberLit":
        this.next();
        return { kind: "Num", value: parseFloat(t.image), pos };
      case "StringLit":
        this.next();
        return { kind: "Str", value: t.image.slice(1, -1), pos };
      case "ColorLit":
        this.next();
        return { kind: "Color", value: t.image, pos };
      case "Identifier":
        this.next();
        return { kind: "Ident", name: t.image, pos };
      case "LParen": {
        this.next();
        const e = this.expression();
        this.expect(T.RParen, "to close group");
        return e;
      }
      case "LBracket": {
        // array/tuple literal
        this.next();
        const items: Expr[] = [];
        if (!this.at(T.RBracket)) {
          do {
            items.push(this.expression());
          } while (this.eat(T.Comma));
        }
        this.expect(T.RBracket, "to close tuple");
        return { kind: "Tuple", items, pos };
      }
      // keyword dùng như identifier trong vài context (vd `text`, `type` là tên đối số đã xử lý ở arg)
      default:
        throw new ParseFailure(pos.line, `unexpected token ${t.tokenType.name} '${t.image}' in expression`);
    }
  }
}

export interface ParseResult {
  script: Script | null;
  errors: ParseError[];
}

export function parse(source: string): ParseResult {
  const lex = T.tokenize(source);
  const errors: ParseError[] = lex.errors.map((e) => ({ line: e.line, message: `lex: ${e.message}` }));
  if (errors.length > 0) return { script: null, errors };
  try {
    const script = new Parser(lex.tokens).parseScript();
    return { script, errors: [] };
  } catch (e) {
    if (e instanceof ParseFailure) return { script: null, errors: [{ line: e.line, message: e.message }] };
    throw e;
  }
}
