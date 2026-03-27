/*
*   MiniImp optimization passes
*   by Andrea Riolo Vinciguerra
*/

import { Analysis,
         analyzeDefinedVars,
         analyzeLiveVars,
         analyzeReaching } from "./analysis";
import { RuntimeError } from "../errors";
import { BoolExpr, NumExpr } from "./engine";
import { ExitNode,
         Node,
         buildGraphMaps } from "./graph";

/* dead store elimination single pass. this takes an analyzed graph and uses its
 * live variables map to delete superfluous assignments. this overwrites
 * the graph and returns whether we deleted a node. if that's the case, we
 * need to re-run our analyses on the graph and re-do dse until there's
 * nothing else to optimize */
function dse(analy: Analysis): boolean {
    /* collect current graph snapshot and predecessors for every node */
    let { preds, allNodes } = buildGraphMaps(analy.graph);

    /* iterate over all nodes */
    for (const node of allNodes) {
        /* if this is not an assign node, we can't possibly delete it */
        if (node.type !== "assign")
            continue;

        /* if the assigned variable in this node IS NOT in the live variables
         * out set, we can safely delete this node. that means nobody
         * below us has requested the assigned variable */
        let liveOut = analy.liveVars.get(node)!.out;
        if (!liveOut.has(node.ast.i)) {
            /* we might need a fake skip to avoid having an empty graph */
            let fakeSkip: ExitNode = { type: "skip" };

            /* if this is the entry node but has no next, this is the ONLY
             * node in the graph. therefore, to avoid having an empty graph,
             * we employ the above fake skip */
            if (analy.graph.entry === node)
                analy.graph.entry = node.next ?? fakeSkip;

            /* we make strong assumptions based on how we structured the graph.
             * an assign node can't possibly have two predecessors, because
             * it is not a merge node. moreover, if the predecessor is a
             * conditional node, we know for sure that there's a merge node (a
             * fake skip) down the line, so we assume that node.next exists.
             * for now, just check that we have at most 1 predecessor */
            let predSet = preds.get(node) ?? new Set();
            if (predSet.size > 1)
                throw new RuntimeError("assign node has two predecessors");
            let pred: Node | undefined = predSet.values().next().value;

            /* if the predecessor exists, we check if it's a conditional node
             * or a normal node. in case of normal node, this might be linked
             * to an undefined node, ending the graph */
            if (pred) {
                if (pred.type === "cond") {
                    /* for a conditional pred, node.next must be true, because
                     * the chain must end in a fake skip anyway */
                    if (node.next === undefined)
                        throw new RuntimeError("conditional body is malformed");

                    /* set the next path */
                    if (pred.true === node)
                        pred.true = node.next;
                    else
                        pred.false = node.next;
                } else {
                    /* the standard predecessor of the assign node will either
                     * point to the next node or end the graph right here */
                    pred.next = node.next;

                    /* if the current node is the exit node, its only
                     * predecessor is a candidate for being the exit node,
                     * since it has an undefined next now (TODO: assert or
                     * trust the code) */
                    if (analy.graph.exit === node)
                        analy.graph.exit = pred as ExitNode;
                }
            } else {
                /* with no predecessor, we employ a fake skip if this is the
                 * last node of the graph */
                if (analy.graph.exit === node)
                    analy.graph.exit = fakeSkip;
            }

            /* the graph changed here. proceed no further, becuase the
             * precedessor map is now stale */
            return true;
        }
    }

    /* nothing changed, we have an optimized graph */
    return false;
}

/* this gives both the numeric expression and whether the graph was changed */
type NumMergeResult = {
    changed: boolean,
    expr: NumExpr,
};

/* quick helper to perform the arithmetic merge between two numeric
 * expressions */
function performArithmMerge(op: "add" | "sub" | "mul",
                            leftExpr: { type: "val" } & NumExpr,
                            rightExpr: { type: "val" } & NumExpr): NumMergeResult {
    /* calculate value based on operation */
    let v: number;
    switch (op) {
        case "add":
            v = leftExpr.v + rightExpr.v;
            break;
        case "sub":
            v = leftExpr.v - rightExpr.v;
            break;
        case "mul":
            v = leftExpr.v * rightExpr.v;
            break;
    }

    /* the merged thing */
    let newExpr: NumExpr = {
        type: "val",
        v,
        span: {
            start: leftExpr.span.start,
            end: rightExpr.span.end
        }
    }

    /* the graph has changed because we merged two expressions arithmetically */
    return {
        changed: true,
        expr: newExpr,
    };
}

