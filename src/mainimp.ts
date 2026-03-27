import * as fs from "fs";
import { ArgumentParser } from "argparse";
import { DiagnosticError } from "./diag";
import { MiniError } from "./errors";
import execProg from "./miniimp/engine";
import parse from "./miniimp/parser";
import { maximizeGraph,
         exportGraph,
         exportBlockGraph } from "./miniimp/graph";
import assertProg,
     { analyzeProg,
       exportDefinedVars,
       exportLiveVars,
       exportReachingDefs } from "./miniimp/analysis";
import optimize from "./miniimp/opt";

/* create a parser */
const parser = new ArgumentParser({
    description: "MiniImp compiler and graph generator"
});
/* either specify a file or read from stdin */
parser.add_argument("-f", "--file", {
    help: "the source file to read from (defaults to stdin)"
})

/* the available actions are:
 * - nothing (input number at the end) -> exec
 * - -g: generate graph */
const actionGroup = parser.add_mutually_exclusive_group({
    required: true,
});
actionGroup.add_argument("-g", "--graph", {
    action: "store_true",
    help: "generate a graph",
});
actionGroup.add_argument("input_number", {
    nargs: "?",
    type: "int",
    help: "input number for execution"
});

/* generate different types of graphs:
 * - defined variables graph
 * - live variables graph
 * - reaching definitions graph
 * - maximized graph
 * - default: standard minimal graph */
const graphGroup = parser.add_mutually_exclusive_group();
graphGroup.add_argument("-ad", "--analyze-defined", {
    action: "store_true",
    help: "generate a defined variable graph"
});
graphGroup.add_argument("-al", "--analyze-live", {
    action: "store_true",
    help: "generate a live variable graph"
});
graphGroup.add_argument("-ar", "--analyze-reaching", {
    action: "store_true",
    help: "generate a reaching definitions graph"
});
graphGroup.add_argument("-m", "--maximize", {
    action: "store_true",
    help: "generate a maximized graph"
});

/* optional modifier for graph generation */
parser.add_argument("-n", "--no-skip", {
    action: "store_true",
    help: "do not display skips in graph image"
});
parser.add_argument("-o", "--optimize", {
    action: "store_true",
    help: "optimize the graph"
});

/* parse arguments */
const args = parser.parse_args();

let sourceCode = "";
try {
    if (args.file) {
        /* read from specified file */
        sourceCode = fs.readFileSync(args.file, "utf-8");
    } else {
        /* file 0 is stdin */
        sourceCode = fs.readFileSync(0, "utf-8");
    }
} catch (err: any) {
    console.error("failed to read source code: " + err.message);
    process.exit(1);
}

if (!sourceCode.trim()) {
    console.error("error: no source code provided");
    process.exit(1);
}

try {
    const prog = parse(sourceCode);
    
    if (args.graph) {
        /* analyze the program and possibly optimize it */
        let analy = analyzeProg(prog);
        if (args.optimize)
            optimize(analy);

        /* generate the requested graph */
        let dot: string;
        if (args.maximize)
            dot = exportBlockGraph(maximizeGraph(analy.graph), !args.no_skip);
        else if (args.analyze_defined)
            dot = exportDefinedVars(analy, !args.no_skip);
        else if (args.analyze_live)
            dot = exportLiveVars(analy, !args.no_skip);
        else if (args.analyze_reaching)
            dot = exportReachingDefs(analy, !args.no_skip);
        else
            dot = exportGraph(analy.graph, !args.no_skip);

        /* finally print this graph */
        console.log(dot);
    } else {
        /* validate and execute program */
        assertProg(prog);
        console.log("Result: " + execProg(prog, args.input_number));
    }
} catch (err: any) {
    if (err instanceof DiagnosticError) {
        /* print the human friendly diagnostic error */
        console.error(err.format(sourceCode));
    } else if (err instanceof MiniError) {
        /* RuntimeError has its own format */
        console.error(err.format());
    } else {
        /* fallback to generic error */
        throw err;
    }
}
