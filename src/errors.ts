/* group all errors here */

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
