import * as fs from "fs";
import execProg from "./miniimp/engine";
import parse from "./miniimp/parser"
import { DiagnosticError } from "./diag";

const inputArg = process.argv[2];
if (inputArg === undefined) {
    console.error("usage: script.js <input_number> < source_code.mi");
    process.exit(1);
}

const inputValue = parseInt(inputArg, 10);
if (isNaN(inputValue)) {
    console.error(`error: provided input '${inputArg}' is not a valid integer`);
    process.exit(1);
}

let sourceCode = "";
try {
    /* file 0 is stdin */
    sourceCode = fs.readFileSync(0, "utf-8");
} catch (err: any) {
    console.error("failed to read source code from stdin: " + err.message);
    process.exit(1);
}

if (!sourceCode.trim()) {
    console.error("error: no source code provided via stdin");
    process.exit(1);
}

try {
    const prog = parse(sourceCode);
    const result = execProg(prog, inputValue);
    console.log("Result: " + result);
} catch (err: any) {
    if (err instanceof DiagnosticError)
        console.error(err.format(sourceCode));
    else
        console.log("Error: " + err.message);
}
