/*
*   MiniImp language evaluator
*   by Andrea Riolo Vinciguerra
*/

/* evaluation error */
export class EvalError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "EvalError";
    }
}

/* custom identiifer type for modularity */
export type Identifier = string;

/* the main program element (root of the AST) */
export type Prog = { in: Identifier, out: Identifier, cmd: Cmd };

/* the command node */
export type Cmd =
    | { type: "assign", i: Identifier,  e: NumExpr           }
    | { type: "if",     cond: BoolExpr, then: Cmd, else: Cmd }
    | { type: "while",  cond: BoolExpr, body: Cmd            }
    | { type: "seq",    a: Cmd,         b: Cmd               }
    | { type: "skip"                                         };

/* a numeric expression */
export type NumExpr =
    | { type: "id",  i: Identifier          }
    | { type: "val", v: number              }
    | { type: "add", a: NumExpr, b: NumExpr }
    | { type: "sub", a: NumExpr, b: NumExpr }
    | { type: "mul", a: NumExpr, b: NumExpr };

/* a boolean expression (only used in while and if) */
export type BoolExpr =
    | { type: "val", v: boolean               }
    | { type: "and", a: BoolExpr, b: BoolExpr }
    | { type: "not", e: BoolExpr              }
    | { type: "lt",  a: NumExpr, b: NumExpr   };

/* this is our memory interface */
export interface Memory {
    update(id: Identifier, num: number): void;
    read(id: Identifier): number | undefined;
};

/* evaluate a single numeric expression */
export function evalNumExpr(expr: NumExpr, mem: Memory): number {
    switch (expr.type) {
        case "id": {
            let n = mem.read(expr.i);
            if (n === undefined)
                throw new EvalError(`unbound variable '${expr.i}'`);
            return n;
        }
        case "val":
            return expr.v;
        case "add":
            return evalNumExpr(expr.a, mem) + evalNumExpr(expr.b, mem);
        case "sub":
            return evalNumExpr(expr.a, mem) - evalNumExpr(expr.b, mem);
        case "mul":
            return evalNumExpr(expr.a, mem) * evalNumExpr(expr.b, mem);
    }
}

/* evaluate a single bool expression */
export function evalBoolExpr(expr: BoolExpr, mem: Memory): boolean {
    switch (expr.type) {
        case "val":
            return expr.v;
        case "and":
            return evalBoolExpr(expr.a, mem) && evalBoolExpr(expr.b, mem);
        case "not":
            return !evalBoolExpr(expr.e, mem);
        case "lt":
            return evalNumExpr(expr.a, mem) < evalNumExpr(expr.b, mem);
    }
}

/* evaluate a single command */
export function evalCmd(cmd: Cmd, mem: Memory): void {
    switch (cmd.type) {
        case "assign": {
            let n = evalNumExpr(cmd.e, mem);
            mem.update(cmd.i, n);
            break;
        }
        case "if": {
            let cond = evalBoolExpr(cmd.cond, mem);
            if (cond)
                evalCmd(cmd.then, mem);
            else
                evalCmd(cmd.else, mem);
            break;
        }
        case "while": {
            let cond = evalBoolExpr(cmd.cond, mem);
            while (cond) {
                evalCmd(cmd.body, mem);
                cond = evalBoolExpr(cmd.cond, mem);
            }
            break;
        }
        case "seq":
            evalCmd(cmd.a, mem);
            evalCmd(cmd.b, mem);
            break;
        case "skip":
            break;
    }
}

/* eval a whole program and return the result in the "out" identifier */
export function evalProg(prog: Prog, input: number, mem: Memory): number {
    /* set up memory with our input argument */
    mem.update(prog.in, input);

    /* execute our program */
    evalCmd(prog.cmd, mem);

    /* extract computed out value */
    let ret = mem.read(prog.out);
    if (ret === undefined)
        throw new EvalError(`output variable '${prog.out}' is unbound`);
    return ret;
}

/* example function to execute a program with a standard memory */
export default function execProg(prog: Prog, input: number): number {
    /* create an example memory */
    const mem = new class implements Memory {
        private map: Record<string, number>;
        constructor() {
            this.map = {};
        }
        update(id: Identifier, num: number): void {
            this.map[id] = num;
        }
        read(id: Identifier): number | undefined {
            return this.map[id];
        }
    }

    /* eval program with this memory */
    return evalProg(prog, input, mem);
}
