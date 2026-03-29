#!/bin/sh

#
#   quickly run either compiler, or compile them first
#

print() {
    # always print to stderr
    echo "$@" >&2
}

# make sure package.json exists (cwd is correct)
if [ ! -f "package.json" ]; then
    print "Error: package.json not found. Ensure you are running this" \
          "script in the root directory."
    exit 1
fi

# ensure npm is installed
if ! command -v npm >/dev/null 2>&1; then
    print "Error: npm is not installed or not available in the system PATH."
    exit 1
fi

# function to check, build, and run the target
ensure_and_run() {
    local_target="$1"
    shift
    
    executable="dist/$local_target"
    build_cmd="build:$local_target"
    
    # check if the executable exists
    if [ ! -f "$executable" ]; then
        print "Executable '$executable' not found. Attempting to build..."
        
        # try to compile
        if ! npm run "$build_cmd" >/dev/null 2>&1; then
            print "Build failed. Assuming missing dependencies. Running" \
                  "'npm ci'..."
            
            # install dependencies and retry
            if ! npm ci >/dev/null 2>&1; then
                print "Error: 'npm ci' failed to install dependencies."
                exit 1
            fi
            
            print "Dependencies installed. Retrying build..."
            if ! npm run "$build_cmd" >/dev/null 2>&1; then
                print "Error: Build failed again after installing" \
                      "dependencies. Bailing out."
                exit 1
            fi
        fi
    fi
    
    # replace the current shell process with the executable, passing all
    # remaining arguments
    exec "$executable" "$@"
}

# validate that at least one argument (the target) is provided
if [ "$#" -lt 1 ]; then
    print "usage: $0 {miniimp|minifun|clean} [args]"
    exit 1
fi

# get main target (either minimp or minifun)
main_target="$1"
shift

# do something based on target. if it is wrong, tell the user!!
case "$main_target" in
    miniimp|minifun)
        ensure_and_run "$main_target" "$@"
        ;;
    clean)
        npm run clean >/dev/null 2>&1
        ;;
    *)
        print "Error: Unknown target '$main_target'. Valid options are" \
              "'miniimp' or 'minifun'."
        exit 1
        ;;
esac
