/* 
*   MiniFun language parser
*   by Andrea Riolo Vinciguerra
*/

import { BinOp, Expr, TypeLabel } from "./engine";
import { ParseError } from "../errors";

export type TokenType =
    /* keywords */
    | "FUN"  | "IF"    | "THEN" | "ELSE" | "LET" | "IN" | "LETFUN"
    | "TRUE" | "FALSE"

    /* symbols */
    | "ARROW"  | "EQ" | "PLUS" | "MINUS" | "STAR" | "AND" | "LT" | "NOT"
    | "LPAREN" | "RPAREN"

    /* type annotations */
    | "COLON" | "TYPE_ARROW" | "KW_INT" | "KW_BOOL"

    /* literals and EOF */
    | "ID" | "INT" | "EOF";

export type Token = {
    type: TokenType,
    literal: string,
    line: number,
};

const KEYWORDS: Record<string, TokenType> = {
    "fun": "FUN",
    "if": "IF",
    "then": "THEN",
    "else": "ELSE",
    "let": "LET",
    "in": "IN",
    "letfun": "LETFUN",
    "true": "TRUE",
    "false": "FALSE",
    "int": "KW_INT",
    "bool": "KW_BOOL",
};

export function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let current = 0;
    let line = 1;

    while (current < source.length) {
        let char = source[current]!;

        /* handle whitespace */
        if (char === ' ' || char === '\r' || char === '\t') {
            current++;
            continue;
        }

        /* handle newline */
        if (char === '\n') {
            line++;
            current++;
            continue;
        }

        /* handle symbols */
        if (char === '=' && source[current + 1] === '>') {
            tokens.push({ type: "ARROW", literal: ">=", line });
            current += 2;
            continue;
        }
        if (char === '&' && source[current + 1] === '&') {
            tokens.push({ type: "AND", literal: "&&", line });
            current += 2;
            continue;
        }
        if (char === '-' && source[current + 1] === '>') {
            tokens.push({ type: "TYPE_ARROW", literal: "->", line });
            current += 2;
            continue;
        }
        if (char === '=') {
            tokens.push({ type: "EQ", literal: "=", line });
            current++;
            continue;
        }
        if (char === '+') {
            tokens.push({ type: "PLUS", literal: "+", line });
            current++;
            continue;
        }
        if (char === '-') {
            tokens.push({ type: "MINUS", literal: "-", line });
            current++;
            continue;
        }
        if (char === '*') {
            tokens.push({ type: "STAR", literal: "*", line });
            current++;
            continue;
        }
        if (char === '<') {
            tokens.push({ type: "LT", literal: "<", line });
            current++;
            continue;
        }
        if (char === '~') {
            tokens.push({ type: "NOT", literal: "~", line });
            current++;
            continue;
        }
        if (char === '(') {
            tokens.push({ type: "LPAREN", literal: "(", line });
            current++;
            continue;
        }
        if (char === ')') {
            tokens.push({ type: "RPAREN", literal: ")", line });
            current++;
            continue;
        }
        if (char === ':') {
            tokens.push({ type: "COLON", literal: ":", line });
            current++;
            continue;
        }

        /* handle identifiers and keywords */
        if (/[a-zA-Z_]/.test(char)) {
            let start = current;
            while (current < source.length &&
                  /[a-zA-Z0-9_]/.test(source[current]!)) {
                current++;
            }
            let text = source.substring(start, current);
            let type = KEYWORDS[text] || "ID";
            tokens.push({ type, literal: text, line });
            continue;
        }

        /* handle integers */
        if (/[0-9]/.test(char)) {
            let start = current;
            while (current < source.length &&
                  /[0-9]/.test(source[current]!)) {
                current++;
            }
            let text = source.substring(start, current);
            tokens.push({ type: "INT", literal: text, line });
            continue;
        }

        throw new ParseError(`unexpected character '${char}' at line ${line}`);
    }

    tokens.push({ type: "EOF", literal: "", line });
    return tokens;
}

export class Parser {
    private tokens: Token[];
    private current = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    parse(): Expr {
        const expr = this.parseExpr();
        if (!this.isAtEnd())
            throw this.error(this.peek(), "expected end of file");
        return expr;
    }

    /* top-level expressions: let, letfun, fun, if. these have the lowest
     * precedence */
    private parseExpr(): Expr {
        /* letfun expression */
        if (this.match("LETFUN")) {
            let id = this.consume("ID", "expected function name").literal;
            let arg = this.consume("ID", "expected argument name").literal;

            /* check for type annotation */
            let retType: TypeLabel | undefined;
            if (this.match("COLON"))
                retType = this.parseType();

            this.consume("EQ", "expected '=' after arguments");
            let body = this.parseExpr();
            this.consume("IN", "expected 'in' keyword");
            let inExpr = this.parseExpr();
            return { type: "letfun", i: id, arg, retType, body, in: inExpr };
        }

        /* let expression */
        if (this.match("LET")) {
            let id = this.consume("ID", "expected variable name").literal;
            this.consume("EQ", "expected '='");
            let e = this.parseExpr();
            this.consume("IN", "expected 'in' keyword");
            let inExpr = this.parseExpr();
            return { type: "let", i: id, e, in: inExpr };
        }

        /* fun expression */
        if (this.match("FUN")) {
            let arg = this.consume("ID", "expected argument name").literal;

            /* check for type annotation */
            let argType: TypeLabel | undefined;
            if (this.match("COLON"))
                argType = this.parseType();

            this.consume("ARROW", "expected '=>'");
            let body = this.parseExpr();
            return { type: "fun", arg, argType, body };
        }

        /* if expression */
        if (this.match("IF")) {
            let cond = this.parseExpr();
            this.consume("THEN", "expected 'then'");
            let thenExpr = this.parseExpr();
            this.consume("ELSE", "expected 'else'");
            let elseExpr = this.parseExpr();
            return { type: "if", cond, then: thenExpr, else: elseExpr };
        }

        /* lowest precedence (AND) to highest precedence (UNARY) */
        return this.parseAnd();
    }

