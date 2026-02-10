#!/bin/bash
# sync-format-utils.sh
# Syncs format-utils from react-semaphor to chunk-processor/shared/
#
# Usage: ./sync-format-utils.sh
#
# This script copies formatting utilities from react-semaphor and adjusts
# import paths for the Lambda environment. See shared/SYNC.md for details.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REACT_SEMAPHOR="$SCRIPT_DIR/../../react-semaphor"
TARGET_DIR="$SCRIPT_DIR/shared/format-utils"
SYNC_MD="$SCRIPT_DIR/shared/SYNC.md"

# Verify react-semaphor exists
if [ ! -d "$REACT_SEMAPHOR" ]; then
  echo "Error: react-semaphor not found at $REACT_SEMAPHOR"
  exit 1
fi

# Verify source files exist
SOURCE_DIR="$REACT_SEMAPHOR/src/shared/format-utils"
if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: format-utils not found at $SOURCE_DIR"
  exit 1
fi

# Create target directory if needed
mkdir -p "$TARGET_DIR"

echo "Syncing format-utils from react-semaphor..."

# Copy types.ts (from types/format-types.ts)
cp "$SOURCE_DIR/types/format-types.ts" "$TARGET_DIR/types.ts"
echo "  ✓ types.ts"

# Copy date-formatter.ts (no import changes needed)
cp "$SOURCE_DIR/formatters/date-formatter.ts" "$TARGET_DIR/date-formatter.ts"
echo "  ✓ date-formatter.ts"

# Copy number-formatter.ts and fix imports
cp "$SOURCE_DIR/formatters/number-formatter.ts" "$TARGET_DIR/number-formatter.ts"
sed -i '' "s|from '../types'|from './types'|g" "$TARGET_DIR/number-formatter.ts"
echo "  ✓ number-formatter.ts (imports fixed)"

# Copy cell-formatter.ts and fix imports
cp "$SOURCE_DIR/formatters/cell-formatter.ts" "$TARGET_DIR/cell-formatter.ts"
sed -i '' "s|from '../types'|from './types'|g" "$TARGET_DIR/cell-formatter.ts"
echo "  ✓ cell-formatter.ts (imports fixed)"

# Update SYNC.md with current date
TODAY=$(date +%Y-%m-%d)
if [ -f "$SYNC_MD" ]; then
  sed -i '' "s/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}/$TODAY/g" "$SYNC_MD"
  echo "  ✓ SYNC.md updated to $TODAY"
else
  echo "  ! SYNC.md not found, skipping date update"
fi

echo ""
echo "Sync complete! Run 'npm run build' in chunk-processor to verify."
