/*
*   MiniImp control flow graph analysis
*   by Andrea Riolo Vinciguerra
*/

import { BoolExpr, Cmd, Identifier, NumExpr,
         stringifyNum, stringifyBool } from "./engine";
import { Graph, Node, graphToDOT } from "./graph";
import { RuntimeError } from "../errors";

/* the var sets tags for live/defined variable analyses */
type VarSets = { in: Set<Identifier>, out: Set<Identifier> };
type DefinedVars = VarSets;
type LiveVars = VarSets;

/* the definitions set for the reaching definition analysis. the nodes
 * must be of type assign, otherwise they can't possibly be definition nodes.
 * in a minimimal graph (as explained below) a node is a definition */
type DefNode = { type: "assign" } & Node;
type DefSets = { in: Set<DefNode>, out: Set<DefNode> };

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

/* extract all used variables from a NumExpr. needed for calculation of gen and
 * kill functions for analyses */
function extractUsedVarsNumExpr(expr: NumExpr): Set<Identifier> {
    let vars = new Set<Identifier>();
    const addToVars = (set: Set<Identifier>) => {
        set.forEach(v => vars.add(v));
    }
    switch (expr.type) {
        case "id":
            vars.add(expr.i);
            break;
        case "add":
        case "sub":
        case "mul":
            addToVars(extractUsedVarsNumExpr(expr.a));
            addToVars(extractUsedVarsNumExpr(expr.b));
            break;
    }
    return vars;
}

/* extract all used variables from a BoolExpr. needed for calculation of gen and
 * kill functions for analyses */
function extractUsedVarsBoolExpr(expr: BoolExpr): Set<Identifier> {
    let vars = new Set<Identifier>();
    const addToVars = (set: Set<Identifier>) => {
        set.forEach(v => vars.add(v));
    }
    switch (expr.type) {
        case "and":
            addToVars(extractUsedVarsBoolExpr(expr.a));
            addToVars(extractUsedVarsBoolExpr(expr.b));
            break;
        case "not":
            addToVars(extractUsedVarsBoolExpr(expr.e));
            break;
        case "lt":
            addToVars(extractUsedVarsNumExpr(expr.a));
            addToVars(extractUsedVarsNumExpr(expr.b));
            break;
    }
    return vars;
}

/* extract all used variables from a Cmd. needed for calculation of gen and
 * kill functions for analyses */
function extractUsedVarsCmd(cmd: Cmd): Set<Identifier> {
    let vars = new Set<Identifier>();
    const addToVars = (set: Set<Identifier>) => {
        set.forEach(v => vars.add(v));
    }
    switch (cmd.type) {
        case "assign":
            /* we skip cmd.i, which is the assigned variable!!!. extract
             * variables used in the numeric expression */
            addToVars(extractUsedVarsNumExpr(cmd.e));
            break;
        case "if":
        case "while":
            /* extract variables used in the boolean condition */
            addToVars(extractUsedVarsBoolExpr(cmd.cond));
            break;
        case "seq":
        case "skip":
            /* seq's and skip's have no variables (they are commands) */
            break;
    }
    return vars;
}

/* this helper will scan the graph and build utility maps that can be
 * used in analyses. for example, among the others, a map of the predecessors
 * for every node */
function buildGraphMaps(graph: Graph): { preds: Map<Node, Set<Node>>,
                                         succs: Map<Node, Set<Node>>,
                                         allNodes: Set<Node> } {
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

    /* add elements that are present in both sets */
    let ret = new Set<T>();
    for (const elem of s1) {
        if (s2.has(elem))
            ret.add(elem);
    }

    return ret;
}

/* this helper will unify two sets */
function union<T>(s1: Set<T>, s2: Set<T>): Set<T> {
    /* simply iterate over one of them */
    let ret = new Set(s1);
    for (const elem of s2)
        ret.add(elem);
    return ret;
}

