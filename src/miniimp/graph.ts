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
    | { type: "skip",   next?: Node, ast?: SkipCmd               }
 
    /* these two inherit properties from the AST */
    | { type: "assign", next?: Node, ast: AssignCmd              }
    | { type: "cond",   true: Node, false: Node,   ast: CondCmd }

    /* experimental: a block node for grouping together statements
     * in a maximal graph */
    | { type: "block",  next?: Node, ast: SimpleCmd[]            };

/* a "simple" node is a non-branching node (it has next? property, hence
 * the extract) */
type SimpleNode = Extract<Node, { next?: Node }>;

/* an exit node is a non-branching node (a SimpleNode) whose next property
 * is strictly undefined. an exit node CANNOT have children */
type ExitNode = { next?: undefined } & SimpleNode;

/* a graph (or subgraph, inductively) has two "invariant" nodes: an entry
 * one and an exit one */
export type Graph = {
    entry: Node,
    exit:  ExitNode,
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

/* this helper will return the actual next graph node bypassing "skip"
 * nodes */
function bypassSkip(node: Node | undefined,
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

    /* tunnel through entry, skip (optionally) and exit nodes with a next */
    if (node.type == "skip")
        return bypassSkip(node.next, seen);

    /* return node */
    return node;
}


/* export a graph to a DOT format string for visualization, 
 * bypassing intermediate entry/exit nodes and reconstructing code from AST.
 * bypassing "skip" is optional here, because we may not care about
 * visualizing skip nodes (TODO: ask).
 * the entire beautifying process can be turned off, in which case skip is
 * ignored */
export function exportToDOT(graph: Graph, showSkip: boolean = true): string {
    /* initial DOT format */
    let lines: string[] = [];
    lines.push("digraph CFG {");
    lines.push('  node [shape=box, fontname="Courier"];');

    /* keep track of visited nodes */
    let visited = new Map<Node, number>();
    let idCounter = 0;

    /* whether we bypass "skip" nodes or include them */
    const resolveNode = (node: Node | undefined) => showSkip ? node :
        bypassSkip(node);

    /* preallocate and insert START and END nodes (we no longer have entry and
     * exit nodes, so these will substitute them in the visualization) */
    let startId = idCounter++;
    let endId = idCounter++;
    lines.push(`  n${startId} [label="START", shape=oval];`);
    lines.push(`  n${endId} [label="END", shape=oval];`);

    /* small DFS traversing */
    function traverse(node: Node): number {
        /* prevent cycles by returning the node we've already scanned,
         * without traversing more */
        if (visited.has(node))
            return visited.get(node)!;

        /* assign new ID to node and add to visited set */
        let id = idCounter++;
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
            /* traverse the true path and make a link to it. if true path
             * resolves to nothing, point it to the END node */
            let trueTarget = resolveNode(node.true);
            let trueId = trueTarget ? traverse(trueTarget) : endId;
            lines.push(`  n${id} -> n${trueId} [label=" T"];`);
            
            /* traverse the false path and make a link to it. same as above,
             * link to END if it resolves to nothing */
            let falseTarget = resolveNode(node.false);
            let falseId = falseTarget ? traverse(falseTarget) : endId;
            lines.push(`  n${id} -> n${falseId} [label=" F"];`);
        } else {
            /* traverse the path and make a link to it. same as above with END
             * node */
            let nextTarget = resolveNode(node.next);
            let nextId = nextTarget ? traverse(nextTarget) : endId;
            lines.push(`  n${id} -> n${nextId};`);
        }

        return id;
    }

    /* link START node to the first resolved node or directly to END, if the
     * first node resolves to nothing (example: a graph full of skips) */
    let firstNode = resolveNode(graph.entry);
    let firstId = firstNode ? traverse(firstNode) : endId;
    lines.push(`  n${startId} -> n${firstId};`);

    /* return built DOT string */
    lines.push("}");
    return lines.join("\n");
}

/* generate a minimal graph out of a command */
export default function genGraph(cmd: Cmd): Graph {
    switch (cmd.type) {
        case "assign": {
            /* build a subgraph with an assign node (both entry and exit)
             *          n (in) (out)
             */
            let n: ExitNode = { type: "assign", ast: cmd };

            /* return subgraph */
            return { entry: n, exit: n };
        }
        case "if": {
            /* get the two subgraphs for the two branches */
            let trueBranch = genGraph(cmd.then);
            let falseBranch = genGraph(cmd.else);

            /* build a subgraph with a conditional and the two conditional
             * branches
             *          b? (in)
             *         / \
             *        t   f
             *         \ /
             *       fakeSkip (out)
             */
            let fakeSkip: ExitNode = { type: "skip" };
            let b: Node = { type: "cond", true: trueBranch.entry,
                            false: falseBranch.entry, ast: cmd };

            /* adjust the two subgraphs to point to the fakeSkip node */
            (trueBranch.exit as SimpleNode).next = fakeSkip;
            (falseBranch.exit as SimpleNode).next = fakeSkip;

            /* return subgraph */
            return { entry: b, exit: fakeSkip };
        }
        case "while": {
            /* get the subgrap for the while branch */
            let whileBranch = genGraph(cmd.body);

            /* build a (half) subgraph with a conditional in the middle and
             * the while branch
             *       -< b? (in) <|
             *       |  |        |
             *       V  w---->---|
             *       |  
             *       fakeSkip (out)
             */
            let fakeSkip: ExitNode = { type: "skip" };
            let b: Node = { type: "cond", true: whileBranch.entry,
                            false: fakeSkip, ast: cmd };

            /* adjust the while branch to point to the conditonal node
             * (loop wrap-back) */
            (whileBranch.exit as SimpleNode).next = b;

            /* return the subgraph */
            return { entry: b, exit: fakeSkip };
        }
        case "seq": {
            /* get the two subgraphs for the commands */
            let branch1 = genGraph(cmd.a);
            let branch2 = genGraph(cmd.b);

            /* link the two subgraphs' exit and entry nodes */
            (branch1.exit as SimpleNode).next = branch2.entry

            /* return the subgraph */
            return { entry: branch1.entry, exit: branch2.exit };
        }
        case "skip": {
            /* build a subgraph with a skip node (both entry and exit)
             *         skip (in) (out)
             */
            let s: ExitNode = { type: "skip", ast: cmd };

            /* return the subgraph */
            return { entry: s, exit: s };
        }
    }
}
