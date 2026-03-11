/*
*   MiniFun language evaluator
*   by Andrea Riolo Vinciguerra
*/

import { RuntimeError } from "../errors";
import { SourceSpan } from "./diag";

/* identifier type */
export type Identifier = string;

/* a function is a closure, as it needs to capture the outer environment */
export type Closure = {
    arg: Identifier,
    body: Expr,
    env: Environment
};

/* this is the actual value. closures are first-class citizens */
export type Value = number | boolean | Closure;

/* available binary operators */
export type BinOp = "add" | "sub" | "mul" | "and" | "lt";

/* type annotation node for AST */
export type TypeLabel =
    | { type: "int" }
    | { type: "bool" }
    | { type: "fun", arg: TypeLabel, ret: TypeLabel };

/* the expression to be evaluated */
export type Expr =
    | { type: "val",    v: Value,        span: SourceSpan                          }
    | { type: "id",     i: Identifier,   span: SourceSpan                          }
    | { type: "fun",    arg: Identifier, argType?: TypeLabel, body: Expr,
                        span: SourceSpan                                           }
    | { type: "call",   f: Expr,         arg: Expr,           span: SourceSpan     }
    | { type: "op",     op: BinOp,       a: Expr,             b: Expr,
                        span: SourceSpan                                           }
    | { type: "not",    e: Expr,         span: SourceSpan                          }
    | { type: "if",     cond: Expr,      then: Expr,          else: Expr,
                        span: SourceSpan                                           }
    | { type: "let",    i: Identifier,   e: Expr,             in: Expr,
                        span: SourceSpan                                           }
    | { type: "letfun", i: Identifier,   arg: Identifier,     retType?: TypeLabel,
                        body: Expr,      in: Expr,            span: SourceSpan     };

/* our environment (TODO: how about using a map???) */
export interface Environment {
    /* add a new identifier and return the new environment */
    with(id: Identifier, val: Value): Environment;

    /* read the latest identifier available or bail out */
    read(id: Identifier): Value | undefined;
};

/* helpers to quickly assert that a value is a certain type. this is not part
 * of the type checking system, but is required by the evaluator in case of
 * runtime errors (which should not happen given proper typing) */
function assertBool(v: Value): asserts v is boolean {
    /* TODO LINE SPECIFIER */
    if (typeof v !== "boolean")
        throw new RuntimeError(`value ${v} is not boolean`);
}

function assertNumber(v: Value): asserts v is number {
    /* TODO LINE SPECIFIER */
    if (typeof v !== "number")
        throw new RuntimeError(`value ${v} is not number`);
}

function assertClosure(v: Value): asserts v is Closure {
    /* TODO LINE SPECIFIER */
    if (v === null || typeof v !== "object")
        throw new RuntimeError(`value ${v} is not a closure`);
}

/* fetch value from environment or error out */
function readValue(id: Identifier, env: Environment): Value {
    /* TODO LINE SPECIFIER */
    let val = env.read(id);
    if (val === undefined)
        throw new RuntimeError(`unbound variable '${id}'`);
    return val;
}

/* perform a binary op */
function binaryOp(op: BinOp, a: Value, b: Value): Value {
    switch (op) {
        case "add":
            assertNumber(a);
            assertNumber(b);
            return a + b;
        case "sub":
            assertNumber(a);
            assertNumber(b);
            return a - b;
        case "mul":
            assertNumber(a);
            assertNumber(b);
            return a * b;
        case "and":
            assertBool(a);
            assertBool(b);
            return a && b;
        case "lt":
            assertNumber(a);
            assertNumber(b);
            return a < b;
    }
}

/* evaluate the expression under an environment */
export function evalExpr(expr: Expr, env: Environment): Value {
    switch (expr.type) {
        case "val":
            return expr.v;
        case "id":
            return readValue(expr.i, env);
        case "fun": {
            /* returns a closure capturing this environment */
            return {
                arg: expr.arg,
                body: expr.body,
                env: env,
            };
        }
        case "call": {
            /* extract closure */
            let fun = evalExpr(expr.f, env);
            assertClosure(fun);

            /* grab function's environment and assign the arg to its var */
            let newEnv = fun.env.with(fun.arg, evalExpr(expr.arg, env));

            /* evaluate function's body within the crafted environment */
            return evalExpr(fun.body, newEnv);
        }
        case "op":
            return binaryOp(expr.op, evalExpr(expr.a, env),
                            evalExpr(expr.b, env));
        case "not": {
            let v = evalExpr(expr.e, env);
            assertBool(v);
            return !v;
        }
        case "if": {
            let cond = evalExpr(expr.cond, env);
            assertBool(cond);
            if (cond)
                return evalExpr(expr.then, env);
            return evalExpr(expr.else, env);
        }
        case "let": {
            /* inject expression into environment */
            let newEnv = env.with(expr.i, evalExpr(expr.e, env));

            /* eval 'in' expression with new environment */
            return evalExpr(expr.in, newEnv);
        }
        case "letfun": {
            /* create a closure capturing this environment */
            let closure: Closure = {
                arg: expr.arg,
                body: expr.body,
                env: env,
            };

            /* create a new environment that binds the function's name to
             * its own closure */
            let newEnv = env.with(expr.i, closure);

            /* modify the closure's environment to point to the new environment,
             * so that they point to each other and recursion is allowed */
            closure.env = newEnv;

            /* execute the expression in the context of this new environment */
            return evalExpr(expr.in, newEnv);
        }
    }
}

export default function execProg(expr: Expr): Value {
    let env = new class EnvImpl implements Environment {
        constructor(
            private readonly id: Identifier | null = null,
            private readonly val: Value | null = null,
            private readonly parent: Environment | null = null
        ) {}

        with(id: Identifier, val: Value): Environment {
            return new EnvImpl(id, val, this);
        }

        read(id: Identifier): Value | undefined {
            /* check local scope first */
            if (this.id === id && this.val !== null)
                return this.val;

            /* check parent scope */
            if (this.parent !== null)
                return this.parent.read(id);

            /* not found */
            return undefined;
        }
    };

    /* use this environment to evaluate expression */
    return evalExpr(expr, env);
}