/* this helper will subtract s2 from s1 (S1 \ S2) */
function subtract<T>(s1: Set<T>, s2: Set<T>): Set<T> {
    /* start from s1 and remove all elements in s2 */
    let ret = new Set(s1);
    for (const elem of s2)
        ret.delete(elem);
    return ret;
}

/* the configuration for wqAnalyze function */
export type WQArgs<T> = {
    /* initialization of the work queue and the working map */
    init: (node: Node) => T,

    /* the local update function */
    local: (node: Node, ctx: { preds: Set<Node>, succs: Set<Node> },
        wq: UniQueue<Node>, map: Map<Node, T>) => void,
};

/* generic wrapper around work queue algorithm. */
export function wqAnalyze<T>(graph: Graph, args: WQArgs<T>): Map<Node, T> {
    /* the map so far */
    let map = new Map<Node, T>();

    /* we employ a BFS with a work queue to continuously ripple changes until
     * we reach the fixpoint */
    let wq = newQueue<Node>();

    /* fetch the utility maps from this graph */
    let { preds, succs, allNodes } = buildGraphMaps(graph);

    /* for all nodes, insert their initial value into the map and enqueue
     * them into the workqueue */
    for (const node of allNodes) {
        map.set(node, args.init(node));
        wq.enqueue(node);
    }

    /* for each node in workqueue, perform local update. this might add more
     * nodes */
    while (wq.size() > 0) {
        /* extract node and its neighbor and call local update */
        let cur = wq.dequeue()!;
        let ctx = {
            preds: preds.get(cur) ?? new Set(),
            succs: succs.get(cur) ?? new Set()
        };
        args.local(cur, ctx, wq, map);
    }

    /* return the map */
    return map;
}

/* this function will map each block to its defined vars */
export function analyzeDefinedVars(graph: Graph,
                                   input: Identifier): Map<Node, DefinedVars> {
    /* Gen(b) = variables defined in the block.
     * it is relatively straightforward in a minimal graph */
    function gen(node: Node): Set<Identifier> {
        if (node.type === "assign")
            return new Set([node.ast.i]);
        return new Set();
    }

    /* utility type to define a DefinedVars struct that accepts undefined sets
     * to indicate that they are yet uninitialized. (you may picture an
     * undefined set as the "universal" set) */
    type AlmostDefinedVars = Omit<DefinedVars, "in" | "out"> &
        { in: Set<Identifier> | undefined, out: Set<Identifier> | undefined };

    /* get map from the generic wqAnalyze function */
    let map = wqAnalyze<AlmostDefinedVars>(graph, {
        init: (node) => {
            /* our entry has the input var in the in variable set */
            if (node === graph.entry)
                return { in: new Set([input]), out: undefined };
            return { in: undefined, out: undefined };
        },
        local: (node, { preds, succs }, wq, map) => {
            /* get state, which surely exists due to our initialization */
            let state: AlmostDefinedVars = map.get(node)!;

            /* build defIn from predecessors. this is the intersection between
             * our current defIn and all the defOut of our predecessors */
            let newIn: Set<Identifier> | undefined = state.in;
            for (const pred of preds) {
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
            let newOut = union(state.in, gen(node));

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
                for (const succ of succs)
                    wq.enqueue(succ);
            }
        }
    });

    /* do a round of assertions and return map */
    for (const [_, definedVars] of map.entries()) {
        if (definedVars.in === undefined || definedVars.out === undefined)
            throw new RuntimeError("in/out var sets are undefined");
    }
    return map as Map<Node, DefinedVars>;
}

