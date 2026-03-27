/*
*   MiniImp optimization passes
*   by Andrea Riolo Vinciguerra
*/

import { Analysis,
         analyzeDefinedVars,
         analyzeLiveVars,
         analyzeReaching } from "./analysis";
import { RuntimeError } from "../errors";
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
         * out set, we can safely delete this node */
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

/* take an analyzed graph and optimize it  */
export default function optimize(analy: Analysis): boolean {
    /* we'll return whether optimization actually changed somehing */
    let changed = false;

    /* mutate graph until optimization is complete (TODO: DSE only for now) */
    while (dse(analy)) {
        changed = true;
        analy.definedVars = analyzeDefinedVars(analy.graph, analy.in);
        analy.liveVars = analyzeLiveVars(analy.graph, analy.out);
        analy.reachingDefs = analyzeReaching(analy.graph, analy.in);
    }

    return changed;
}
