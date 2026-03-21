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

/* this is a generic export function. it will traverse any kind of graph,
 * either minimal or maximal, as long as common operations for the node type
 * are defined.
 *  - labelShape: gives the label and the shape for a node
 *  - isBranching: tells whether the node is a branching node or a singular
 *                 node. this is used to call the function recursively for
 *                 example giving each branch its label (T or F)
 *  - getNext: gives either the single next branch or the tuple with the
 *             true and false branches
 *  - skipElem: if this function exists, it returns true if this node is
 *              a skippable element
 */
function genericExportToDOT<T>(entry: T,
           labelShape: (elem: T) => [string, string],
           isBranching: (elem: T) => boolean,
           getNext: (elem: T) => (T | undefined) | [T, T],
           skipElem: ((elem: T) => boolean) | undefined = undefined): string {
    /* initial DOT format */
    let lines: string[] = [];
    lines.push("digraph CFG {");
    lines.push('  node [shape=box, fontname="Courier"];');

    /* keep track of visited elements with their assigned number */
    let visited = new Map<T, number>();
    let idCounter = 0;

    /* this helper will skip so called "skip elements". the function
     * skipElements will tell us if the element must be skipped. used for
     * example to hide useless skip commands but can be customized to skip
     * anything */
    function resolveBlock(elem: T | undefined,
                          seen = new Set<T>()): T | undefined {
        /* if we need to show skips, return prematurely (disable
         * resolveBlock completely) */
        if (!skipElem)
            return elem;

        /* no element base case */
        if (!elem)
            return undefined;

        /* if the element was already scanned, it is the beginning of a cycle.
         * therefore, it is our target */
        if (seen.has(elem))
            return elem;

        /* add this element to the seen elements */
        seen.add(elem);

        /* if this element is a skip element, return its next node recursively
         * */
        if (skipElem(elem)) {
            /* if this element has two branches, there's an error in the
             * algorithm. bail out */
            let next = getNext(elem);
            if (Array.isArray(next))
                throw new RuntimeError("skip element has two branches");
            return resolveBlock(next, seen);
        }

        /* return element */
        return elem;
    }

    /* preallocate and insert START and END nodes */
    let startId = idCounter++;
    let endId = idCounter++;
    lines.push(`  n${startId} [label="START", shape=oval];`);
    lines.push(`  n${endId} [label="END", shape=oval];`);

    /* dfs helper that will traverse the graph, will add lines to the DOT
     * string and will assign a number to each node to pass them recursively */
    function traverse(elem: T): number {
        /* prevent cycles by returning the node ID we've already scanned,
         * without traversing more */
        if (visited.has(elem))
            return visited.get(elem)!;

        /* assign new ID to node and add to visited set */
        let id = idCounter++;
        visited.set(elem, id);

        /* extract label and shape depending on element's op */
        let [label, shape] = labelShape(elem);

        /* escape quotes for DOT format safely */
        label = label.replace(/"/g, '\\"');
        lines.push(`  n${id} [label="${label}", shape=${shape}];`);

        /* if it's a branching element, edges should have T and F labels.
         * otherwise, no label (just follow next path) */
        let next = getNext(elem);
        if (isBranching(elem)) {
            /* hopefully this will never happen */
            if (!Array.isArray(next))
                throw new RuntimeError("branching element has at most one " +
                                       "branch");

            /* traverse the true path and make a link to it. if true path
             * resolves to nothing, point it to the END node */
            let trueTarget = resolveBlock(next[0]);
            let trueId = trueTarget ? traverse(trueTarget) : endId;
            lines.push(`  n${id} -> n${trueId} [label=" T"];`);
            
            /* traverse the false path and make a link to it. same as above,
             * link to END if it resolves to nothing */
            let falseTarget = resolveBlock(next[1]);
            let falseId = falseTarget ? traverse(falseTarget) : endId;
            lines.push(`  n${id} -> n${falseId} [label=" F"];`);
        } else {
            /* hopefully this will never happen */
            if (Array.isArray(next))
                throw new RuntimeError("non branching element has two branches");

            /* traverse the path and make a link to it. same as above with END
             * node */
            let nextTarget = resolveBlock(next);
            let nextId = nextTarget ? traverse(nextTarget) : endId;
            lines.push(`  n${id} -> n${nextId};`);
        }

        return id;
    }

    /* link START node to the first resolved node or directly to END, if the
     * first node resolves to nothing (example: a graph full of blocks
     * with one skip) */
    let firstBlock = resolveBlock(entry);
    let firstId = firstBlock ? traverse(firstBlock) : endId;
    lines.push(`  n${startId} -> n${firstId};`);

    /* return built DOT string */
    lines.push("}");
    return lines.join("\n");
}

/* export a minimal graph to a DOT format string for visualization.
 * bypassing "skip" is optional here, because we may not care about
 * visualizing skip nodes */
export function exportToDOT(graph: Graph, showSkip: boolean = true): string {
    return genericExportToDOT(graph.entry,
        /* labelShape */
        node => {
            /* initial label and shape */
            let label: string = node.type;
            let shape: string  = "box";

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

            return [label, shape];
        },

        /* isBranching */
        node => node.type === "cond",

        /* getNext */
        node => node.type === "cond" ? [node.true, node.false] : node.next,

        /* skipElem */
        showSkip ? undefined : node => node.type === "skip");
}

/* export a maximal graph for visualization. the only skips present here
 * are the ones inserted by the programmer. we can hide those as well */
export function exportBlockToDOT(graph: BlockGraph,
                                 showSkip: boolean = true): string {
    return genericExportToDOT(graph.entry,
        /* labelShape */
        block => {
            /* build all the command strings from the list of statements */
            let labelStrings: string[] = block.ast.map(cmd => {
                if (cmd.type === "assign")
                    return `${cmd.i} := ${stringifyNum(cmd.e)}`;
                else if (cmd.type === "skip")
                    return showSkip ? "skip" : "";
                return "";
            }).filter(s => s !== "");
            let shape: string = "box";

            /* adjust shape */
            if (block.type === "cond") {
                labelStrings.push(`(${stringifyBool(block.cond.cond)})?`);
                if (block.cond.type == "while")
                    shape = "diamond";
            } else if (block.type === "merge" && showSkip) {
                labelStrings.unshift("skip");
            }

            return [labelStrings.join("\\n"), shape];
        },

        /* isBranching */
        block => block.type === "cond",

        /* getNext */
        block => block.type === "cond" ? [block.true, block.false] : block.next,

        /* skipElem */
        showSkip ? undefined : block => {
            return (block.type === "linear" && block.ast.length === 1 &&
                    block.ast[0]!.type === "skip") ||
                   (block.type === "merge" && block.ast.length === 0);
        }
    );
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
         * whose paths we calculate by traversing recursively. we need to
         * make a distinction here based on the originating AST node: if
         * it's a while loop, we need to separate the condition. if it's
         * an if, it can stay in the same block as the other instructions */
        if (node.type === "cond") {
            /* check if cond is a while */
            const isWhile = node.ast.type == "while";

            /* we make an "almost" cond block because we don't yet know about
             * its true and false paths, but we still need this object in
             * case of circular dependencies (graph cycles). if it's a while
             * loop, this new block must be isolated from the rest */
            let condBlock = getAlmostCondBlock(node.ast,
                isWhile ? [] : block.ast);

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

            /* this neither */
            if (exitNodeT !== undefined && exitNodeF !== undefined)
                throw new RuntimeError("multiple exit nodes in graph");

            /* what we return depends on whether this is a while loop or not.
             * if it is a while, we return the current block that points to
             * this new conditional. otherwise, we return the conditional
             * so far, which contains the previous commands */
            return [isWhile ? wrappedBlock(condBlock) : condBlock,
                    exitNodeT ?? exitNodeF];
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

            /* if we have a next node, propagate the merge block down.
             * otherwise, mergeBlock is our final block */
            let [nextBlock, exitBlock] = node.next ?
                traverse(node.next, mergeBlock) :
                [mergeBlock, mergeBlock];

            /* return wrapped block, linking our current to the new merge */
            return [wrappedBlock(nextBlock), exitBlock];
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
            (branch1.exit as SimpleNode).next = branch2.entry;

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
