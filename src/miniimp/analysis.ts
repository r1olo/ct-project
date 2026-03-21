/*
*   MiniImp control flow graph analysis
*   by Andrea Riolo Vinciguerra
*/

import { Identifier, stringifyNum, stringifyBool } from "./engine";
import { Graph, Node, graphToDOT } from "./graph";
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
function intersect<T>(s1: Set<T>, s2: Set<T> | undefined) : Set<T> {
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
export function analyzeDefinedVars(graph: Graph, input: Identifier)
        : Map<Node, DefinedVars> {
    /* fetch the utility maps from this graph */
    let { preds, succs, allNodes } = buildGraphMaps(graph);

    /* utility type to define a DefinedVars struct that accepts undefined sets
     * to indicate that they are yet uninitialized. (you may picture an
     * undefined set as the "universal" set) */
    type AlmostDefinedVars = Omit<DefinedVars, "in" | "out"> &
        { in: Set<Identifier> | undefined, out: Set<Identifier> | undefined };

    /* the map so far. this map accepts an AlmostDefinedVars */
    let map = new Map<Node, AlmostDefinedVars>();

    /* we employ a BFS with a work queue to continuously ripple changes until
     * we reach the fixpoint */
    let wq = newQueue<Node>();

    /* initialize the map to prevent crashes when fetching state for
     * predecessors. everybody has undefined sets as initialization values.
     * also, enqueue all nodes in the work queue */
    for (const node of allNodes) {
        /* entry node must be tagged with input variable */
        if (node === graph.entry) {
            map.set(node, { in: new Set([input]), out: new Set([input]) });
        } else {
            map.set(node, { in: undefined, out: undefined });
        }
        wq.enqueue(node);
    }

    /* start iterating */
    while (wq.size() > 0) {
        /* current node */
        let cur = wq.dequeue()!;

        /* get state, which surely exists due to our initialization before */
        let state: AlmostDefinedVars = map.get(cur)!;

        /* build defIn from predecessors. this is the intersection between
         * our current defIn and all the defOut of our predecessors */
        let newIn: Set<Identifier> | undefined = state.in;
        for (const pred of preds.get(cur) ?? new Set()) {
            /* predecessor surely has data in the map. if, however, it is
             * undefined, it is the universal set. we can continue */
            let predOut = map.get(pred)!.out;
            if (predOut === undefined)
                continue;
            newIn = intersect(predOut, newIn);
        }

        /* if newIn doesn't exist, it means either our predecessors were
         * uninitalized, or we didn't have any. in such case, defIn is the
         * empty set */
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
        if (definedVars.in === undefined || definedVars.out === undefined)
            throw new RuntimeError("in/out var sets are undefined");
    }
    return map as Map<Node, DefinedVars>;
}

/* export defined variables analysis as DOT graph */
export function exportDefinedVarsToDOT(graph: Graph,
                                       map: Map<Node, DefinedVars>,
                                       showSkip: boolean = true): string {
    return graphToDOT(graph.entry,
        /* labelShape */
        node => {
            /* get calculated in and our vars */
            let inVars = map.get(node)!.in;
            let outVars = map.get(node)!.out;

            /* default shape is box, while label must be assembled */
            let labelStrings: string[] = [];
            let shape: string = "box";

            /* first specify in variables */
            labelStrings.push("in = {" + [...inVars].join(",") + "}");

            /* reconstruct source code based on node AST */
            switch (node.type) {
                case "skip":
                    labelStrings.push("skip");
                    break;
                case "assign":
                    labelStrings.push(`${node.ast.i} := ` +
                                      `${stringifyNum(node.ast.e)}`);
                    break;
                case "cond":
                    labelStrings.push(`(${stringifyBool(node.ast.cond)})?`);
                    shape = "diamond";
                    break;
            }

            /* specify out variables */
            labelStrings.push("out = {" + [...outVars].join(",") + "}");

            return [labelStrings.join("\\n"), shape];
        },

        /* isBranching */
        node => node.type === "cond",

        /* getNext */
        node => node.type === "cond" ? [node.true, node.false] : node.next,

        /* skipElem */
        showSkip ? undefined : node => node.type === "skip");
}
