/*
*   MiniFun language type system
*   by Andrea Riolo Vinciguerra
*/

import { Expr, Identifier, TypeLabel } from "./engine";
import { DiagnosticError, SourceSpan } from "./diag";
import { RuntimeError } from "../errors";

/* a single well-defined type (possibly generic) */
export type MonoType =
    /* scalar types */
    | { type: "int" }
    | { type: "bool" }

    /* we choose a string for simplicity, but should be TypeIdentifier */
    | { type: "var", name: string }
    | { type: "fun", arg: MonoType, ret: MonoType };

/* either a monotype or a polytype waiting to be assigned a type */
export type PolyType = {
    bound: Set<string>,
    mono: MonoType
};

/* type context. _very_ similar to engine's Environment. it supports
 * querying the lits of type vars (by name) for generalizing */
export interface Context {
    /* add a new variable and return the new context */
    with(tvar: Identifier, type: PolyType): Context;

    /* read the latest variable available or bail out */
    read(tvar: Identifier): PolyType | undefined;

    /* return the list of the currently defined variables */
    iter(): IterableIterator<[Identifier, PolyType]>;

    /* sugary syntax */
    [Symbol.iterator](): IterableIterator<[Identifier, PolyType]>;

    /* return an empty context for duplication */
    empty(): Context;
};

/* a substitution instances a type variable to a monotype */
export type Substitution = Map<string, MonoType>;

/* we can reuse the empty subst object rather than creating it everytime */
const emptySubst: Substitution = new Map<string, MonoType>();

/* generator of fresh variables */
interface FreshVarFactory {
    freshVar(): string;
    freshMonoVar(): MonoType;
};
function freshVarFactory(): FreshVarFactory {
    let typeVarCounter = 0;
    return {
        freshVar: function(): string {
            return `t${typeVarCounter++}`;
        },
        freshMonoVar: function(): MonoType {
            return { type: "var", name: this.freshVar() };
        }
    }
}

/* quickly convert a type annotation into a monotype */
function labelToMono(label: TypeLabel): MonoType {
    switch (label.type) {
        case "int":
            return { type: "int" };
        case "bool":
            return { type: "bool" };
        case "fun":
            return {
                type: "fun",
                arg: labelToMono(label.arg),
                ret: labelToMono(label.ret)
            };
    }
}

/* apply a substitution to a monotype. this will traverse the monotype tree
 * to properly substitute every instance of the type variables. also, it
 * recursively follows every link until it can or cannot reach a scalar type */
function applySubstMono(s: Substitution, t: MonoType): MonoType {
    switch (t.type) {
        case "int":
        case "bool":
            /* scalar types are our base case */
            return t;
        case "var":
            /* either perform a substitution step or stop here */
            return s.has(t.name) ? applySubstMono(s, s.get(t.name)!) : t;
        case "fun":
            /* if it's a function, apply recursively to argument and
             * return type */
            return {
                type: "fun",
                arg: applySubstMono(s, t.arg),
                ret: applySubstMono(s, t.ret)
            };
    }
}

/* apply a substitution to a polytype. here, we need to replace all
 * type variables in the substitution set THAT ARE NOT bound!!! */
function applySubstPoly(s: Substitution, p: PolyType): PolyType {
    let cleanSubst: Substitution = new Map(s);
    for (const boundVar of p.bound)
        cleanSubst.delete(boundVar);
    return {
        bound: p.bound,
        mono: applySubstMono(cleanSubst, p.mono)
    }
}

/* apply a substitution to a whole context. here we just apply the
 * substitution to every polytype we find in the context */
function applySubstCtx(s: Substitution, ctx: Context): Context {
    let newCtx: Context = ctx.empty();
    for (const [id, poly] of ctx)
        newCtx = newCtx.with(id, applySubstPoly(s, poly));
    return newCtx;
}

/* return a composited substitution by chaining multiple substitutions.
 * example: composeSubst(s4, s3, s2, s1) = s4(s3(s2(s1))) */
function composeSubst(...substs: Substitution[]): Substitution {
    /* base cases: nothing to compose */
    if (substs.length === 0)
        return emptySubst;
    if (substs.length === 1)
        return substs[0]!;

    /* grab first two substitutions in the chain */
    let s2 = substs[0]!;
    let s1 = substs[1]!;
    let ret: Substitution = new Map();

    /* first add S1 substitutions "substituted" by S2 */
    for (const [k, v] of s1.entries())
        ret.set(k, applySubstMono(s2, v));

    /* add the remaining S2 substitutions as they are */
    for (const [k, v] of s2.entries()) {
        if (!ret.has(k))
            ret.set(k, v);
    }

    /* if we only had two, we are done */
    if (substs.length === 2)
        return ret;

    /* recursively fold the newly composed substitution with the rest
     * of the chain */
    return composeSubst(ret, ...substs.slice(2));
}

