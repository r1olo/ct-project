import * as fs from "fs";
import execProg from "./miniimp/engine";
import parse from "./miniimp/parser";
import genGraph, { exportToDOT } from "./miniimp/graph";
import { DiagnosticError } from "./diag";

/* CLI state */
let inputFile: string | undefined = undefined;
let generateGraph = false;
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
        generateGraph = true;
    } else if (!arg.startsWith("-") && inputArg === undefined) {
        inputArg = arg;
    } else {
        console.error(`error: unexpected argument '${arg}'`);
        console.error("usage: script.js [-f source.mi] [-g] [input_number]");
        process.exit(1);
    }
}

/* we only strictly need the input number if we are executing the code */
if (!generateGraph && inputArg === undefined) {
    console.error("error: input number is required for execution");
    console.error("usage: script.js [-f source.mi] [-g] <input_number>");
    process.exit(1);
}

let inputValue = 0;
if (inputArg !== undefined) {
    inputValue = parseInt(inputArg, 10);
    if (isNaN(inputValue)) {
        console.error(`error: provided input '${inputArg}' is not a valid integer`);
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
        /* generate and print the CFG in DOT format */
        const cfg = genGraph(prog.cmd);
        console.log(exportToDOT(cfg));
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