/* this function will map each block to its live vars */
export function analyzeLiveVars(graph: Graph,
                                output: Identifier): Map<Node, LiveVars> {

    /* Gen(b) = variables used before any assignment.
     * in the minimal graph, we just extract the used variables (excluding the
     * assigned var) */
    function gen(node: Node): Set<Identifier> {
        /* skip blocks do not have vars... */
        return node.ast ? extractUsedVarsCmd(node.ast) : new Set();
    }

    /* Kill(b) = variables assigned in the block.
     * in the minimal graph, we only grab the variable used in an assignment */
    function kill(node: Node): Set<Identifier> {
        if (node.type === "assign")
            return new Set([node.ast.i]);
        return new Set();
    }

    return wqAnalyze(graph, {
        init: (node) => {
            if (node === graph.exit)
                return { in: new Set(), out: new Set([output]) };
            return { in: new Set(), out: new Set() };
        },
        local: (node, { preds, succs }, wq, map) => {
            /* fetch current state */
            let state: LiveVars = map.get(node)!;

            /* fetch live variable that go out. this is the union between
             * all the live variables that go in of the successors. if we don't
             * have successors, newOut stays undefined (this is an exit node) */
            let newOut: Set<Identifier> | undefined = undefined;
            for (const succ of succs) {
                /* surely the successor has data in the map */
                let succIn = map.get(succ)!.in;
                newOut = newOut ? union(newOut, succIn) : succIn;
            }

            /* if we had successors, update out variable. otherwise, do not do
             * that (we are the exit node) */
            if (newOut)
                state.out = newOut;

            /* we now build the variables going into this block, which is the
             * union between Gen(b) and (Out(b) \ Kill(b)) */
            let newIn = union(gen(node), subtract(state.out, kill(node)));

            /* see if there was a change in the new in */
            let changed = false;
            if (state.in.size !== newIn.size) {
                changed = true;
            } else {
                /* check items one by one */
                for (const item of newIn) {
                    if (!state.in.has(item)) {
                        changed = true;
                        break;
                    }
                }
            }

            /* if there was a change, set the newIn to our in variables and
             * ripple the changes to the predecessors */
            if (changed) {
                state.in = newIn;
                for (const pred of preds)
                    wq.enqueue(pred);
            }
        }
    });
}

/* this function will map each block to its list of in and out definitions.
 * a definition, in the case of a minimal graph, is tagged with its own block
 * that originates it. in other words, a Node reference IS a definition */