/* get all the free variables in a monotype. all type variables are free
 * variables in a monotype. recursive traverse is needed */
function freeVarsMono(t: MonoType): Set<string> {
    switch (t.type) {
        case "int":
        case "bool":
            return new Set();
        case "var":
            return new Set([t.name]);
        case "fun": {
            /* for a function, unify the two sets */
            let set = freeVarsMono(t.arg);
            for (const v of freeVarsMono(t.ret))
                set.add(v);
            return set;
        }
    }
}

/* get the free variables in a polytype. we need to delete the type vars that
 * are bound in the polytype */
function freeVarsPoly(p: PolyType): Set<string> {
    let free = freeVarsMono(p.mono);
    for (const boundVar of p.bound)
        free.delete(boundVar);
    return free;
}

/* get all the free vars for all the polytypes in our context */
function freeVarsCtx(ctx: Context): Set<string> {
    let free = new Set<string>();
    for (const [_, poly] of ctx) {
        for (const v of freeVarsPoly(poly))
            free.add(v);
    }
    return free;
}

/* inst function: replace all bound variables in the polytype with a fresh type
 * variable and return the resulting monotype. to replace all instances of
 * a type variable inside the monotype, we can apply a substitution, which will
 * recursively traverse monotype tree. this will strip bound variables away
 * while keeping the algorithm safe by allocating new fresh names */
function inst(poly: PolyType, factory: FreshVarFactory): MonoType {
    let subst: Substitution = new Map();
    for (const boundVar of poly.bound)
        subst.set(boundVar, factory.freshMonoVar());
    return applySubstMono(subst, poly.mono);
}

/* generalize a monotype by converting type variables NOT IN CONTEXT into
 * generic bound variables within the resulting polytype */
function gener(ctx: Context, t: MonoType): PolyType {
    let varsInCtx = freeVarsCtx(ctx);
    let varsInMono = freeVarsMono(t);

    let bound = new Set<string>();
    for (const tvar of varsInMono) {
        if (!varsInCtx.has(tvar))
            bound.add(tvar);
    }
    return { bound, mono: t };
}

/* unify function. given two monotypes, try to unify the two types by
 * adding constraints to the existing type variables. if this is not possible,
 * the type check fails */
function unify(t1: MonoType, t2: MonoType, span: SourceSpan): Substitution {
    /* if both are scalar types, no subst is required */
    if (t1.type === "bool" && t2.type === "bool")
        return emptySubst;
    if (t1.type === "int" && t2.type === "int")
        return emptySubst;

    /* identical type variables is empty
     * unify(a, a) = {} */
    if (t1.type === "var" && t2.type === "var" && t1.name === t2.name)
        return emptySubst;

    /* variable binding
     * unify (a, int) = {a -> int}, or unify(a, b) = {a -> b} */
    if (t1.type === "var")
        return bindVar(t1.name, t2, span);
    if (t2.type === "var")
        return bindVar(t2.name, t1, span);

    /* function unification */
    if (t1.type === "fun" && t2.type === "fun") {
        /* unify the arg, then the ret, finally compose the constraints */
        let s1 = unify(t1.arg, t2.arg, span);
        let s2 = unify(applySubstMono(s1, t1.ret),
                       applySubstMono(s1, t2.ret), span);
        return composeSubst(s2, s1);
    }

    /* incompatible types
     * unify(int, bool) = ERROR */
    throw new DiagnosticError(
        `cannot unify types: ${formatType(t1)} and ${formatType(t2)}`,
        span
    );
}

/* unify or throw a diagnostic error with custom msg (could be inside
 * unify itself?) */
function unify_or_error(t1: MonoType, t2: MonoType, span: SourceSpan,
                        msg: string, ...notes: string[]): Substitution {

    try {
        return unify(t1, t2, span);
    } catch (err: any) {
        if (err instanceof DiagnosticError) {
            err.msg = msg;
            for (const note of notes)
                err.notes.push(note);
        }
        throw err;
    }
}

/* return a substitution where a particular type variable 'name' becomes
 * monotype 't'. this function checks for potential infinite loops, in the
 * case where the monotype references the var itself */
