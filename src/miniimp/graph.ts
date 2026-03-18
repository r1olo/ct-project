/*
*   MiniImp control flow graph
*   by Andrea Riolo Vinciguerra
*/

import { BoolExpr, Cmd, NumExpr } from "./engine";

/* narrow down AST types for specific nodes */
type SkipCmd =   { type: "skip" }   & Cmd;
type AssignCmd = { type: "assign" } & Cmd;
type SeqCmd =    { type: "seq" }    & Cmd;
type CondCmd =  ({ type: "if" } | { type: "while" }) & Cmd;

/* a "simple" command is a non-branching statement */
type SimpleCmd = AssignCmd | SeqCmd | SkipCmd;

/* the various types of minimal nodes in our graph */
export type Node =
    /* skip might be a fake node inserted by genGraph. therefore, ast
     * property is optional */
    | { type: "skip",   next: Node, ast?: SkipCmd               }
 
    /* these two inherit properties from the AST */
    | { type: "assign", next: Node, ast: AssignCmd              }
    | { type: "cond",   true: Node, false: Node,   ast: CondCmd }

    /* the two invariant nodes. exit might be a sink */
    | { type: "entry",  next: Node                              }
    | { type: "exit" ,  next?: Node                             }

    /* experimental: a block node for grouping together statements
     * in a maximal graph */
    | { type: "block",  next: Node, ast: SimpleCmd[]            };

/* a graph (or subgraph, inductively) has two "invariant" nodes: an entry
 * one and an exit one */
export type Graph = {
    entry: { type: "entry" } & Node,
    exit:  { type: "exit"  } & Node,
};

/* convert a numeric expression into string */
function stringifyNum(expr: NumExpr): string {
    switch (expr.type) {
        case "id": 
            return expr.i;
        case "val": 
            return expr.v.toString();
        case "add": 
            return `${stringifyNum(expr.a)} + ${stringifyNum(expr.b)}`;
        case "sub": 
            return `${stringifyNum(expr.a)} - ${stringifyNum(expr.b)}`;
        case "mul": {
            /* add parentheses if the child is addition or subtraction
             * to preserve precedence */
            const aStr = (expr.a.type === "add" || expr.a.type === "sub") ?
                `(${stringifyNum(expr.a)})` : stringifyNum(expr.a);
            const bStr = (expr.b.type === "add" || expr.b.type === "sub") ?
                `(${stringifyNum(expr.b)})` : stringifyNum(expr.b);
            return `${aStr} * ${bStr}`;
        }
    }
}

/* convert a boolean expression into string */
function stringifyBool(expr: BoolExpr): string {
    switch (expr.type) {
        case "val": 
            return expr.v ? "true" : "false";
        case "lt": 
            return `${stringifyNum(expr.a)} < ${stringifyNum(expr.b)}`;
        case "not": {
            /* wrap in parentheses if negating an 'and' expression */
            const eStr = expr.e.type === "and" ?
                `(${stringifyBool(expr.e)})` : stringifyBool(expr.e);
            return `not ${eStr}`;
        }
        case "and": {
            return `${stringifyBool(expr.a)} and ${stringifyBool(expr.b)}`;
        }
    }
}

/* export a graph to a DOT format string for visualization, 
 * bypassing intermediate entry/exit nodes and reconstructing code from AST.
 * bypassing "skip" is optional here, because we may not care about
 * visualizing skip nodes (TODO: ask).
 * the entire beautifying process can be turned off, in which case skip is
 * ignored */
