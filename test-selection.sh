#!/bin/bash
# Test script for pide extension
# Usage: ./test-selection.sh [clear|file <path> [start] [end]]

SELECTION_FILE="$HOME/.pi/ide-selection.json"

mkdir -p "$HOME/.pi"

if [ "$1" = "clear" ]; then
  echo "Clearing selection..."
  rm -f "$SELECTION_FILE"
  echo "Done!"
  exit 0
fi

if [ "$1" = "show" ]; then
  echo "Current selection:"
  cat "$SELECTION_FILE" 2>/dev/null || echo "(none)"
  exit 0
fi

if [ "$1" = "file" ] && [ -n "$2" ]; then
  FILE="$(realpath "$2")"
  START="${3:-}"
  END="${4:-}"
  
  SELECTION="null"
  if [ -n "$START" ] && [ -n "$END" ]; then
    SELECTION=$(sed -n "${START},${END}p" "$FILE" | jq -Rs .)
  fi
  
  cat > "$SELECTION_FILE" << EOF
{
  "file": "$FILE",
  "selection": $SELECTION,
  "startLine": ${START:-null},
  "endLine": ${END:-null},
  "ide": "shell",
  "timestamp": $(date +%s)000
}
EOF
  echo "Sent: $FILE${START:+ lines $START-$END}"
  exit 0
fi

# Default: send example selection
echo "Sending test selection..."
cat > "$SELECTION_FILE" << 'EOF'
{
  "file": "/Users/pierre/project/src/components/Button.tsx",
  "selection": "export function Button({ children, onClick }: ButtonProps) {\n  return (\n    <button className=\"btn\" onClick={onClick}>\n      {children}\n    </button>\n  );\n}",
  "startLine": 10,
  "endLine": 16,
  "ide": "vscode",
  "timestamp": TIMESTAMP
}
EOF

# Replace timestamp placeholder
sed -i '' "s/TIMESTAMP/$(date +%s)000/" "$SELECTION_FILE"

echo "Done! Check pi for the selection widget."
echo ""
echo "Commands:"
echo "  ./test-selection.sh clear              # Clear selection"
echo "  ./test-selection.sh show               # Show current selection"
echo "  ./test-selection.sh file <path> [s] [e] # Select from real file"