function bindVar(name: string, t: MonoType, span: SourceSpan): Substitution {
    if (freeVarsMono(t).has(name))
        throw new DiagnosticError(
            `infinite type error: ${name} occurs ` +
                `recursively in ${formatType(t)}`,
            span,
            [ `The type of variable depends on itself, which is forbidden` ]
        );
    return new Map([[name, t]]);
}

/* helper to generate 'a', 'b', 'c', ... variable names */
function getGenericName(index: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    let letter = alphabet[index % 26]!;
    let suffix = Math.floor(index / 26);
    return suffix > 0 ? `${letter}${suffix}` : letter;
}

/* extract all variables from an expression. this is needed to dynamically
 * add variable notes to an error */
function extractVars(expr: Expr): Set<string> {
    let vars = new Set<string>();
    switch (expr.type) {
        case "id":
            vars.add(expr.i);
            break;
        case "op":
            extractVars(expr.a).forEach(v => vars.add(v));
            extractVars(expr.b).forEach(v => vars.add(v));
            break;
        case "call":
            extractVars(expr.f).forEach(v => vars.add(v));
            extractVars(expr.arg).forEach(v => vars.add(v));
            break;
        case "if":
            extractVars(expr.cond).forEach(v => vars.add(v));
            extractVars(expr.then).forEach(v => vars.add(v));
            extractVars(expr.else).forEach(v => vars.add(v));
            break;
        case "fun":
            extractVars(expr.body).forEach(v => vars.add(v));
            break;
        case "not":
            extractVars(expr.e).forEach(v => vars.add(v));
            break;
        case "let":
            extractVars(expr.e).forEach(v => vars.add(v));
            extractVars(expr.in).forEach(v => vars.add(v));
            break;
        case "letfun":
            extractVars(expr.body).forEach(v => vars.add(v));
            extractVars(expr.in).forEach(v => vars.add(v));
            break;
    }
    return vars;
}

/* quickly get a list of notes for all the variables defined */
function getVariableNotes(expr: Expr, ctx: Context): string[] {
    let ret: string[] = [];
    for (const id of extractVars(expr)) {
        let content = ctx.read(id);
        if (content === undefined)
            continue;
        ret.push(`Variable '${id}' is: ${formatType(content)}`);

    }
    return ret;
}

/* return a string representation of a polytype */
export function formatType(t: MonoType | PolyType,
                           varMap: Map<string, string> = new Map()): string {
    if ("bound" in t) {
        /* create a fresh dictionary for this polytype's bound variables */
        let newVarMap = new Map(varMap);
        let counter = 0;

        /* assign letter to each bound variable */
        for (const boundVar of t.bound) {
            if (!newVarMap.has(boundVar))
                newVarMap.set(boundVar, getGenericName(counter++));
        }

        /* format the quantiier string */
        let boundStr = "";
        if (t.bound.size > 0) {
            let displayVars = Array.from(t.bound).map(v => newVarMap.get(v));
            boundStr = `∀${displayVars.join(" ")}. `;
        }

        /* format the inner monotype using our new dictionary */
        return boundStr + formatType(t.mono, newVarMap);
    }

    switch (t.type) {
        case "int":
            return "int";
        case "bool":
            return "bool";
        case "var":
            /* use the mapped letter if it's a bound generic, else keep
             * original */
            return varMap.get(t.name) || "generic";
        case "fun":
            /* pass the map down the tree */
            let argStr = t.arg.type === "fun" ? `(${formatType(t.arg, varMap)})` :
                formatType(t.arg, varMap);
            return `${argStr} -> ${formatType(t.ret, varMap)}`;
    }
}

