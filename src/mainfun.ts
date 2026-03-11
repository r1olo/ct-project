import * as readline from "readline";
import parse from "./minifun/parser";
import execProg, { Value } from "./minifun/engine";
import checkProg, { formatType } from "./minifun/validator";

/* initialize readline interface */
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "minifun# "
});

console.log("Welcome to MiniFun's interactive environment.");
console.log("Type your expression and press Enter to evaluate.");
console.log("Press Ctrl+C or type 'exit' to quit.\n");

rl.prompt();

rl.on("line", (line) => {
    const source = line.trim();

    /* handle exit commands */
    if (source === "exit" || source === "quit") {
        rl.close();
        return;
    }

    /* only process if the user actually typed something */
    if (source) {
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
            /* catch parse and eval errors without crashing the REPL
             * (print in red) */
            console.error(`\x1b[31m${err.message}\x1b[0m`);
        }
    }

    /* reprompt for next line */
    rl.prompt();
}).on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
});
