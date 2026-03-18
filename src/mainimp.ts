import * as fs from "fs";
import execProg from "./miniimp/engine";
import parse from "./miniimp/parser";
import genGraph, { maximizeGraph, exportToDOT } from "./miniimp/graph";
import { DiagnosticError } from "./diag";

/* show usage and exit */
function usage(msg?: string) {
    if (msg)
        console.error(msg);
    console.error("usage: script.js [-f source.mi] " +
                  "[-g] [-m] [--no-skip] [input_number]");
    process.exit(1);
}

/* CLI state */
let inputFile: string | undefined = undefined;
let generateGraph = false;
let genMaxGraph = false;
let showSkip = true;
let inputArg: string | undefined = undefined;

/* parse command line arguments */
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-f") {
        inputFile = args[++i];
        if (!inputFile) {
            console.error("error: expected filename after -f");
            process.exit(1);
        }
    } else if (arg === "-g") {
        /* standard graph: show all skips */
        generateGraph = true;
    } else if (arg === "--no-skip") {
        /* beautified graph: hide all skips */
        showSkip = false;
    } else if (arg === "-m") {
        /* should we generate the maximized graph? */
        genMaxGraph = true;
    } else if (!arg.startsWith("-") && inputArg === undefined) {
        inputArg = arg;
    } else {
        usage(`error: unexpected argument '${arg}'`);
    }
}

/* we only strictly need the input number if we are executing the code */
if (!generateGraph && inputArg === undefined)
    usage("error: input number is required for execution");

let inputValue = 0;
if (inputArg !== undefined) {
    inputValue = parseInt(inputArg, 10);
    if (isNaN(inputValue)) {
        console.error(`error: provided input '${inputArg}' is not a ` +
                      `valid integer`);
        process.exit(1);
    }
}

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
        let cfg = genMaxGraph ? maximizeGraph(genGraph(prog.cmd)) :
            genGraph(prog.cmd);
        console.log(exportToDOT(cfg, showSkip));
    } else {
        /* execute the program */
        const result = execProg(prog, inputValue);
        console.log("Result: " + result);
    }
} catch (err: any) {
    if (err instanceof DiagnosticError)
        console.error(err.format(sourceCode));
    else
        console.error("Error: " + err.message);
}