    /* logical AND (&&) */
    private parseAnd(): Expr {
        let left = this.parseCmp();
        while (this.match("AND")) {
            let right = this.parseCmp();
            left = { type: "op", op: "and", a: left, b: right };
        }
        return left;
    }

    /* comparison (<) */
    private parseCmp(): Expr {
        let left = this.parseAddSub();
        while (this.match("LT")) {
            let right = this.parseAddSub();
            left = { type: "op", op: "lt", a: left, b: right };
        }
        return left;
    }

    /* addition or subtraction */
    private parseAddSub(): Expr {
        let left = this.parseMul();
        while (this.check("PLUS") || this.check("MINUS")) {
            let operator = this.advance();
            let right = this.parseMul();
            let op: BinOp = operator.type === "PLUS" ? "add" : "sub";
            left = { type: "op", op, a: left, b: right };
        }
        return left;
    }

    /* multiplication */
    private parseMul(): Expr {
        let left = this.parseApply();
        while (this.match("STAR")) {
            let right = this.parseApply();
            left = { type: "op", op: "mul", a: left, b: right };
        }
        return left;
    }

    /* function apply */
    private parseApply(): Expr {
        let expr = this.parseNot();

        /* keep wrapping in call as long as the next token represents a base
         * expression start */
        while (this.isApplyStart()) {
            let arg = this.parseNot();
            expr = { type: "call", f: expr, arg };
        }

        return expr;
    }

    /* unary NOT (highest precedence) */
    private parseNot(): Expr {
        if (this.match("NOT"))
            return { type: "not", e: this.parseNot() };
        return this.parseBase();
    }

    /* determines if current token could start a new expression for
     * application */
    private isApplyStart(): boolean {
        if (this.isAtEnd())
            return false;
        const type = this.peek().type;
        return type === "INT" || type === "ID" || type === "TRUE" ||
            type === "FALSE" || type === "LPAREN" || type === "NOT";
    }

    /* base expressions: literals, variables, parentheses */
    private parseBase(): Expr {
        /* if base term is wrapped in parentheses, it is a whole expr */
        if (this.match("LPAREN")) {
            let expr = this.parseExpr();
            this.consume("RPAREN", "expected ')'");
            return expr;
        }

        /* base stuff */
        if (this.match("TRUE"))
            return { type: "val", v: true };
        if (this.match("FALSE"))
            return { type: "val", v: false };
        if (this.match("INT"))
            return { type: "val", v: parseInt(this.previous().literal) };
        if (this.match("ID"))
            return { type: "id", i: this.previous().literal };

        throw this.error(this.peek(), "expected expression");
    }

    /* parse a type annotation and recursive on the left for functions
     * (left-associativity, like multiplication scanning for factors) */
    private parseType(): TypeLabel {
        let left = this.parseTypeBase();
        while (this.match("TYPE_ARROW")) {
            let right = this.parseTypeBase();
            left = { type: "fun", arg: left, ret: right };
        }
        return left;
    }

    /* base type annotation */
    private parseTypeBase(): TypeLabel {
        /* if wrapped in parentheses, this might be a whole subtype */
        if (this.match("LPAREN")) {
            let t = this.parseType();
            this.consume("RPAREN", "expected ')' after type");
            return t;
        }

        /* base stuff */
        if (this.match("KW_INT"))
            return { type: "int" };
        if (this.match("KW_BOOL"))
            return { type: "bool" };

        throw this.error(this.peek(), "expected type ('int') or ('bool')");
    }

    private match(...types: TokenType[]): boolean {
        /* match one or more tokens */
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }

    private check(type: TokenType): boolean {
        /* check if token is of type 'type' */
        if (this.isAtEnd())
            return false;
        return this.peek().type === type;
    }

    private advance(): Token {
        /* return current token and advance */
        if (!this.isAtEnd())
            this.current++;
        return this.previous();
    }

    private isAtEnd(): boolean {
        /* are we at the end of the token stream? */
        return this.peek().type === "EOF";
    }

    private peek(): Token {
        /* peek current token */
        return this.tokens[this.current]!;
    }

    private previous(): Token {
        /* peek previous token */
        return this.tokens[this.current - 1]!;
    }

    private consume(type: TokenType, msg: string): Token {
        /* consume one token of type 'type' and advance */
        if (this.check(type))
            return this.advance();
        throw this.error(this.peek(), msg);
    }

    private error(token: Token, msg: string): ParseError {
        /* quick error wrapper */
        return new ParseError(`[line ${token.line}] error at ` +
                              `'${token.literal}': ${msg}`)
    }
}

export default function parse(source: string): Expr {
    /* quickly parse */
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    return parser.parse();
}