export function analyzeReaching(graph: Graph,
                                input: Identifier): Map<Node, DefSets> {
    /* pre-compute global definitions (each variable name is mapped to the
     * originating definition/node) */
    let defsByVar = new Map<Identifier, Set<DefNode>>();

    /* Gen(b) = definitions generated in the block. for a minimal graph,
     * it just returns the node itself */
    function gen(node: Node): Set<DefNode> {
        /* only assign nodes are definitions */
        if (node.type === "assign")
            return new Set([node]);
        return new Set();
    }

    /* Kill(b) = all other definitions for the only variable assigned in
     * this block. we don't care about this same block's "other definitions"
     * because this is a minimal graph */
    function kill(node: Node): Set<DefNode> {
        /* we only work on assign nodes */
        if (node.type !== "assign")
            return new Set();

        /* this should never happen */
        if (!defsByVar.has(node.ast.i))
            throw new RuntimeError(`ghost variable ${node.ast.i}`);

        /* we only add to the kill set the other definition nodes for this
         * variable that are not the current node */
        let ret = new Set<DefNode>;
        for (const defNode of defsByVar.get(node.ast.i)!) {
            if (defNode !== node)
                ret.add(defNode);
        }

        return ret;
    }

    /* return the map from the generic wqAnalyze wrapper */
    return wqAnalyze(graph, {
        init: (node) => {
            /* we build our defsByVar considering assign nodes */
            if (node.type === "assign") {
                if (!defsByVar.has(node.ast.i))
                    defsByVar.set(node.ast.i, new Set());
                defsByVar.get(node.ast.i)!.add(node);
            }

            /* return the initialization node */
            if (node === graph.entry) {
                /* we need to inject a fake node to represent the definition
                 * for the input variable (note: smart but risky!!) */
                let fakeInput: DefNode = { type: "assign" } as DefNode;
                if (!defsByVar.has(input))
                    defsByVar.set(input, new Set());
                defsByVar.get(input)!.add(fakeInput);
                return { in: new Set([fakeInput]), out: new Set() };
            }

            /* default init */
            return { in: new Set(), out: new Set() };
        },
        local: (node, { preds, succs }, wq, map) => {
            /* fetch current state */
            let state = map.get(node)!;

            /* fetch definitions that go in. this is the union between
             * all outgoing definitions from the predecessors */
            let newIn: Set<DefNode> | undefined = undefined;
            for (const pred of preds) {
                /* surely pred has something in the map */
                let predOut = map.get(pred)!.out;
                newIn = newIn ? union(newIn, predOut) : predOut;
            }

            /* if newIn is not undefined, assign it */
            if (newIn)
                state.in = newIn;

            /* we now build the definitions going out this block, which is the
             * union between Gen(b) and (ReachIn(b) \ Kill(b)) */
            let newOut = union(gen(node), subtract(state.in, kill(node)));

            /* see if there was a change in the newOut */
            let changed = false;
            if (newOut.size !== state.out.size) {
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

            /* if changed, set out definitions to newOut and ripple changes
             * to its successors */
            if (changed) {
                state.out = newOut;
                for (const succ of succs)
                    wq.enqueue(succ);
            }
        }
    });
}

/* export defined variables analysis as DOT graph */
export function exportDefinedVarsToDOT(graph: Graph,
                                       map: Map<Node, VarSets>,
                                       showSkip: boolean = true): string {
    return graphToDOT({
        entry: graph.entry,
        labelShape: node => {
            /* map should contain this node */
            if (!map.has(node))
                throw new RuntimeError("map doesn't have node");

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
        isBranching: node => node.type === "cond",
        getNext: node => node.type === "cond" ? [node.true, node.false]
            : node.next,
        skipElem: showSkip ? undefined : node => node.type === "skip"
    });
}

/* export reaching definitions as DOT graph */
export function exportReachingDefsToDOT(graph: Graph,
                                        map: Map<Node, DefSets>,
                                        showSkip: boolean = true): string {
    /* for every new node we encounter, we assign a numeric ID to display
     * in the label */
    let nodeIds = new Map<Node, number>();
    let idCounter = 0;

    /* quick lambda to get the ID for a node */
    const getNodeId = (node: Node): number => {
        if (nodeIds.has(node))
            return nodeIds.get(node)!;
        nodeIds.set(node, idCounter);
        return idCounter++;
    }

    return graphToDOT({
        entry: graph.entry,
        labelShape: node => {
            if (!map.has(node))
                throw new RuntimeError("map doesn't have a node");

            /* get calculated in and out definitions */
            let inDefs = map.get(node)!.in;
            let outDefs = map.get(node)!.out;

            /* default shape is box, while label must be assembled */
            let labelStrings: string[] = [];
            let shape: string = "box";

            /* push the in definitions by ID */
            labelStrings.push("in = {" + [...inDefs].map(n => getNodeId(n)) +
                              "}");

            /* reconstruct source code based on AST */
            switch (node.type) {
                case "skip":
                    labelStrings.push("skip");
                    break;
                case "assign":
                    /* for an assign node, we must use the ID prefix */
                    labelStrings.push(`[${getNodeId(node)}]${node.ast.i} ` +
                                      `:= ${stringifyNum(node.ast.e)}`);
                    break;
                case "cond":
                    labelStrings.push(`(${stringifyBool(node.ast.cond)})?`);
                    shape = "diamond";
                    break;
            }

            /* specify out definitions */
            labelStrings.push("out = {" + [...outDefs].map(n => getNodeId(n)) +
                              "}");

            return [labelStrings.join("\\n"), shape];
        },
        isBranching: node => node.type === "cond",
        getNext: node => node.type === "cond" ? [node.true, node.false]
            : node.next,
        skipElem: showSkip ? undefined : node => node.type === "skip"
    });
}
