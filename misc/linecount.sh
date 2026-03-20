#!/bin/sh

# create temp file
TMPFILE=$(mktemp)

# get all files and save output to TMPFILE
find . -type f -name '*.ts' -not -path './node_modules/*' -exec cat {} + \
    >$TMPFILE

# remove comments and empty lines
effective=$(cat $TMPFILE \
            | sed -e '/^[[:space:]]*\/\*.*\*\//d' \
                  -e '/^[[:space:]]*\/\*/,/\*\//d' \
                  -e '/^[[:space:]]*\/\//d' \
                  -e '/^[[:space:]]*$/d' \
            | wc -l)

# total lines
total=$(cat $TMPFILE | wc -l)

# remove TMPFILE
rm $TMPFILE

# print results
echo "Total: $total"
echo "Effective: $effective"