/* return a plain node merge */
function mergeExpr(origExpr: { type: "add" | "sub" | "mul" } & NumExpr,
                   leftMerge: NumMergeResult,
                   rightMerge: NumMergeResult): NumMergeResult {
    /* extract expressions */
    const leftExpr = leftMerge.expr;
    const rightExpr = rightMerge.expr;

    /* extract numeric values for identity checks */
    let lVal = leftExpr.type === "val" ? leftExpr.v : undefined;
    let rVal = rightExpr.type === "val" ? rightExpr.v : undefined;

    /* based on the operation, we have different identities */
    switch (origExpr.type) {
        case "add": {
            /* for addition, either of them can be 0. we can just strip it
             * off */
            if (lVal === 0) {
                return {
                    changed: true,
                    expr: rightExpr
                };
            }
            if (rVal === 0) {
                return {
                    changed: true,
                    expr: leftExpr
                };
            }
            break;
        }
        case "sub": {
            /* for subtraction, we can only remove the right 0, since we don't
             * have a negate operation */
            if (rVal === 0) {
                return {
                    changed: true,
                    expr: leftExpr
                };
            }
            break;
        }
        case "mul": {
            /* for multiplication, 1 can be stripped off while the 0 turns
             * everything into a 0 (returning the node itself) */
            if (lVal === 1) {
                return {
                    changed: true,
                    expr: rightExpr
                };
            }
            if (rVal === 1) {
                return {
                    changed: true,
                    expr: leftExpr
                };
            }
            if (lVal === 0) {
                return {
                    changed: true,
                    expr: leftExpr
                };
            }
            if (rVal === 0) {
                return {
                    changed: true,
                    expr: rightExpr
                };
            }
            break;
        }
    }

    /* we need to perform an analysis for association. for example, if we
     * have 10 + (20 + x), we must turn it into (10 + 20) + x and
     * automatically fold into 30 + x. this is also valid for subtraction and
     * multiplication */
    if (origExpr.type === "mul") {
        if (lVal !== undefined && rightExpr.type === "mul") {
            let rightLeft = rightExpr.a;
            if (rightLeft.type === "val") {
                let newConst = lVal * rightLeft.v;
                return {
                    changed: true,
                    expr: {
                        type: "mul",
                        a: {
                            type: "val",
                            v: newConst,
                            span: leftExpr.span
                        },
                        b: rightExpr.b,
                        span: {
                            start: leftExpr.span.start,
                            end: rightExpr.span.end
                        }
                    }
                };
            }
        }
    } else if (origExpr.type === "add" || origExpr.type === "sub") {
        if (lVal !== undefined && (rightExpr.type === "add" ||
                                   rightExpr.type === "sub")) {
            let rightLeft = rightExpr.a;
            if (rightLeft.type === "val") {
                let newConst = origExpr.type === "add" ? lVal + rightLeft.v :
                                                         lVal - rightLeft.v;
                return {
                    changed: true,
                    expr: {
                        type: origExpr.type,
                        a: {
                            type: "val",
                            v: newConst,
                            span: leftExpr.span
                        },
                        b: rightExpr.b,
                        span: {
                            start: leftExpr.span.start,
                            end: rightExpr.span.end
                        }
                    }
                };
            }
        }
    }

    /* if both expressions are values, we can merge them */
    if (leftExpr.type === "val" && rightExpr.type === "val")
        return performArithmMerge(origExpr.type, leftExpr, rightExpr);

    /* if nothing was changed, don't spawn a new node but keep the original
     * AST nodes. this doesn't invalidate analysis maps and truly gives
     * meaning to "changed = false" */
    if (!leftMerge.changed && !rightMerge.changed) {
        return {
            changed: false,
            expr: origExpr
        };
    }

    /* the returned expression is the merge of the folded subexpressions.
     * a change was registered in either side (or both) */
    let newExpr: NumExpr = {
        type: origExpr.type,
        a: leftExpr,
        b: rightExpr,
        span: {
            start: leftExpr.span.start,
            end: rightExpr.span.end
        }
    };

    /* carry the changed over from the subexpressions */
    return {
        changed: true,
        expr: newExpr,
    };
}

/* this helper will fold a numeric expression, leaving variables as they are */
function foldNumExpr(expr: NumExpr): NumMergeResult {
    switch (expr.type) {
        case "id":
        case "val":
            /* in case of an identifier or a value, we must pass them
             * through */
            return { changed: false, expr };
        case "add":
        case "sub":
        case "mul": {
            /* get the two inner expressions */
            let leftMerge = foldNumExpr(expr.a);
            let rightMerge = foldNumExpr(expr.b);

            /* merge them with this helper */
            return mergeExpr(expr, leftMerge, rightMerge);
        }
    }
}

/* this gives both the boolean expression and whether the graph was changed */
type BoolMergeResult = {
    changed: boolean,
    expr: BoolExpr,
};

/* this helper will fold a boolean expression, leaving variables as they are.
 * TODO: this is ugly and should be refactored like foldNumExpr */
