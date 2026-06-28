#!/bin/bash
# build.sh - Build ocgt with automatic version injection
# Usage: ./build.sh [version]
#   If version is not provided, it will be read from wails.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Function to get version from wails.json
get_version_from_wails() {
    if command -v jq &> /dev/null; then
        jq -r '.info.productVersion' wails.json
    else
        # Fallback: parse with grep if jq not available
        grep -oP '"productVersion":\s*"\K[^"]+' wails.json | head -1
    fi
}

# Get version from argument or wails.json
if [ -n "$1" ]; then
    VERSION="$1"
else
    VERSION=$(get_version_from_wails)
fi

if [ -z "$VERSION" ]; then
    echo "Error: Could not determine version"
    exit 1
fi

echo "Building ocgt version: $VERSION"

# Update wails.json output filename
if command -v jq &> /dev/null; then
    jq --arg ver "$VERSION" '.outputfilename = "ocgt_v" + $ver + ".exe"' wails.json > wails.json.tmp && mv wails.json.tmp wails.json
fi

# Build with version injection via ldflags
LDFLAGS="-X github.com/ethan-blue/open-code-go-tools/internal/version.Version=$VERSION"

echo "Building with ldflags: $LDFLAGS"
wails build -ldflags "$LDFLAGS"

echo ""
echo "Build complete!"
echo "Output: build/bin/ocgt_v${VERSION}.exe"
