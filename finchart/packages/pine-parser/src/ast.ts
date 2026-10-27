/** AST cho subset Pine v4/v5 (scope T3 — xem PINE-CORPUS-REPORT). */

export interface Pos {
  line: number;
}

export type Stmt =
  | { kind: "FnDecl"; name: string; exported: boolean; isMethod: boolean; params: Param[]; body: Body; pos: Pos }
  | { kind: "VarDecl"; mode: "var" | "varip" | null; typeRef: string | null; name: string; init: Expr | null; pos: Pos }
  | { kind: "TupleDecl"; names: string[]; init: Expr; pos: Pos }
  | { kind: "Assign"; op: string; target: Expr; value: Expr; pos: Pos }
  | { kind: "ExprStmt"; expr: Expr; pos: Pos }
  | { kind: "If"; cond: Expr; then: Stmt[]; else_: Stmt[] | null; pos: Pos }
  | { kind: "ForTo"; varName: string; from: Expr; to: Expr; by: Expr | null; body: Stmt[]; pos: Pos }
  | { kind: "ForIn"; names: string[]; iter: Expr; body: Stmt[]; pos: Pos }
  | { kind: "While"; cond: Expr; body: Stmt[]; pos: Pos }
  | { kind: "Switch"; subject: Expr | null; cases: SwitchCase[]; pos: Pos }
  | { kind: "TypeDecl"; name: string; fields: { typeRef: string; name: string; init: Expr | null }[]; pos: Pos }
  | { kind: "Import"; raw: string; pos: Pos }
  | { kind: "Break"; pos: Pos }
  | { kind: "Continue"; pos: Pos }
  /** Nhiều statement trên một dòng, phân cách bằng dấu phẩy: `a = na , box.delete(b)`. */
  | { kind: "Multi"; stmts: Stmt[]; pos: Pos };

export interface SwitchCase {
  cond: Expr | null; // null = default
  body: Body;
}

/** Thân hàm / nhánh: expression đơn hoặc block statements. */
export type Body = { kind: "expr"; expr: Expr } | { kind: "block"; stmts: Stmt[] };

export interface Param {
  typeRef: string | null;
  name: string;
  default_: Expr | null;
}

export type Expr =
  | { kind: "Num"; value: number; pos: Pos }
  | { kind: "Str"; value: string; pos: Pos }
  | { kind: "Color"; value: string; pos: Pos }
  | { kind: "Ident"; name: string; pos: Pos }
  | { kind: "Member"; object: Expr; property: string; pos: Pos }
  | { kind: "Call"; callee: Expr; args: Arg[]; typeArgs?: string; pos: Pos }
  | { kind: "Index"; object: Expr; indices: Expr[]; pos: Pos }
  | { kind: "Unary"; op: string; operand: Expr; pos: Pos }
  | { kind: "Binary"; op: string; left: Expr; right: Expr; pos: Pos }
  | { kind: "Ternary"; cond: Expr; then: Expr; else_: Expr; pos: Pos }
  | { kind: "Tuple"; items: Expr[]; pos: Pos }
  | { kind: "IfExpr"; stmt: Extract<Stmt, { kind: "If" }>; pos: Pos }
  | { kind: "SwitchExpr"; stmt: Extract<Stmt, { kind: "Switch" }>; pos: Pos }
  | { kind: "ForExpr"; stmt: Extract<Stmt, { kind: "ForTo" } | { kind: "ForIn" } | { kind: "While" }>; pos: Pos };

export interface Arg {
  name: string | null; // named argument
  value: Expr;
}

export interface Script {
  statements: Stmt[];
}
