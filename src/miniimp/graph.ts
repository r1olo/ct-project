/*
*   MiniImp control flow graph
*   by Andrea Riolo Vinciguerra
*/

import { BoolExpr, Cmd, NumExpr } from "./engine";
import { RuntimeError } from "../errors";

/* narrow down AST types for specific nodes */
type SkipCmd =   { type: "skip" }   & Cmd;
type AssignCmd = { type: "assign" } & Cmd;
type SeqCmd =    { type: "seq" }    & Cmd;
type CondCmd =  ({ type: "if" } | { type: "while" }) & Cmd;

/* a "simple" command is a simple statement in the language (no seqs) */
type SimpleCmd = AssignCmd | SeqCmd | SkipCmd | CondCmd;

/* the various types of minimal nodes in our graph */
export type Node =
    /* skip might be a fake node inserted by genGraph. therefore, ast
     * property is optional */
    | { type: "skip",   next?: Node, ast?: SkipCmd               }
 
    /* these two inherit properties from the AST */
    | { type: "assign", next?: Node, ast: AssignCmd              }
    | { type: "cond",   true: Node,  false: Node,   ast: CondCmd }

/* a "simple" node is a non-branching node (it has next? property, hence
 * the extract). synonym of:
 *      Node extends { next?: Node } ? Node : never */
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

/* create a Block (a maximal graph node) */
export type Block =
    /* a linear block is just an array of commands */
    | { type: "linear", next?: Block, ast: SimpleCmd[]                   }

    /* a conditional block is an array of commands that branches at the end */
    | { type: "cond",   true: Block,  false: Block,    ast: SimpleCmd[],
                        cond: CondCmd                                    }

    /* a merge node is one that starts with a "FAKE" */
    | { type: "merge", next?: Block, ast: SimpleCmd[]                    };

/* an exit block is a non-branching block (linear block) that cannot have
 * children */
type ExitBlock = { type: "linear", next?: undefined } & Block;

