# Quantify

A Chrome extension that surfaces prediction market data relevant to the content you're reading. Works on tweets (X/Twitter) and any webpage.

## How It Works

When you click the Quantify button on a tweet or open the side panel on any page, the extension:

1. Extracts key topics from the content
2. Searches four prediction market platforms (Manifold, Polymarket, Kalshi, Metaculus)
3. Uses Claude to filter for genuinely relevant markets and format the results
4. Shows you the most relevant markets with current probabilities and direct links

## Setup

Quantify is a BYOK (Bring Your Own Key) extension — you provide your own Anthropic API key.

1. Install the extension from the Chrome Web Store (or load unpacked for development)
2. Click the extension icon or go to **Settings** (right-click icon → Options)
3. Enter your [Anthropic API key](https://console.anthropic.com/)
4. Click **Save & Test**

## Usage

**On Twitter/X:** A "Q" button appears in the action bar of each tweet. Click it to see prediction market context for that tweet.

**On any page:** Click the Quantify icon in the toolbar to open the side panel with market analysis for the current page.

**Keyboard shortcut:** `Ctrl+Shift+Q` (Windows/Linux) or `Cmd+Shift+Y` (Mac)

## What Data Is Sent

- **Tweet/page text** is sent to the Anthropic API for query generation and relevance filtering
- **Search queries** are sent to Manifold, Polymarket, Kalshi, and Metaculus public APIs
- **No data is stored** on any server — your API key is stored locally in Chrome extension storage
- **No analytics or tracking** — the extension makes no requests beyond the market APIs and Anthropic

## Development

```bash
# Load as unpacked extension
# 1. Go to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select this directory

# Package for Chrome Web Store
bash scripts/package.sh
# Output: dist/quantify-extension.zip

# Regenerate icons from SVG source
node scripts/generate-icons.js
```

## Architecture

```
Chrome Extension (Manifest V3, no build step)
    │
    ├── twitter-content.js    Content script on X/Twitter (Q button + result display)
    ├── background.js         Service worker (message routing)
    ├── sidepanel.js          Side panel for page analysis
    ├── options.js            BYOK settings page
    │
    └── lib/
        ├── gateway.js        Orchestrator: query building, Anthropic API, market aggregation
        ├── market-search.js  4-platform search: Manifold, Polymarket, Kalshi, Metaculus
        └── marked.esm.js     Markdown renderer (vendored)
```

All market API calls and LLM calls happen directly in the extension — no backend server required.

## License

MIT