export function exportToDOT(graph: Graph, beautified: boolean = true,
                            showSkip: boolean = true): string {
    /* initial DOT format */
    const lines: string[] = [];
    lines.push("digraph CFG {");
    lines.push('  node [shape=box, fontname="Courier"];');

    /* keep track of visited nodes */
    const visited = new Map<Node, number>();
    let idCounter = 0;

    /* this helper will return the actual next graph node, bypassing "entry",
     * "exit" and "skip" (optional) nodes. this results in a much cleaner graph for
     * viusalization. this can be turned off with beautified = false, in which
     * case skip is ignored */
    function resolveNode(node: Node | undefined,
                                seen = new Set<Node>()): Node | undefined {
        /* if graph must not be beautified, don't bother bypassing intermediate
         * nodes */
        if (!beautified)
            return node;

        /* no node base case */
        if (!node)
            return undefined;

        /* if the node was already scanned, it is the beginning of a cycle.
         * therefore, it is our target */
        if (seen.has(node))
            return node;

        /* add this node to the seen nodes */
        seen.add(node);

        /* tunnel through entry, skip (optionally) and exit nodes with a next */
        if (node.type === "entry" || (node.type === "exit" && node.next) ||
                (!showSkip && node.type === "skip"))
            return resolveNode(node.next, seen);

        /* return node */
        return node;
    }

    /* small DFS traversing */
    function traverse(node: Node): number {
        /* prevent cycles by returning the node we've already scanned,
         * without traversing more */
        if (visited.has(node))
            return visited.get(node)!;

        /* assign new ID to node and add to visited set */
        const id = idCounter++;
        visited.set(node, id);

        /* label and shape depends on type of node */
        let label: string = node.type;
        let shape = "box";

        /* reconstruct the source code based on the node AST */
        switch (node.type) {
            case "skip":
                label = "skip";
                break;
            case "assign":
                label = `${node.ast.i} := ${stringifyNum(node.ast.e)}`;
                break;
            case "cond":
                label = `${stringifyBool(node.ast.cond)}?`;
                shape = "diamond";
                break;
            case "entry":
                /* TODO: this should throw. if an entry node ends up
                 * being traversed, it means that the logic has failed */
                label = "START";
                shape = "oval";
                break;
            case "exit":
                label = "END";
                shape = "oval";
                break;
            case "block":
                /* map each command to its string representation and join em */
                label = node.ast.map(cmd => {
                    if (cmd.type === "assign")
                        return `${cmd.i} := ${stringifyNum(cmd.e)}`;
                    else if (cmd.type === "skip")
                        return "skip";
                    return "";
                }).filter(s => s !== "").join("\\n");
        }
        
        /* escape quotes for DOT format safely */
        label = label.replace(/"/g, '\\"');
        lines.push(`  n${id} [label="${label}", shape=${shape}];`);

        /* if it's a condition, edges should have T and F labels. otherwise,
         * no label (just follow next path) */
        if (node.type === "cond") {
            /* traverse the true path and make a link to it */
            const trueTarget = resolveNode(node.true);
            if (trueTarget) {
                const trueId = traverse(trueTarget);
                lines.push(`  n${id} -> n${trueId} [label=" T"];`);
            }
            
            /* traverse the false path and make a link to it */
            const falseTarget = resolveNode(node.false);
            if (falseTarget) {
                const falseId = traverse(falseTarget);
                lines.push(`  n${id} -> n${falseId} [label=" F"];`);
            }
        } else if (node.next) {
            /* traverse the path and make a link to it */
            const nextTarget = resolveNode(node.next);
            if (nextTarget) {
                const nextId = traverse(nextTarget);
                lines.push(`  n${id} -> n${nextId};`);
            }
        }

        return id;
    }

    /* initiate DFS and build DOT graph */
    if (beautified) {
        const firstNode = resolveNode(graph.entry);
        if (firstNode) {
            const startId = idCounter++;
            lines.push(`  n${startId} [label="START", shape=oval];`);
            const firstNodeId = traverse(firstNode);
            lines.push(`  n${startId} -> n${firstNodeId};`);
        }
    } else {
        /* if beautified is false, render raw graph exactly as it is */
        traverse(graph.entry);
    }

    /* return built DOT string */
    lines.push("}");
    return lines.join("\n");
}

/* clean a minimal graph from its redundant entry and exit nodes. this
 * keeps skip nodes */
export function cleanGraph(graph: Graph): Graph {
    /* keep track of visited nodes, and assign their clean counterpart */
    const visited = new Map<Node, Node>();

    /* this helper will return the actual next graph node, bypassing "entry"
     * and "exit" only */
    function resolveNode(node: Node | undefined,
                                seen = new Set<Node>()): Node | undefined {
        /* no node base case */
        if (!node)
            return undefined;

        /* if the node was already scanned, it is the beginning of a cycle.
         * therefore, it is our target */
        if (seen.has(node))
            return node;

        /* add this node to the seen nodes */
        seen.add(node);

        /* tunnel through entry, exit nodes with a next */
        if (node.type === "entry" || (node.type === "exit" && node.next))
            return resolveNode(node.next, seen);

        /* return node */
        return node;
    }

    /* little dfs helper */
    function traverse(node: Node): Node {
        /* avoid cycles. return clean node for this one */
        if (visited.has(node))
            return visited.get(node)!;

        /* mark as visited */
        visited.set(node, node);

        /* clean outgoing edges by tunneling to real nodes, bypassing entry
         * and exit nodes in the middle */
        if (node.type === "cond") {
            /* bypass entry and exit for both cond branches */
            let trueTarget = resolveNode(node.true);
            let falseTarget = resolveNode(node.false);

            /* clean next target nodes */
            if (trueTarget)
                node.true = traverse(trueTarget);
            if (falseTarget)
                node.false = traverse(falseTarget);
        } else if (node.next) {
            /* bypass entry and exit for single branch */
            let target = resolveNode(node.next);

            /* clean next target node */
            if (target)
                node.next = traverse(target);
        }

        /* return clean node */
        return node;
    }

    /* clean the graph */
    traverse(graph.entry);

    /* return the clean graph */
    return { entry: graph.entry, exit: graph.exit };
}

/* generate a minimal graph out of a command.
 * TODO: ask if branches must converge to skip or it's ok for them to
 * converge to an exit node */
export default function genGraph(cmd: Cmd): Graph {
    switch (cmd.type) {
        case "assign": {
            /* build a subgraph with an assign node in the middle
             *          i
             *          |
             *          s
             *          |
             *          f
             */
            let f: Node = { type: "exit" };
            let s: Node = { type: "assign", next: f, ast: cmd };
            let i: Node = { type: "entry", next: s };

            /* return subgraph */
            return { entry: i, exit: f };
        }
        case "if": {
            /* get the two subgraphs for the two branches */
            let trueBranch = genGraph(cmd.then);
            let falseBranch = genGraph(cmd.else);

            /* build a (half) subgraph with a conditional in the middle and the
             * two conditional branches
             *          i
             *          |
             *          b?
             *         / \
             *        t   f
             *         \ /
             *       fakeSkip
             *          |
             *          f
             */
            let f: Node = { type: "exit" };
            let fakeSkip: Node = { type: "skip", next: f };
            let b: Node = { type: "cond", true: trueBranch.entry,
                            false: falseBranch.entry, ast: cmd };
            let i: Node = { type: "entry", next: b };

            /* adjust the two subgraphs to poin to the fakeSkip node */
            trueBranch.exit.next = fakeSkip;
            falseBranch.exit.next = fakeSkip;

            /* return subgraph */
            return { entry: i, exit: f };
        }
        case "while": {
            /* get the subgrap for the while branch */
            let whileBranch = genGraph(cmd.body);

            /* build a (half) subgraph with a conditional in the middle and
             * the while branch
             *          i
             *          |
             *       -< b?<|
             *       |  |  |
             *       V  w->-
             *       |  
             *       fakeSkip
             *          |
             *          f*/
            let f: Node = { type: "exit" };
            let fakeSkip: Node = { type: "skip", next: f };
            let b: Node = { type: "cond", true: whileBranch.entry,
                            false: fakeSkip, ast: cmd };
            let i: Node = { type: "entry", next: b };

            /* adjust the while branch to point to the conditonal node
             * (loop wrap-back) */
            whileBranch.exit.next = b;

            /* return the subgraph */
            return { entry: i, exit: f };
        }
        case "seq": {
            /* get the two subgraphs for the commands */
            let branch1 = genGraph(cmd.a);
            let branch2 = genGraph(cmd.b);

            /* link the two subgraphs' exit and entry nodes */
            branch1.exit.next = branch2.entry

            /* return the subgraph */
            return { entry: branch1.entry, exit: branch2.exit };
        }
        case "skip": {
            /* build a subgraph with a skip node in the middle
             *          i
             *          |
             *         skip
             *          |
             *          f
             */
            let f: Node = { type: "exit" };
            let s: Node = { type: "skip", next: f, ast: cmd };
            let i: Node = { type: "entry", next: s };

            /* return the subgraph */
            return { entry: i, exit: f };
        }
    }
}