export type BlockGraph = {
    entry: Block,
    exit:  ExitBlock,
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


/* export a minimal graph to a DOT format string for visualization.
 * bypassing "skip" is optional here, because we may not care about
 * visualizing skip nodes */
export function exportToDOT(graph: Graph, showSkip: boolean = true): string {
    /* initial DOT format */
    let lines: string[] = [];
    lines.push("digraph CFG {");
    lines.push('  node [shape=box, fontname="Courier"];');

    /* keep track of visited nodes */
    let visited = new Map<Node, number>();
    let idCounter = 0;

    /* this helper will return the actual next graph node bypassing "skip"
     * nodes */
    function resolveNode(node: Node | undefined,
                         seen = new Set<Node>()): Node | undefined {
        /* if we need to show skips, return prematurely */
        if (showSkip)
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

        /* tunnel through skip and exit nodes with a next */
        if (node.type === "skip")
            return resolveNode(node.next, seen);

        /* return node */
        return node;
    }

    /* preallocate and insert START and END nodes (we no longer have entry and
     * exit nodes, so these will substitute them in the visualization) */
    let startId = idCounter++;
    let endId = idCounter++;
    lines.push(`  n${startId} [label="START", shape=oval];`);
    lines.push(`  n${endId} [label="END", shape=oval];`);

    /* small DFS traversing */
    function traverse(node: Node): number {
        /* prevent cycles by returning the node ID we've already scanned,
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
                label = `(${stringifyBool(node.ast.cond)})?`;
                shape = "diamond";
                break;
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

/* export a maximal graph for visualization. the only skips present here
 * are the ones inserted by the programmer. we can hide those as well */
export function exportBlockToDOT(graph: BlockGraph,
                                 showSkip: boolean = true): string {
    /* initial DOT format */
    let lines: string[] = [];
    lines.push("digraph CFG {");
    lines.push('  node [shape=box, fontname="Courier"];');

    /* keep track of visited block */
    let visited = new Map<Block, number>();
    let idCounter = 0;

    /* this helper will return the actual next graph block bypassing those
     * blocks with only one "skip" command (useless to display if showSkip
     * is set to false) or merge blocks with no extra commands */
    function resolveBlock(block: Block | undefined,
                          seen = new Set<Block>()): Block | undefined {
        /* if we need to show skips, return prematurely */
        if (showSkip)
            return block;

        /* no block base case */
        if (!block)
            return undefined;

        /* if the block was already scanned, it is the beginning of a cycle.
         * therefore, it is our target */
        if (seen.has(block))
            return block;

        /* add this block to the seen blocks */
        seen.add(block);

        /* tunnel through linear blocks with only one "skip" statement */
        if (block.type === "linear" && block.ast.length === 1 &&
                block.ast[0]!.type === "skip")
            return resolveBlock(block.next, seen);

        /* tunnel through merge blocks that have no extra commands */
        if (block.type === "merge" && block.ast.length === 0)
            return resolveBlock(block.next, seen);

        /* return block */
        return block;
    }

    /* preallocate and insert START and END nodes */
    let startId = idCounter++;
    let endId = idCounter++;
    lines.push(`  n${startId} [label="START", shape=oval];`);
    lines.push(`  n${endId} [label="END", shape=oval];`);

    /* small DFS traversing */
    function traverse(block: Block): number {
        /* prevent cycles by returning the node ID we've already scanned,
         * without traversing more */
        if (visited.has(block))
            return visited.get(block)!;

        /* assign new ID to node and add to visited set */
        let id = idCounter++;
        visited.set(block, id);

        /* label is built on top of the commands' array */
        let labelStrings: string[] = block.ast.map(cmd => {
            if (cmd.type === "assign")
                return `${cmd.i} := ${stringifyNum(cmd.e)}`;
            else if (cmd.type === "skip")
                return showSkip ? "skip" : "";
            return "";
        }).filter(s => s !== "");

        /* if it's a conditional block, we must append the conditional
         * expression at the end of the label strings. likewise, if it's
         * a merge block, we must add "skip" on top of it (if showSkip) */
        if (block.type === "cond")
            labelStrings.push(`(${stringifyBool(block.cond.cond)})?`);
        else if (block.type === "merge" && showSkip)
            labelStrings.unshift("skip");

        /* build final label and escape quotes for DOT format safely */
        let label = labelStrings.join("\\n").replace(/"/g, '\\"');
        lines.push(`  n${id} [label="${label}", shape=box];`);

        /* if it's a condition, edges should have T and F labels. otherwise,
         * no label (just follow next path) */
        if (block.type === "cond") {
            /* traverse the true path and make a link to it. if true path
             * resolves to nothing, point it to the END node */
            let trueTarget = resolveBlock(block.true);
            let trueId = trueTarget ? traverse(trueTarget) : endId;
            lines.push(`  n${id} -> n${trueId} [label=" T"];`);
            
            /* traverse the false path and make a link to it. same as above,
             * link to END if it resolves to nothing */
            let falseTarget = resolveBlock(block.false);
            let falseId = falseTarget ? traverse(falseTarget) : endId;
            lines.push(`  n${id} -> n${falseId} [label=" F"];`);
        } else {
            /* traverse the path and make a link to it. same as above with END
             * node */
            let nextTarget = resolveBlock(block.next);
            let nextId = nextTarget ? traverse(nextTarget) : endId;
            lines.push(`  n${id} -> n${nextId};`);
        }

        return id;
    }

    /* link START node to the first resolved node or directly to END, if the
     * first node resolves to nothing (example: a graph full of blocks
     * with one skip) */
    let firstBlock = resolveBlock(graph.entry);
    let firstId = firstBlock ? traverse(firstBlock) : endId;
    lines.push(`  n${startId} -> n${firstId};`);

    /* return built DOT string */
    lines.push("}");
    return lines.join("\n");
}

/* return a maximal graph out of a minimal graph. this removes skips out of
 * the equation, since they are useless in code generation (whether real or
 * fake, we don't care) */
export function maximizeGraph(graph: Graph): BlockGraph {
    /* define helper types. AlmostCondBlock is a CondBlock where we don't
     * yet know its true and false paths. this is used because later in
     * traverse function there can be a circular dependency (a cycle) between
     * a conditional block and its body, which points back to it */
    type LinearBlock = { type: "linear" } & Block;
    type CondBlock = { type: "cond" } & Block;
    type MergeBlock = { type: "merge" } & Block;
    type AlmostCondBlock = Omit<CondBlock, "true" | "false"> & { true?: Block,
        false?: Block };

    /* quick helpers to generate a new block */
    const getLinearBlock = (ast: SimpleCmd[] = []): LinearBlock => {
        return { type: "linear", ast: [...ast] }
    };
    const getAlmostCondBlock = (cond: CondCmd,
                                ast: SimpleCmd[] = []): AlmostCondBlock => {
        return { type: "cond", ast: [...ast], cond }
    };
    const getMergeBlock = (ast: SimpleCmd[] = []): MergeBlock => {
        return { type: "merge", ast: [...ast] }
    };

    /* assert that a block is an ExitBlock or CondBlock. if the algorithm
     * is correct, this should not trigger an exception */
    function assertCondBlock(block: AlmostCondBlock): asserts block is CondBlock {
        if (block.true === undefined || block.false === undefined)
            throw new RuntimeError("cond block is not a proper CondBlock (true " +
                                   "or false paths undefined)");
    }
    function assertExitBlock(block: Block | undefined)
                             : asserts block is ExitBlock {
        if (block === undefined)
            throw new RuntimeError("exit block doesn't exist");
        if (block.type !== "linear" && block.type !== "merge")
            throw new RuntimeError("exit block is not linear (or merge)");
        if (block.next !== undefined)
            throw new RuntimeError("linear (or merge) block is not an " +
                                   "ExitBlock (has an exit property)");
    }

    /* keep track of visited nodes, where for each node we assign the
     * head of the block graph starting from this node (or including this
     * node) */
    let visited = new Map<Node, Block>();

    /* quick dfs helper that, for each node, returns the corresponding
     * block. the return type is [Block, Block?] because the first one is the
     * block mapped to the node, while the second one is the "exit" block
     * that is captured and propagated up the recursive chain */
    function traverse(node: Node,
                      block: LinearBlock | MergeBlock = getLinearBlock())
                      : [Block, Block?] {
        /* return a wrapped block. if we are carrying commands, we must
         * return our current block but set its next pointer to the target.
         * if we are not carrying commands, it is useless to put an empty
         * block in front of the target */
        const wrappedBlock = (target: Block) => {
            if (block.ast.length === 0)
                return target;
            block.next = target;
            return block;
        }

        /* prevent cycles by returning early */
        if (visited.has(node)) {
            /* get the head block of the subgraph spawned by this node */
            let headBlock = visited.get(node)!;

            /* return wrapped block */
            return [wrappedBlock(headBlock)];
        }

        /* we have hit a conditional: we should return a conditional block
         * whose paths we calculate by traversing recursively */
        if (node.type === "cond") {
            /* we make an "almost" cond block because we don't yet know about
             * its true and false paths, but we still need this object in
             * case of circular dependencies (graph cycles). we inherit
             * the current carried commands */
            let condBlock = getAlmostCondBlock(node.ast, block.ast);

            /* set condBlock as its own subgraph head to handle future
             * cycles. we are purposefully abusing typescript here!!! the
             * assumption is that condBlock will *eventually* be a true
             * CondBlock. the assertion below makes it sure */
            visited.set(node, condBlock as CondBlock);

            /* get the true and false paths, and also the propagated exit
             * node if any */
            let [truePath, exitNodeT] = traverse(node.true, getLinearBlock());
            let [falsePath, exitNodeF] = traverse(node.false, getLinearBlock());

            /* update the condBlock's true or false */
            condBlock.true = truePath;
            condBlock.false = falsePath;

            /* if the algorithm is good, this won't trip */
            assertCondBlock(condBlock);

            /* return new conditional node */
            return [condBlock, exitNodeT || exitNodeF];
        }

        /* we have hit a fake skip. this returns us a merge block, that
         * can possibly be extended by other commands below it. we need to
         * check the extra case where the skip node is at the end of the
         * graph */
        if (node.type === "skip" && !node.ast) {
            /* we make the merge block that is the head of the fake skip's
             * subgraph */
            let mergeBlock = getMergeBlock();

            /* set the fake skip as visited and its merge block is the head.
             * note: can a cycle occur?
             * note 2: do we care? */
            visited.set(node, mergeBlock);

            /* if we have a next node, simply propagate the merge block
             * down */
            if (node.next)
                return traverse(node.next, mergeBlock);
            else
                return [mergeBlock, mergeBlock];
        }

        /* this node right here will have the current block assigned. this
         * will retroactively be updated with the traversal. it means that the
         * subgraph spawned by (or that includes) this node will have this
         * current block as its head. no node loops back to a standard block
         * anyway so this is technically useless */
        visited.set(node, block);

        /* add the node's command to our current block. we only insert real
         * skips, ignoring fake ones */
        if (node.ast)
            block.ast.push(node.ast);

        /* if we have a next node, "include" it into our current block */
        if (node.next)
            return traverse(node.next, block);

        /* this block is graph's exit node */
        return [block, block]
    }

    /* traverse graph and transform nodes in blocks */
    let [entryBlock, exitBlock] = traverse(graph.entry);

    /* hoping that this won't trip */
    assertExitBlock(exitBlock);

    /* return graph */
    return { entry: entryBlock, exit: exitBlock };
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
