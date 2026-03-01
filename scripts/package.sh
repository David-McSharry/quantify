#!/bin/bash
# Build a Chrome extension ZIP for Chrome Web Store submission
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$ROOT_DIR/dist"
ZIP_NAME="quantify-extension.zip"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/ext"

# Copy extension files
FILES=(
  manifest.json
  background.js
  popup.html
  popup.js
  sidepanel.html
  sidepanel.js
  sidepanel.css
  options.html
  options.js
  content-script.js
  content-highlight.css
  twitter-content.js
  twitter-content.css
  LICENSE
)

for f in "${FILES[@]}"; do
  cp "$ROOT_DIR/$f" "$OUT_DIR/ext/$f"
done

# Copy directories
mkdir -p "$OUT_DIR/ext/lib"
cp "$ROOT_DIR/lib/gateway.js" "$OUT_DIR/ext/lib/"
cp "$ROOT_DIR/lib/marked.esm.js" "$OUT_DIR/ext/lib/"
cp "$ROOT_DIR/lib/market-search.js" "$OUT_DIR/ext/lib/"

mkdir -p "$OUT_DIR/ext/icons"
cp "$ROOT_DIR/icons/"*.png "$OUT_DIR/ext/icons/"

mkdir -p "$OUT_DIR/ext/prompts"
cp "$ROOT_DIR/prompts/"*.md "$OUT_DIR/ext/prompts/"

# Create ZIP
cd "$OUT_DIR/ext"
zip -r "$OUT_DIR/$ZIP_NAME" . -x ".*"
cd "$ROOT_DIR"

# Clean up temp dir
rm -rf "$OUT_DIR/ext"

echo ""
echo "Extension packaged: $OUT_DIR/$ZIP_NAME"
SIZE=$(du -h "$OUT_DIR/$ZIP_NAME" | cut -f1)
echo "Size: $SIZE"
