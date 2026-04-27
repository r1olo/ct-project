import * as readline from "readline";
import * as fs from "fs";
import { ArgumentParser } from "argparse";
import parse from "./minifun/parser";
import execProg from "./minifun/engine";
import checkProg, { formatType } from "./minifun/validator";
import { DiagnosticError } from "./diag";

/* core eval function */
function evaluateSource(source: string) {
    try {
        /* parse the source code */
        const ast = parse(source);

        /* static analysis */
        const principalType = checkProg(ast);
        const typeSignature = formatType(principalType);

        /* eval phase */
        const result = execProg(ast);

        /* format the output. if it's a closure, print <fun> */
        if (typeof result === "object" && result !== null && "arg" in result) {
            console.log(`- : ${typeSignature} = <fun>`);
        } else {
            console.log(`- : ${typeSignature} = ${result}`);
        }
    } catch (err: any) {
        /* catch parse and eval errors without crashing the REPL */
        if (err instanceof DiagnosticError) {
            console.error(err.format(source));
        } else {
            console.error(`\x1b[31m${err.message}\x1b[0m`);
        }
    }
}

/* create a parser */
const parser = new ArgumentParser({
    description: "MiniFun interpreter and interactive environment"
});

/* define available arguments */
parser.add_argument("-f", "--file", {
    help: "evaluate the specified source file path"
});
parser.add_argument("-i", "--interactive", {
    action: "store_true",
    help: "run in interactive REPL mode"
});

/* parse arguments */
const args = parser.parse_args();

/* execution flow */
if (!args.file && !args.interactive) {
    /* no flags passed: Read entirely from stdin (e.g., piped data),
     * evaluate, and exit */
    let source = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => source += chunk);
    process.stdin.on("end", () => {
        if (source.trim()) evaluateSource(source.trim());
    });
} else {
    /* file evaluation phase */
    if (args.file) {
        try {
            const source = fs.readFileSync(args.file, "utf8");
            evaluateSource(source.trim());
        } catch (err: any) {
            console.error(`\x1b[31mError reading file '${args.file}': ` +
                          `${err.message}\x1b[0m`);
            process.exit(1);
        }
    }

    /* interactive REPL phase */
    if (args.interactive) {
        console.log("Welcome to MiniFun's interactive environment.");
        console.log("Copyright 2026-2026 Andrea Riolo Vinciguerra.\n");
        console.log("Type your expression and press Enter to evaluate.");
        console.log("Press Ctrl+C or type 'exit' to quit.\n");

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: "minifun# "
        });

        rl.prompt();

        rl.on("line", (line) => {
            const source = line.trim();

            if (source === "exit" || source === "quit") {
                rl.close();
                return;
            }

            if (source) {
                evaluateSource(source);
            }

            rl.prompt();
        }).on("close", () => {
            console.log("\nGoodbye!");
            process.exit(0);
        });
    }
}
