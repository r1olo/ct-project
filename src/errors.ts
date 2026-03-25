/* group all errors here */
export class MiniError extends Error {
    public readonly formatString: string;

    constructor(msg: string, format: string) {
        super(msg);
        this.name = "MiniError";
        this.formatString = format;
    }

    format(): string {
        return [ this.formatString,
                 this.stack ?? "Stack unavailable" ].join("\n");
    }
}

/* runtime error. this should never happen and indicates a bug in the
 * compiler that should be solved ASAP!!! */
export class RuntimeError extends MiniError {
    constructor(msg: string) {
        super(msg, "A runtime error has occurred. Please report to developer.");
        this.name = "RuntimeError";
    }
}

/* an evaluation error. occurs if the interpreter is called with a
 * semantically bad program and no analysis was made beforehand */
export class EvalError extends MiniError {
    constructor(msg: string) {
        super(msg, "An evaluation error has occurred. Have you validated the " +
                   "input first?");
        this.name = "EvalError";
    }
}