export function validateExpr(expr: Expr, ctx: Context,
                             factory: FreshVarFactory)
                             : { subst: Substitution, mono: MonoType } {
    switch (expr.type) {
        case "val": {
            if (typeof expr.v === "number")
                return { subst: emptySubst, mono: { type: "int" }};
            if (typeof expr.v === "boolean")
                return { subst: emptySubst, mono: { type: "bool" }};

            /* this is unreachable. if we end up here, the parser didn't
             * do its job correctly */
            throw new RuntimeError(`unknown literal type '${expr.v}`);
        }
        case "id": {
            let poly = ctx.read(expr.i);
            if (poly === undefined)
                throw new DiagnosticError(
                    `unbound variable '${expr.i}'`,
                    expr.span,
                    [ "Define your variables before using them!" ]
                );
            return { subst: emptySubst, mono: inst(poly, factory) };
        }
        case "fun": {
            /* use annotation if provided, else fresh var */
            let argType = expr.argType ? labelToMono(expr.argType) :
                factory.freshMonoVar();
            let newCtx = ctx.with(expr.arg, { bound: new Set(), mono: argType });

            /* validate the function body in the new context */
            let { subst: s1, mono: retType } = validateExpr(expr.body, newCtx,
                                                            factory);
            /* apply substitution to argument type */
            return {
                subst: s1,
                mono: {
                    type: "fun",
                    arg: applySubstMono(s1, argType),
                    ret: retType
                }
            }
        }
        case "call": {
            /* first argument */
            let { subst: s1, mono: t1 } = validateExpr(expr.f, ctx, factory);

            /* second argument */
            let { subst: s2, mono: t2 } = validateExpr(expr.arg,
                                            applySubstCtx(s1, ctx), factory);

            /* generate a new return type */
            let retType = factory.freshMonoVar();

            /* try to unify called function type with argument passed + fresh
             * return type */
            let s3 = unify_or_error(
                applySubstMono(s2, t1),
                { type: "fun", arg: t2, ret: retType },
                expr.span,
                `type mismatch in function call`,
                `Function inferred as: ${formatType(applySubstMono(s2, t1))}`,
                `Argument inferred as: ${formatType(t2)}`
           );

            /* return type as per algorithm W rules */
            return {
                subst: composeSubst(s3, s2, s1),
                mono: applySubstMono(s3, retType)
            };
        }
        case "op": {
            /* first argument */
            let { subst: s1, mono: t1 } = validateExpr(expr.a, ctx, factory);

            /* second argument */
            let { subst: s2, mono: t2 } = validateExpr(expr.b,
                                            applySubstCtx(s1, ctx), factory);

            /* depending on the operation, we expect an arg and a return val */
            let expectedArgType: MonoType = { type: "int" };
            let retType: MonoType = { type: "int" };
            if (expr.op === "and") {
                expectedArgType = { type: "bool" };
                retType = { type: "bool" };
            } else if (expr.op === "lt") {
                retType = { type: "bool" };
            }

            /* unify left argument */
            let s3 = unify_or_error(
                applySubstMono(s2, t1),
                expectedArgType,
                expr.a.span,
                `left operand of '${expr.op}' has incorrect type`,
                `Expected: ${formatType(expectedArgType)}, got: ` +
                    `${formatType(applySubstMono(s2, t1))}`,
                ...getVariableNotes(expr.a, ctx)
            );

            /* unify right argument */
            let s4 = unify_or_error(
                applySubstMono(s3, t2),
                expectedArgType,
                expr.b.span,
                `right operand of '${expr.op}' has incorrect type`,
                `Expected: ${formatType(expectedArgType)}, got: ` +
                    `${formatType(applySubstMono(s3, t2))}`,
                ...getVariableNotes(expr.b, ctx)
            );

            /* return composition of all substitutions */
            return {
                subst: composeSubst(s4, s3, s2, s1),
                mono: retType
            }
        }
        case "not": {
            /* unify arg with bool */
            let { subst: s1, mono: t1 } = validateExpr(expr.e, ctx, factory);

            /* try to unify type as bool */
            let s2 = unify_or_error(
                t1,
                { type: "bool" },
                expr.e.span,
                `logical NOT (~) requires a boolean operand`,
                `Operand inferred as: ${formatType(t1)}`,
                ...getVariableNotes(expr.e, ctx)
            );

            return {
                subst: composeSubst(s2, s1),
                mono: { type: "bool" }
            };
        }
        case "if": {
            /* first argument */
            let { subst: s1, mono: t1 } = validateExpr(expr.cond, ctx, factory);

            /* second argument */
            let { subst: s2, mono: t2 } = validateExpr(expr.then,
                                            applySubstCtx(s1, ctx), factory);

            /* third argument
             * TODO: check for slides error. S2S1CTX must be validated, not
             * S2CTX. indeed, it crashes with this program:
             * let myfun = fun x => if (x 0 < 1) then 0 else (x + 1) in
             * myfun (fun x => 2)
             * value [object Object] is not number */
            let { subst: s3, mono: t3 } = validateExpr(expr.else,
                            applySubstCtx(composeSubst(s2, s1), ctx), factory);

            /* unify condition with bool */
            let s4 = unify_or_error(
                applySubstMono(composeSubst(s3, s2), t1),
                { type: "bool" },
                expr.cond.span,
                `condition of 'if' must be boolean`,
                `Condition inferred as: ` +
                    `${formatType(applySubstMono(composeSubst(s3, s2), t1))}`,
                ...getVariableNotes(expr.cond, ctx)
            );

            /* unify then and else (they must be of same type) */
            let s5 = unify_or_error(
                applySubstMono(composeSubst(s4, s3), t2),
                applySubstMono(s4, t3),
                expr.span,
                `branches of 'if' must return the same type`,
                `'then' branch inferred as: ` +
                    `${formatType(applySubstMono(composeSubst(s4, s3), t2))}`,
                `'else' branch inferred as: ${formatType(applySubstMono(s4, t3))}`,
                ...getVariableNotes(expr.then, ctx),
                ...getVariableNotes(expr.else, ctx)
            )

            /* return as per algorithm W rules */
            return {
                subst: composeSubst(s5, s4, s3, s2, s1),
                mono: applySubstMono(composeSubst(s5, s4), t3)
            };
        }
        case "let": {
            /* first argument (the expression to be assigned) */
            let { subst: s1, mono: t1 } = validateExpr(expr.e, ctx, factory);

            /* generate a new context where the argument identifier is
             * assigned the generalized polytype of the expression t1. */
            let newCtx = applySubstCtx(s1, ctx);
            newCtx = newCtx.with(expr.i, gener(newCtx, t1));

            /* the let body with the new context. the argument may be
             * instantited if its polytype has bound variables (generics) */
            let { subst: s2, mono: t2 } = validateExpr(expr.in, newCtx, factory);

            /* return let body return type t2, with the substitutions */
            return {
                subst: composeSubst(s2, s1),
                mono: t2
            };
        }
        case "letfun": {
            /* fresh variables for recursive function and its argument */
            let freshF = factory.freshMonoVar();
            let freshArg = factory.freshMonoVar();

            /* extend the context and check body of the function */
            let ctx1 = ctx.with(expr.i, { bound: new Set(), mono: freshF });
            ctx1 = ctx1.with(expr.arg, { bound: new Set(), mono: freshArg });
            let { subst: s1, mono: t1 } = validateExpr(expr.body, ctx1, factory);

            /* unify variable for f with its expected function type */
            let expectedFun: MonoType = {
                type: "fun",
                arg: applySubstMono(s1, freshArg),
                ret: t1
            };
            let s2 = unify_or_error(
                applySubstMono(s1, freshF),
                expectedFun,
                expr.span,
                `recursive function '${expr.i}' has inconsistent internal types`,
                ...getVariableNotes(expr, ctx)
            );

            /* we must make sure that the expected function type unifies with our
             * type annotation, combining the resulting substitutions */
            if (expr.retType) {
                let annotatedType = labelToMono(expr.retType);
                let sLabel = unify_or_error(
                    expectedFun,
                    annotatedType,
                    expr.span,
                    `function body does not match type annotation`,
                    `Annotated type: ${formatType(labelToMono(expr.retType))}`,
                    `Inferred type: ${formatType(expectedFun)}`,
                    ...getVariableNotes(expr, ctx)
                );
                s2 = composeSubst(sLabel, s2);
            }

            /* check the body of the let */
            let s2s1 = composeSubst(s2, s1);
            let ctx2 = applySubstCtx(s2s1, ctx);
            ctx2 = ctx2.with(expr.i, { bound: new Set(),
                                       mono: applySubstMono(s2s1, freshF) });
            let { subst: s3, mono: t2 } = validateExpr(expr.in, ctx2, factory);

            /* return as per algorithm W rules */
            return {
                subst: composeSubst(s3, s2s1),
                mono: t2
            };
        }
    }
}

export default function checkProg(expr: Expr): PolyType {
    let context = new class CtxImpl implements Context {
        private map: Map<Identifier, PolyType>;

        constructor(map: Map<Identifier, PolyType>) {
            this.map = map;
        }

        with(tvar: Identifier, type: PolyType): Context {
            /* shallow copy of map */
            let newMap = new Map(this.map);
            newMap.set(tvar, type);
            return new CtxImpl(newMap);
        }

        read(tvar: Identifier): PolyType | undefined {
            return this.map.get(tvar);
        }

        iter(): IterableIterator<[Identifier, PolyType]> {
            return this.map.entries();
        }

        [Symbol.iterator](): IterableIterator<[Identifier, PolyType]> {
            return this.map.entries();
        }

        empty(): Context {
            return new CtxImpl(new Map());
        }
    }(new Map());

    let { subst, mono } = validateExpr(expr, context, freshVarFactory());
    return gener(context.empty(), applySubstMono(subst, mono));
}
