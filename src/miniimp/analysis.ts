/*
*   MiniImp control flow graph analysis
*   by Andrea Riolo Vinciguerra
*/

import { Identifier } from "./engine";
import { Graph, Node } from "./graph";
import { RuntimeError } from "../errors";

/* various tags for enabling optimizations */
type DefinedVars = { in: Set<Identifier>, out: Set<Identifier> };

/* a queue is needed for the work queue approach. this queue is special
 * because it keeps insertion order intact and at the same time disallows
 * double insertion of the same element */
export interface UniQueue<T> {
    enqueue(item: T): void;
    dequeue() : T | undefined;
    peek() : T | undefined;
    size(): number;
}

/* get an example queue. javascript's Set guarantees to keep the order of
 * insertion, so it acts as a perfect uniqueue already */
function newQueue<T>(): UniQueue<T> {
    let set: Set<T> = new Set();
    return {
        enqueue: function(item: T) {
            set.add(item);
        },
        dequeue: function() {
            /* get a possible first entry */
            let first = this.peek();

            /* if it exists, delete it from the set */
            if (first)
                set.delete(first);

            /* return the entry */
            return first;
        },
        peek: function() {
            /* peek an entry. might not exist */
            return set.values().next().value;
        },
        size: function() {
            return set.size;
        }
    }
}

/* this helper will scan the graph and build utility maps that can be
 * used in analyses. for example, among the others, a map of the predecessors
 * for every node */
function buildGraphMaps(graph: Graph) {
    /* these are the maps */
    let preds = new Map<Node, Set<Node>>();
    let succs = new Map<Node, Set<Node>>();
    let visited = new Set<Node>();

    /* little dfs to traverse the whole graph */
    function traverse(node: Node) {
        /* prevent cyclical traverse */
        if (visited.has(node))
            return;
        visited.add(node);

        /* quick lambda to add an edge between two nodes. this affects the
         * preds set of the next node (to) and the succs set of ourselves
         * (from) */
        const addEdge = (from: Node, to: Node) => {
            /* init sets first */
            if (!succs.has(from))
                succs.set(from, new Set());
            if (!preds.has(to))
                preds.set(to, new Set());

            /* link the two nodes */
            succs.get(from)!.add(to);
            preds.get(to)!.add(from);
        }

        /* if it's a conditional, we have 2 possible branches */
        if (node.type === "cond") {
            /* add the edges to its 2 branches */
            addEdge(node, node.true);
            addEdge(node, node.false);

            /* keep traversing down */
            traverse(node.true);
            traverse(node.false);
        } else if (node.next) {
            /* add the edge to its only branch */
            addEdge(node, node.next);

            /* keep traversing down */
            traverse(node.next);
        }
    }

    /* traverse the entry and return the structures */
    traverse(graph.entry);
    return { preds, succs, allNodes: visited };
}

/* this helper will intersect two sets where one is optional, indicating
 * a universal set */
function intersect<T>(s1: Set<T>, s2: Set<T> | undefined) : Set<T>{
    /* if the second set is the universal set, passthrough s1 */
    if (!s2)
        return s1;

    /* start from s1 and remove nodes that don't exist in s2 */
    let ret = new Set(s1);
    for (const node of s1) {
        if (!s2.has(node))
            ret.delete(node);
    }

    return ret;
}

/* Gen(b) = variables defined in the block.
 * it is relatively straightforward in a minimal graph */
function gen(node: Node): Set<Identifier> {
    if (node.type === "assign")
        return new Set([node.ast.i]);
    return new Set();
}

/* this function will map each block to its defined vars */
export function analyzeDefinedVars(graph: Graph)
        : Map<Node, DefinedVars> {
    /* fetch the utility maps from this graph */
    let { preds, succs, allNodes } = buildGraphMaps(graph);

    /* utility type to define a DefinedVars struct that accepts an undefined
     * set to represent the universal set */
    type AlmostDefinedVars = Omit<DefinedVars, "out"> &
        { out: Set<Identifier> | undefined };

    /* the map so far. this map accepts an AlmostDefinedVars */
    let map = new Map<Node, AlmostDefinedVars>();

    /* we employ a BFS with a work queue to continuously ripple changes until
     * we reach the fixpoint */
    let wq = newQueue<Node>();

    /* initialize the map to prevent crashes when fetching state for
     * predecessors. also, enqueue all nodes in the work queue */
    for (const node of allNodes) {
        /* TOOD: entry node should have its input variable set!!!!!!!! */
        map.set(node, { in: new Set(), out: undefined });
        wq.enqueue(node);
    }

    /* start iterating */
    while (wq.size() > 0) {
        /* current node */
        let cur = wq.dequeue()!;

        /* initialize state if it doesn't exist */
        let state: AlmostDefinedVars = map.has(cur) ? map.get(cur)!
            : { in: new Set(), out: undefined };

        /* build defIn from predecessors. this is the intersection between
         * our current defIn and all the defOut of our predecessors */
        let newIn: Set<Identifier> | undefined = undefined;
        for (const pred of preds.get(cur) ?? new Set()) {
            /* predecessor surely has data in the map */
            let predOut = map.get(pred)!.out;
            if (newIn === undefined)
                newIn = new Set(predOut);
            newIn = intersect(newIn, predOut);
        }

        /* if newIn doesn't exist, it means we don't have previous nodes.
         * in such case, defIn is the empty set */
        state.in = newIn ?? new Set();

        /* build defOut with gen() function unified with current defIn */
        let newOut: Set<Identifier> = new Set(state.in);
        for (const generatedVar of gen(cur))
            newOut.add(generatedVar);

        /* see if there was a change in the newOut */
        let changed = false;
        if (state.out === undefined || newOut.size !== state.out.size) {
            changed = true;
        } else {
            /* check items one by one */
            for (const item of newOut) {
                if (!state.out.has(item)) {
                    changed = true;
                    break;
                }
            }
        }

        /* if there was a change, set the newOut to our out variables and
         * ripple the changes to the successors */
        if (changed) {
            state.out = newOut;
            for (const succ of succs.get(cur) ?? new Set())
                wq.enqueue(succ);
        }
    }

    /* do a round of assertions and return map */
    for (const [_, definedVars] of map.entries()) {
        if (definedVars.out === undefined)
            throw new RuntimeError("out vars of node is the universal set");
    }
    return map as Map<Node, DefinedVars>;
}