function foldBoolExpr(expr: BoolExpr): BoolMergeResult {
    switch (expr.type) {
        case "val":
            /* value passes through */
            return { changed: false, expr };
        case "and": {
            /* get the two boolean expressions */
            let leftMerge = foldBoolExpr(expr.a);
            let rightMerge = foldBoolExpr(expr.b);

            /* extract the values */
            let lVal = leftMerge.expr.type === "val" ?
                leftMerge.expr.v : undefined;
            let rVal = rightMerge.expr.type === "val" ?
                rightMerge.expr.v : undefined;

            /* if any of these is false, the whole expr is false */
            if (lVal === false) {
                return {
                    changed: true,
                    expr: leftMerge.expr
                };
            }
            if (rVal === false) {
                return {
                    changed: true,
                    expr: rightMerge.expr
                }
            }

            /* if any of these is true, the ball's in the other court */
            if (lVal === true) {
                return {
                    changed: true,
                    expr: rightMerge.expr
                };
            }
            if (rVal === true) {
                return {
                    changed: true,
                    expr: leftMerge.expr
                };
            }

            /* if none of the above, we check to see if subexprs have changed
             * and if they did, we merge them */
            if (!leftMerge.changed && !rightMerge.changed) {
                return {
                    changed: false,
                    expr
                };
            }

            /* merge the two subexprs (either or both have changed) */
            return {
                changed: true,
                expr: {
                    type: "and",
                    a: leftMerge.expr,
                    b: rightMerge.expr,
                    span: {
                        start: leftMerge.expr.span.start,
                        end: rightMerge.expr.span.end
                    }
                }
            }
        }
        case "not": {
            /* get the boolean expr */
            let subMerge = foldBoolExpr(expr.e);

            /* if subexpr is a value, perform negation */
            if (subMerge.expr.type === "val") {
                return {
                    changed: true,
                    expr: {
                        type: "val",
                        v: !subMerge.expr.v,
                        span: expr.span
                    }
                };
            }

            /* pass through expression if nothing changed */
            if (!subMerge.changed) {
                return {
                    changed: false,
                    expr
                };
            }

            /* passthrough changed subexprs */
            return {
                changed: true,
                expr: {
                    type: "not",
                    e: subMerge.expr,
                    span: {
                        start: expr.span.start,
                        end: subMerge.expr.span.end,
                    }
                }
            };
        }
        case "lt": {
            /* get the sub num expressions */
            let leftMerge = foldNumExpr(expr.a);
            let rightMerge = foldNumExpr(expr.b);

            /* if they are raw values, calculate value immediately */
            if (leftMerge.expr.type === "val" &&
                    rightMerge.expr.type === "val") {
                return {
                    changed: true,
                    expr: {
                        type: "val",
                        v: leftMerge.expr.v < rightMerge.expr.v,
                        span: {
                            start: leftMerge.expr.span.start,
                            end: rightMerge.expr.span.end
                        }
                    }
                };
            }

            /* carry on the original exprs */
            if (!leftMerge.changed && !rightMerge.changed) {
                return {
                    changed: false,
                    expr
                };
            }

            /* or propagate the changes */
            return {
                changed: true,
                expr: {
                    type: "lt",
                    a: leftMerge.expr,
                    b: rightMerge.expr,
                    span: {
                        start: leftMerge.expr.span.start,
                        end: rightMerge.expr.span.end
                    }
                }
            };
        }
    }
}

/* constant folding. this folds ALL the nodes, so a second pass should
 * return false. this is because graph is never touched, only the inner AST */
function constFold(analy: Analysis): boolean {
    /* collect current graph snapshot and predecessors for every node */
    let { allNodes } = buildGraphMaps(analy.graph);

    /* iterate over all nodes */
    let changed = false;
    for (const node of allNodes) {
        /* for assign nodes, fold their numeric expression */
        if (node.type === "assign") {
            /* try replacing a single node */
            let merge = foldNumExpr(node.ast.e);
            node.ast.e = merge.expr;
            changed ||= merge.changed;
        } else if (node.type === "cond") {
            /* for cond nodes, fold their conditional expression */
            let merge = foldBoolExpr(node.ast.cond);
            node.ast.cond = merge.expr;
            changed ||= merge.changed;
        }
    }

    return changed;
}

export function doConstFold(analy: Analysis): boolean {
    /* just perform a single pass */
    return constFold(analy);
}

export function doDSE(analy: Analysis): boolean {
    /* we'll return whether optimization actually changed somehing */
    let changed = false;

    /* mutate graph until we squashed every last bit of DSE */
    while (dse(analy)) {
        changed = true;
        analy.definedVars = analyzeDefinedVars(analy.graph, analy.in);
        analy.liveVars = analyzeLiveVars(analy.graph, analy.out);
        analy.reachingDefs = analyzeReaching(analy.graph, analy.in);
    }

    return changed;
}

/* take an analyzed graph and optimize it with all possible passes */
export default function optimize(analy: Analysis): boolean {
    /* we'll return whether optimization actually changed somehing */
    let changed = false;

    /* perform all steps as long as we get a change */
    do {
        /* changed = step1() || step2() || step3() || ... */
        let changedDSE = doDSE(analy);
        let changedCF = doConstFold(analy);
        changed = changedDSE || changedCF;
    } while (changed);

    return changed;
}
