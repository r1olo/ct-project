/*
*   Compiler diagnostic system
*   by Andrea Riolo Vinciguerra
*/

/* a pair indicating the location of a segment start/end */
export type SourceLocation = {
    line: number, /* 1-indexed */
    col: number   /* 0-indexed */
}

/* a single AST node is contained within a source code fragment contained
 * between these two (line, col) pairs. might be multi-line, who knows */
export type SourceSpan = {
    start: SourceLocation,
    end: SourceLocation
};

export class DiagnosticError extends Error {
    constructor(
        public msg: string,
        public span: SourceSpan,
        public notes: string[] = []
    ) {
        super(msg);
        this.name = "DiagnosticError";
    }

    /* return the prettified error string */
    format(source: string): string {
        let lines = source.split('\n');
        let start = this.span.start;
        let end = this.span.end;
        
        /* we will push lines into this array and join them at the end */
        let output: string[] = [];
        
        /* the user should know that it's an error we talkin about */
        output.push(`\x1b[31;1mError:\x1b[0m ${this.msg}`);
        
        /* the start line string */
        let startLineStr = start.line.toString();

        /* ensure margins line up for multi-line */
        let padMargin = startLineStr.length;

        if (start.line === end.line) {
            /* single line error */
            let lineText = lines[start.line - 1] ?? "";
            output.push(`\x1b[34m${startLineStr} |\x1b[0m ${lineText}`);
            
            let padding = " ".repeat(padMargin + 3 + start.col);
            let length = Math.max(1, end.col - start.col);
            let squiggles = "^".repeat(length);
            
            output.push(`\x1b[31m${padding}${squiggles}\x1b[0m`);
        } else {
            /* multi-line error */
            for (let i = start.line; i <= end.line; i++) {
                let lineText = lines[i - 1] ?? "";
                let currentLineStr = i.toString().padStart(padMargin);
                
                output.push(`\x1b[34m${currentLineStr} |\x1b[0m ${lineText}`);
                
                let squiggleStart = 0;
                let squiggleLength = 0;
                
                if (i === start.line) {
                    /* first line: squiggle from start.col to end of line */
                    squiggleStart = start.col;
                    squiggleLength = Math.max(1, lineText.length - start.col);
                } else if (i === end.line) {
                    /* last line: squiggle from beginning of line to end.col */
                    squiggleStart = 0;
                    squiggleLength = end.col;
                } else {
                    /* middle lines: squiggle the whole line */
                    squiggleStart = 0;
                    squiggleLength = Math.max(1, lineText.length);
                }
                
                if (squiggleLength > 0) {
                    let padding = " ".repeat(padMargin + 3 + squiggleStart);
                    let squiggles = "^".repeat(squiggleLength);
                    output.push(`\x1b[31m${padding}${squiggles}\x1b[0m`);
                }
            }
        }
        
        /* print the very helpful notes (if any) */
        for (const note of this.notes) {
            output.push(`  \x1b[36m= note:\x1b[0m ${note}`);
        }
        
        /* return the final composed string */
        return output.join("\n");
    }
}
