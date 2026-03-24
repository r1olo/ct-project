import * as fs from "fs";
import { ArgumentParser } from "argparse";
import { DiagnosticError } from "./diag";
import { RuntimeError } from "./errors";
import execProg from "./miniimp/engine";
import parse from "./miniimp/parser";
import genGraph, { maximizeGraph,
                   exportToDOT,
                   exportBlockToDOT } from "./miniimp/graph";
import { analyzeDefinedVars,
         analyzeLiveVars,
         analyzeReaching,
         exportDefinedVarsToDOT,
         exportReachingDefsToDOT } from "./miniimp/analysis";

/* create a parser */
const parser = new ArgumentParser({
    description: "MiniImp compiler and graph generator"
});

/* either specify a file or read from stdin */
parser.add_argument("-f", "--file", {
    help: "the source file to read from (defaults to stdin)"
})

/* three choices (mutually exclusive and required):
 *  -g:           build a graph
 *  -a:           build an analyzed graph
 *  input_number: execute program with this input
 */
const group = parser.add_mutually_exclusive_group({
    required: true
});
group.add_argument("-g", "--graph", {
    action: "store_true",
    help: "generate a normal graph (minimized by default)"
});
group.add_argument("-ad", "--analyze-defined", {
    action: "store_true",
    help: "generate a defined variable graph"
});
group.add_argument("-al", "--analyze-live", {
    action: "store_true",
    help: "generate a live variable graph"
});
group.add_argument("-ar", "--analyze-reaching", {
    action: "store_true",
    help: "generate a reaching definitions graph"
});
group.add_argument("input_number", {
    nargs: "?",
    type: "int",
    help: "input number for execution"
});

/* optional modifiers for graph generation */
parser.add_argument("-m", "--maximize", {
    action: "store_true",
    help: "generate a maximized graph"
});
parser.add_argument("-n", "--no-skip", {
    action: "store_true",
    help: "do not display skips in graph image"
});

/* parse arguments */
const args = parser.parse_args();

const inputFile = args.file;
const generateGraph = args.graph;
const doAnalyzeDefined = args.analyze_defined;
const doAnalyzeLive = args.analyze_live;
const doAnalyzeReaching = args.analyze_reaching;
const genMaxGraph = args.max_graph;
const showSkip = !args.no_skip;
const inputValue = args.input_number;

let sourceCode = "";
try {
    if (inputFile) {
        /* read from specified file */
        sourceCode = fs.readFileSync(inputFile, "utf-8");
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
    
    if (generateGraph) {
        /* generate and print the CFG in DOT format based on the selected
         * flags */
        let graph = genGraph(prog.cmd);
        let dot: string;
        if (genMaxGraph)
            dot = exportBlockToDOT(maximizeGraph(graph), showSkip);
        else
            dot = exportToDOT(graph, showSkip);
        console.log(dot);
    } else if (doAnalyzeDefined) {
        let graph = genGraph(prog.cmd);
        let map = analyzeDefinedVars(graph, prog.in);
        console.log(exportDefinedVarsToDOT(graph, map, showSkip));
    } else if (doAnalyzeLive) {
        let graph = genGraph(prog.cmd);
        let map = analyzeLiveVars(graph, prog.out);
        console.log(exportDefinedVarsToDOT(graph, map, showSkip));
    } else if (doAnalyzeReaching) {
        let graph = genGraph(prog.cmd);
        let map = analyzeReaching(graph, prog.in);
        console.log(exportReachingDefsToDOT(graph, map, showSkip));
    } else {
        /* execute the program */
        const result = execProg(prog, inputValue);
        console.log("Result: " + result);
    }
} catch (err: any) {
    if (err instanceof DiagnosticError) {
        /* print the human friendly diagnostic error */
        console.error(err.format(sourceCode));
    } else if (err instanceof RuntimeError) {
        /* RuntimeError has its own format */
        console.error(err.format());
    } else {
        /* fallback to generic error */
        throw err;
    }
}
