/* 
*   MiniImp language parser
*   by Andrea Riolo Vinciguerra
*/

import { BoolExpr, Cmd, NumExpr, Prog } from "./engine";

export class ParseError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "ParseError";
    }
}

/* these are the various tokens provided by our language */
export type TokenType =
    /* keywords */
    | "DEF"  | "MAIN"  | "WITH" | "INPUT" | "OUTPUT" | "AS"
    | "IF"   | "THEN"  | "ELSE" | "WHILE" | "DO"
    | "TRUE" | "FALSE" | "AND"  | "NOT"   | "SKIP"

    /* symbols */
    | "ASSIGN" | "SEMI"  | "LPAREN" | "RPAREN"
    | "PLUS"   | "MINUS" | "STAR"   | "LT"

    /* literals and EOF */
    | "ID" | "INT" | "EOF";

/* this is a token (including its type and the data) */
export type Token = {
    type: TokenType,
    literal: string,
    line: number,
};

/* mapping from string to token types */
const KEYWORDS: Record<string, TokenType> = {
    "def": "DEF",
    "main": "MAIN",
    "with": "WITH",
    "input": "INPUT",
    "output": "OUTPUT",
    "as": "AS",
    "if": "IF",
    "then": "THEN",
    "else": "ELSE",
    "while": "WHILE",
    "do": "DO",
    "true": "TRUE",
    "false": "FALSE",
    "and": "AND",
    "not": "NOT",
    "skip": "SKIP",
}

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
        if (char === ':' && source[current + 1] === '=') {
            tokens.push({ type: "ASSIGN", literal: ":=", line });
            current += 2;
            continue;
        }
        if (char === ';') {
            tokens.push({ type: "SEMI", literal: ";", line });
            current++;
            continue;
        }
        if (char === "(") {
            tokens.push({ type: "LPAREN", literal: "(", line });
            current++;
            continue;
        }
        if (char === ")") {
            tokens.push({ type: "RPAREN", literal: ")", line });
            current++;
            continue;
        }
        if (char === "+") {
            tokens.push({ type: "PLUS", literal: "+", line });
            current++;
            continue;
        }
        if (char === "-") {
            tokens.push({ type: "MINUS", literal: "-", line });
            current++;
            continue;
        }
        if (char === "*") {
            tokens.push({ type: "STAR", literal: "*", line });
            current++;
            continue;
        }
        if (char === "<") {
            tokens.push({ type: "LT", literal: "<", line });
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

    parse(): Prog {
        const prog = this.parseProg();
        if (!this.isAtEnd())
            throw this.error(this.peek(), "expected end of file");
        return prog;
    }

    private parseProg(): Prog {
        /* consume first words */
        this.consume("DEF", "expected 'def' at start of program");
        this.consume("MAIN", "expected 'main'");
        this.consume("WITH", "expected 'with'");

        /* consume input */
        this.consume("INPUT", "expected 'input'");
        let inVar = this.consume("ID", "expected input variable name").literal;

        /* consume output */
        this.consume("OUTPUT", "expected 'output");
        let outVar = this.consume("ID", "expected output variable name").literal;

        /* consume cmd */
        this.consume("AS", "expected 'as'");
        let cmd = this.parseCmd();

        /* return program to be evaluated */
        return { in: inVar, out: outVar, cmd };
    }

    private parseCmd(): Cmd {
        let cmd = this.parseSingleCmd();

        /* handling for sequential commands (cmd; cmd) */
        while (this.match("SEMI")) {
            let right = this.parseSingleCmd();
            cmd = { type: "seq", a: cmd, b: right };
        }

        return cmd;
    }

    private parseSingleCmd(): Cmd {
        /* parentheses are a single command, but inside there might be more,
         * which is why we call parseCmd */
        if (this.match("LPAREN")) {
            let cmd = this.parseCmd();
            this.consume("RPAREN", "expected ')' after command");
            return cmd;
        }

        /* if statement */
        if (this.match("IF")) {
            let cond = this.parseBoolExpr();
            this.consume("THEN", "expected 'then' after condition");
            let thenCmd = this.parseSingleCmd();
            this.consume("ELSE", "expected 'else'");
            let elseCmd = this.parseSingleCmd();
            return { type: "if", cond, then: thenCmd, else: elseCmd };
        }

        /* while loop */
        if (this.match("WHILE")) {
            let cond = this.parseBoolExpr();
            this.consume("DO", "expected 'do' after condition");
            let body = this.parseSingleCmd();
            return { type: "while", cond, body };
        }

        /* skip */
        if (this.match("SKIP"))
            return { type: "skip" };

        /* an identifier (for assignment) */
        if (this.match("ID")) {
            let id = this.previous().literal;
            this.consume("ASSIGN", "expected ':=' after identifier");
            let e = this.parseNumExpr();
            return { type: "assign", i: id, e };
        }

        throw this.error(this.peek(), "expected a valid command");
    }

    private parseBoolExpr(): BoolExpr {
        /* get the base term */
        let left = this.parseBoolBase();

        /* if there's an AND, we apply it after recursing into the terms */
        while (this.match("AND")) {
            let right = this.parseBoolBase();
            left = { type: "and", a: left, b: right };
        }

        return left;
    }

    private parseBoolBase(): BoolExpr {
        /* scalar values */
        if (this.match("TRUE"))
            return { type: "val", v: true };
        if (this.match("FALSE"))
            return { type: "val", v: false };
        if (this.match("NOT"))
            return { type: "not", e: this.parseBoolBase() };

        /* must be a numeric comparison */
        let a = this.parseNumExpr();
        this.consume("LT", "expected '<' for boolean comparison");
        let b = this.parseNumExpr();
        return { type: "lt", a, b };
    }

    private parseNumExpr(): NumExpr {
        /* get base term */
        let left = this.parseTerm();

        /* if there's + or -, we apply it after recursing into the terms.
         * this respects operator precedence */
        while (this.check("PLUS") || this.check("MINUS")) {
            let operator = this.advance();
            let right = this.parseTerm();
            if (operator.type === "PLUS")
                left = { type: "add", a: left, b: right }
            else
                left = { type: "sub", a: left, b: right }
        }

        return left;
    }

    private parseTerm(): NumExpr {
        /* get main factor (either num or identifier) */
        let left = this.parseFactor();

        /* while finding multiplications, chain them */
        while (this.match("STAR")) {
            let right = this.parseFactor();
            left = { type: "mul", a: left, b: right };
        }

        return left;
    }

    private parseFactor(): NumExpr {
        /* scalar or identifier */
        if (this.match("INT"))
            return { type: "val", v: parseInt(this.previous().literal, 10) };
        if (this.match("ID"))
            return { type: "id", i: this.previous().literal };

        throw this.error(this.peek(), "expected an integer or identifier");
    }

    private match(...types: TokenType[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }

    private check(type: TokenType): boolean {
        if (this.isAtEnd())
            return false;
        return this.peek().type === type;
    }

    private advance(): Token {
        if (!this.isAtEnd())
            this.current++;
        return this.previous();
    }

    private isAtEnd(): boolean {
        return this.peek().type === "EOF";
    }

    private peek(): Token {
        return this.tokens[this.current]!;
    }

    private previous(): Token {
        return this.tokens[this.current - 1]!;
    }

    private consume(type: TokenType, msg: string): Token {
        if (this.check(type))
            return this.advance();
        throw this.error(this.peek(), msg);
    }

    private error(token: Token, msg: string): ParseError {
        return new ParseError(`[line ${token.line}] error at ` +
                              `'${token.literal}': ${msg}`)
    }
}

export default function parse(source: string): Prog {
    /* quickly parse */
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    return parser.parse();
}
