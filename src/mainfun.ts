import parse from "./minifun/parser"
import execProg from "./minifun/engine"

let src = "let a = 1 in let b = 1 in (fun y => y + a) 6";
let result = execProg(parse(src));
console.log(`Result: ${result}`);
