/**
 * Boolean search query parser for the global `q` parameter.
 *
 * Syntax:
 *   pool view          → pool AND view (implicit AND between adjacent terms)
 *   "ocean view"       → exact phrase
 *   pool OR beach      → either word
 *   !condo  /  NOT condo → exclude word
 *   pool AND (view OR beach) → grouping with parentheses
 *
 * Precedence (high → low): NOT > AND > OR
 * Operators are case-insensitive.
 */

// ── AST ───────────────────────────────────────────────────────────────────────

export type AstNode =
  | { type: 'AND';  left: AstNode; right: AstNode }
  | { type: 'OR';   left: AstNode; right: AstNode }
  | { type: 'NOT';  operand: AstNode }
  | { type: 'TERM'; value: string; isPhrase: boolean };

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type Token =
  | { type: 'WORD';   value: string }
  | { type: 'PHRASE'; value: string }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'BANG' }       // ! or NOT keyword
  | { type: 'LPAREN' }
  | { type: 'RPAREN' };

function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < q.length) {
    if (/\s/.test(q[i])) { i++; continue; }

    if (q[i] === '"') {
      let j = i + 1;
      while (j < q.length && q[j] !== '"') j++;
      const phrase = q.slice(i + 1, j).trim();
      if (phrase) tokens.push({ type: 'PHRASE', value: phrase });
      i = j + 1;
      continue;
    }

    if (q[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (q[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (q[i] === '!') { tokens.push({ type: 'BANG'   }); i++; continue; }

    // word / keyword
    let j = i;
    while (j < q.length && !/[\s()"!]/.test(q[j])) j++;
    const word = q.slice(i, j);
    if (word) {
      const up = word.toUpperCase();
      if      (up === 'AND') tokens.push({ type: 'AND' });
      else if (up === 'OR')  tokens.push({ type: 'OR'  });
      else if (up === 'NOT') tokens.push({ type: 'BANG' });
      else                   tokens.push({ type: 'WORD', value: word });
    }
    i = j;
  }
  return tokens;
}

// ── Parser ────────────────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token | null   { return this.tokens[this.pos] ?? null; }
  private consume(): Token        { return this.tokens[this.pos++]!; }

  parse(): AstNode | null { return this.parseOr(); }

  // or_expr → and_expr ('OR' and_expr)*
  private parseOr(): AstNode | null {
    let left = this.parseAnd();
    if (!left) return null;
    while (this.peek()?.type === 'OR') {
      this.consume();
      const right = this.parseAnd();
      if (!right) break;
      left = { type: 'OR', left, right };
    }
    return left;
  }

  // and_expr → not_expr ('AND'? not_expr)*   (implicit AND between adjacent terms)
  private parseAnd(): AstNode | null {
    let left = this.parseNot();
    if (!left) return null;
    while (true) {
      const t = this.peek();
      if (!t || t.type === 'OR' || t.type === 'RPAREN') break;
      const explicit = t.type === 'AND';
      if (explicit) this.consume();
      const right = this.parseNot();
      if (!right) break;
      left = { type: 'AND', left, right };
    }
    return left;
  }

  // not_expr → ('!'|BANG)* primary
  private parseNot(): AstNode | null {
    if (this.peek()?.type === 'BANG') {
      this.consume();
      const operand = this.parsePrimary();
      if (!operand) return null;
      return { type: 'NOT', operand };
    }
    return this.parsePrimary();
  }

  // primary → WORD | PHRASE | '(' expr ')'
  private parsePrimary(): AstNode | null {
    const t = this.peek();
    if (!t) return null;
    if (t.type === 'WORD')   { this.consume(); return { type: 'TERM', value: t.value, isPhrase: false }; }
    if (t.type === 'PHRASE') { this.consume(); return { type: 'TERM', value: t.value, isPhrase: true  }; }
    if (t.type === 'LPAREN') {
      this.consume();
      const inner = this.parseOr();
      if (this.peek()?.type === 'RPAREN') this.consume();
      return inner;
    }
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function parseSearchQuery(q: string): AstNode | null {
  const tokens = tokenize(q.trim());
  if (tokens.length === 0) return null;
  return new Parser(tokens).parse();
}

/**
 * Convert a parsed AST into a SQL WHERE fragment.
 * Each TERM is matched across all supplied column expressions with OR.
 * Appends bound values to the `bindings` array.
 *
 * @param columns  List of SQL column expressions, e.g. `["\"books__title\"", "\"books__summary\""]`
 */
export function searchAstToSql(
  node: AstNode,
  columns: string[],
  bindings: unknown[]
): string {
  switch (node.type) {
    case 'TERM': {
      const pattern = `%${node.value}%`;
      const parts = columns.map(c => `${c} LIKE ?`);
      bindings.push(...columns.map(() => pattern));
      return `(${parts.join(' OR ')})`;
    }
    case 'AND': {
      const l = searchAstToSql(node.left,  columns, bindings);
      const r = searchAstToSql(node.right, columns, bindings);
      return `(${l} AND ${r})`;
    }
    case 'OR': {
      const l = searchAstToSql(node.left,  columns, bindings);
      const r = searchAstToSql(node.right, columns, bindings);
      return `(${l} OR ${r})`;
    }
    case 'NOT': {
      const inner = searchAstToSql(node.operand, columns, bindings);
      return `NOT ${inner}`;
    }
  }
}
