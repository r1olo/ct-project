/*
*   MiniImp control flow graph
*   by Andrea Riolo Vinciguerra
*/

import { BoolExpr, Cmd, NumExpr } from "./engine";

/* the various types of minimal nodes in our graph */
export type Node =
    /* skip might be a fake node inserted by genGraph. therefore, ast
     * property is optional */
    | { type: "skip",   next: Node,              ast?: { type: "skip" } & Cmd  }
 
    /* these two inherit properties from the AST */
    | { type: "assign", next: Node,              ast: { type: "assign" } & Cmd }
    | { type: "cond",   true: Node,              false: Node,
                        ast: ({ type: "if" } | { type: "while" }) & Cmd        }

    /* the two invariant nodes. exit might be a sink */
    | { type: "entry",  next: Node                                             }
    | { type: "exit" ,  next?: Node                                            };

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

/* this helper will return the actual next graph node, bypassing "entry",
 * "exit" and "skip" nodes. this results in a much cleaner graph for
 * viusalization */
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

    /* tunnel through entry, skip and exit nodes with a next */
    if (node.type === "entry" || node.type === "skip" ||
            (node.type === "exit" && node.next))
        return resolveNode(node.next, seen);

    /* return node */
    return node;
}

/* export a graph to a DOT format string for visualization, 
 * bypassing intermediate entry/exit nodes and reconstructing code from AST */
export function exportToDOT(graph: Graph): string {
    /* initial DOT format */
    const lines: string[] = [];
    lines.push("digraph CFG {");
    lines.push('  node [shape=box, fontname="Courier"];');

    /* keep track of visited nodes */
    const visited = new Map<Node, number>();
    let idCounter = 0;

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
                 * being traversed, it means that the resolveNode helper
                 * has failed */
                label = "START";
                shape = "oval";
                break;
            case "exit":
                label = "END";
                shape = "oval";
                break;
        }
        
        /* escape quotes for DOT format safely */
        label = label.replace(/"/g, '\\"');
        lines.push(`  n${id} [label="${label}", shape=${shape}];`);

        /* if it's a condition, edges should have T and F labels. otherwise,
         * no label */
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
        } else if (node.type !== "exit") {
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
    const firstNode = resolveNode(graph.entry);
    if (firstNode) {
        const startId = idCounter++;
        lines.push(`  n${startId} [label="START", shape=oval];`);
        const firstNodeId = traverse(firstNode);
        lines.push(`  n${startId} -> n${firstNodeId};`);
    }

    /* return built DOT string */
    lines.push("}");
    return lines.join("\n");
}

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
