#!/bin/sh

# this script will compile a miniimp program using the frontend. to make
# user experience _FLAWLESS_, the run.sh script is used to handle automatic
# dependency management

print() {
    # always print to stderr
    echo "$@" >&2
}

# make sure run.sh exists (cwd is correct)
if [ ! -f "run.sh" ]; then
    print "error: run.sh not found. ensure you are running this" \
          "script in the root directory"
    exit 1
fi

OUTPUT=a.out
KEEP=n

usage() {
    print "usage: $0 [-o output] [-k] <input_file.mi>"
    print "  -o          Specify the output executable name"
    print "  -O1, -O2    Optimize with clang"
    print "  -k          Keep temporary files for inspection"
}

while getopts "o:hkO:" opt; do
    case $opt in
        O)
            OPT=-O$OPTARG
            ;;
        o)
            OUTPUT=$OPTARG
            ;;
        h)
            usage
            exit 0
            ;;
        k)
            KEEP=y
            ;;
        \?)
            usage
            exit 1
            ;;
    esac
done

# $1 becomes first non-flag arg
shift $((OPTIND -1))

INPUT=$1
[ -z "$INPUT" ] && {
    print "error: no compilation input file specified"
    usage
    exit 1
}
[ ! -f "$INPUT" ] && {
    print "error: input file '$INPUT' does not exist or is not a regular file"
    exit 1
}

# compile and possibly delete temp files
./run.sh miniimp -f "$INPUT" -c >out.ll &&
opt -p=mem2reg out.ll -S -o opt.ll &&
llc ${OPT:+"$OPT"} -filetype=obj opt.ll -o miniimp.o &&
clang ${OPT:+"$OPT"} misc/wrapper.c miniimp.o -o "$OUTPUT"; RES=$?
[ $KEEP = n ] && rm -f out.ll opt.ll miniimp.o

[ $RES = 0 ] && print "[+] compilation successful. run './$OUTPUT'"
