/*
*   MiniFun language evaluator
*   by Andrea Riolo Vinciguerra
*/

import { EvalError } from "../errors";

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

/* the expression to be evaluated */
export type Expr =
    | { type: "val",    v: Value                                                }
    | { type: "id",     i: Identifier                                           }
    | { type: "fun",    arg: Identifier, body: Expr                             }
    | { type: "call",   f: Expr,         arg: Expr                              }
    | { type: "op",     op: BinOp,       a: Expr,         b: Expr               }
    | { type: "not",    e: Expr                                                 }
    | { type: "if",     cond: Expr,      then: Expr,      else: Expr            }
    | { type: "let",    i: Identifier,   e: Expr,         in: Expr              }
    | { type: "letfun", i: Identifier,   arg: Identifier, body: Expr, in: Expr  }

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
function asBool(v: Value): boolean {
    if (typeof v !== "boolean")
        throw new EvalError(`value ${v} is not boolean`);
    return v;
}

function asNumber(v: Value): number {
    if (typeof v !== "number")
        throw new EvalError(`value ${v} is not number`);
    return v;
}

function asClosure(v: Value): Closure {
    if (v === null || typeof v !== "object")
        throw new EvalError(`value ${v} is not a closure`);
    return v;
}

/* fetch value from environment or error out */
function readValue(id: Identifier, env: Environment): Value {
    let val = env.read(id);
    if (val === undefined)
        throw new EvalError(`unbound variable '${id}'`);
    return val;
}

/* perform a binary op */
function binaryOp(op: BinOp, a: Value, b: Value): Value {
    switch (op) {
        case "add":
            return asNumber(a) + asNumber(b);
        case "sub":
            return asNumber(a) - asNumber(b);
        case "mul":
            return asNumber(a) * asNumber(b);
        case "and":
            return asBool(a) && asBool(b);
        case "lt":
            return asNumber(a) < asNumber(b);
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
            let fun = asClosure(evalExpr(expr.f, env));

            /* grab function's environment and assign the arg to its var */
            let newEnv = fun.env.with(fun.arg, evalExpr(expr.arg, env));

            /* evaluate function's body within the crafted environment */
            return evalExpr(fun.body, newEnv);
        }
        case "op":
            return binaryOp(expr.op, evalExpr(expr.a, env),
                            evalExpr(expr.b, env));
        case "not":
            return !asBool(evalExpr(expr.e, env));
        case "if": {
            let cond = asBool(evalExpr(expr.cond, env));
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
