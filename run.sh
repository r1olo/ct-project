#!/bin/sh

#
#   quickly run either compiler, or compile them first
#

# make sure package.json exists (cwd is correct)
if [ ! -f "package.json" ]; then
    echo "Error: package.json not found. Ensure you are running this" \
        "script in the root directory." >&2
    exit 1
fi

# ensure npm is installed
if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is not installed or not available in the system PATH." >&2
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
        echo "Executable '$executable' not found. Attempting to build..."
        
        # try to compile
        if ! npm run "$build_cmd"; then
            echo "Build failed. Assuming missing dependencies. Running" \
                "'npm ci'..."
            
            # install dependencies and retry
            if ! npm ci; then
                echo "Error: 'npm ci' failed to install dependencies." >&2
                exit 1
            fi
            
            echo "Dependencies installed. Retrying build..."
            if ! npm run "$build_cmd"; then
                echo "Error: Build failed again after installing" \
                    "dependencies. Bailing out." >&2
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
    echo "usage: $0 {miniimp|minifun|clean} [args]" >&2
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
        npm run clean
        ;;
    *)
        echo "Error: Unknown target '$main_target'. Valid options are" \
            "'miniimp' or 'minifun'." >&2
        exit 1
        ;;
esac
