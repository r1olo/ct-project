/*
 *  MiniImp LLVM code generation
 *  by Andrea Riolo Vinciguerra
 */

import validateProg, { Analysis } from "./analysis";
import optimize from "./opt";
import { Identifier,
         BoolExpr,
         NumExpr,
         Prog } from "./engine";
import { buildGraphMaps,
         extractUsedVarsNumExpr,
         extractUsedVarsBoolExpr } from "./analysis";
import { Block,
         maximizeGraph } from "./graph";

function extractAllVars(analy: Analysis): Set<Identifier> {
    let allVars = new Set<string>();
    allVars.add(analy.in);
    allVars.add(analy.out);

    let { allNodes } = buildGraphMaps(analy.graph);
    for (const node of allNodes) {
        if (node.type === "assign") {
            /* add left side */
            allVars.add(node.ast.i);

            /* add right side */
            extractUsedVarsNumExpr(node.ast.e).forEach(v => allVars.add(v.i));
        } else if (node.type === "cond") {
            /* only used vars here */
            extractUsedVarsBoolExpr(node.ast.cond).forEach(v => allVars.add(v.i));
        }
    }

    return allVars;
}

/* generate a LLVM representation from this program. this must be first
 * validated to avoid disastrous things */
export default function codegen(prog: Prog): string {
    /* validate the program and optimize it */
    let analy = validateProg(prog);
    optimize(analy);

    /* get the maximal graph out of the optimized minimal graph */
    let blockGraph = maximizeGraph(analy.graph);

    /* initial state */
    let lines: string[] = [];
    let nextReg = 1;

    /* visited set for dfs'ing */
    let visited: Set<Block> = new Set();

    /* for every block we encounter, we assign a LLVM label */
    let blockLabels = new Map<Block, string>();
    let blockCounter = 0;

    /* quick lambda to get the block's label (creating as needed) */
    const getBlockLabel = (block: Block): string => {
        if (blockLabels.has(block))
            return blockLabels.get(block)!;
        let label = `block_${blockCounter++}`;
        blockLabels.set(block, label);
        return label;
    }

    /* helper to split a numeric expression in multiple assignments */
    function genNumExpr(expr: NumExpr): string {
        switch (expr.type) {
            case "val":
                /* a raw constant just returns its value */
                return expr.v.toString();
            case "id": {
                /* load the var from the stack into its temp register */
                let tmpReg = `%${nextReg++}`;
                lines.push(`  ${tmpReg} = load i64, ptr %_${expr.i}`);
                return tmpReg;
            }
            case "add":
            case "sub":
            case "mul": {
                /* evalute left and right sides recursively */
                let leftOp = genNumExpr(expr.a);
                let rightOp = genNumExpr(expr.b);
                let tmpReg = `%${nextReg++}`;

                /* write instruction */
                lines.push(`  ${tmpReg} = ${expr.type} i64 ${leftOp}, ` +
                           `${rightOp}`);
                return tmpReg;
            }
        }
    }

    /* helper to split a boolean expression in multiple assignments */
    function genBoolExpr(expr: BoolExpr): string {
        switch (expr.type) {
            case "val":
                /* 1 for true, 0 for false */
                return expr.v ? "1" : "0";
            case "and": {
                /* evlauate left and right recursively */
                let leftOp = genBoolExpr(expr.a);
                let rightOp = genBoolExpr(expr.b);
                let tmpReg = `%${nextReg++}`;

                /* write instruction */
                lines.push(`  ${tmpReg} = and i1 ${leftOp}, ${rightOp}`);
                return tmpReg;
            }
            case "not": {
                /* evaluate inner expr */
                let inner = genBoolExpr(expr.e);
                let tmpReg = `%${nextReg++}`;

                /* write instr, we use XOR to implement NOT */
                lines.push(`  ${tmpReg} = xor i1 ${inner}, 1`);
                return tmpReg;
            }
            case "lt": {
                /* evlauate left and right recursively */
                let leftOp = genNumExpr(expr.a);
                let rightOp = genNumExpr(expr.b);
                let tmpReg = `%${nextReg++}`;

                /* write instruction */
                lines.push(`  ${tmpReg} = icmp slt i64 ${leftOp}, ${rightOp}`);
                return tmpReg;
            }
        }
    }

    /* dfs crawler that will squeeze a basic LLVM block from the nodes, in
     * traversing order */
    function traverse(block: Block) {
        /* if the block was visited (and so processed), exit */
        if (visited.has(block))
            return;

        /* the block is now visited */
        visited.add(block);

        /* TODO: ENTER LOGIC HERE TO FILL LINES */
        lines.push(`${getBlockLabel(block)}:`)

        /* write all sequential commands */
        for (const cmd of block.ast) {
            if (cmd.type === "assign") {
                /* store result temp register into stack */
                let reg = genNumExpr(cmd.e);
                lines.push(`  store i64 ${reg}, ptr %_${cmd.i}`);
            }
        }

        /* conditional nodes have a conditional branching termination */
        if (block.type === "cond") {
            /* evaluate the condition */
            let condReg = genBoolExpr(block.cond.cond);

            /* write conditional branching instruction */
            let trueLabel = getBlockLabel(block.true);
            let falseLabel = getBlockLabel(block.false);
            lines.push(`  br i1 ${condReg}, label %${trueLabel}, ` +
                       `label %${falseLabel}`);

            /* go forwards */
            traverse(block.true);
            traverse(block.false);
            return;
        }

        /* if we have a next node, just branch to that node */
        if (block.next) {
            /* write branch to next block and traverse to it */
            lines.push(`  br label %${getBlockLabel(block.next)}`);
            traverse(block.next);
            return;
        }

        /* this is an end block since it has no next. we better return from
         * the main function */
        let retReg = `%${nextReg++}`;
        lines.push(`  ${retReg} = load i64, ptr %_${prog.out}`);
        lines.push(`  ret i64 ${retReg}`);
    }

    /* define the function and give a name to first block to avoid clashes */
    lines.push(`define i64 @miniimp(i64 %0) {`);
    lines.push("start:");

    /* allocate all the variables in the stack */
    let vars = extractAllVars(analy);
    for (const v of vars)
        lines.push(`  %_${v} = alloca i64`);

    /* store the in argument into its stack slot */
    lines.push(`  store i64 %0, ptr %_${prog.in}`);

    /* jump to first block */
    lines.push(`  br label %${getBlockLabel(blockGraph.entry)}`);

    /* write block by block. each basic block will either end in a branch
     * opcode or ret (LLVM requires this) */
    traverse(blockGraph.entry);

    lines.push("}");
    return lines.join("\n");
}
