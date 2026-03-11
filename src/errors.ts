/* group all errors here */

/* runtime error. this should never happen and indicates a bug in the
 * compiler that should be solved ASAP!!! */
export class RuntimeError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "RuntimeError";
    }
}

/* a parsing error */
export class ParseError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "ParseError";
    }
}

/* an evaluation error */
export class EvalError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "EvalError";
    }
}

export class TypeError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "TypeError";
    }
}
