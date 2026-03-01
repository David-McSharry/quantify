# Quantify

A Chrome extension that surfaces prediction market data relevant to the content you're reading. Works on tweets (X/Twitter) and any webpage.

## How It Works

When you click the Quantify button on a tweet or open the side panel on any page, an AI agent:

1. Reads the content and decides what to search for
2. Searches prediction markets on Manifold and Polymarket
3. Iterates — refining queries based on what it finds
4. Returns the most relevant markets with live probabilities and direct links

The agent uses tool calling (Anthropic Messages API) to drive a search loop. Typically 2–3 iterations, max 10.

## Setup

Quantify is a BYOK (Bring Your Own Key) extension — you provide your own Anthropic API key.

1. Install the extension from the Chrome Web Store (or load unpacked for development)
2. Click the extension icon or go to **Settings** (right-click icon → Options)
3. Enter your [Anthropic API key](https://console.anthropic.com/)
4. Click **Save**

## Usage

**On Twitter/X:** A "Q" button appears in the action bar of each tweet. Click it to see prediction market context for that tweet.

**On any page:** Click the Quantify icon in the toolbar to open the side panel with market analysis for the current page. You can ask follow-up questions in the input bar at the bottom.

**Keyboard shortcut:** `Ctrl+Shift+Q` (Windows/Linux) or `Cmd+Shift+Y` (Mac)

## What Data Is Sent

- **Tweet/page text** is sent to the Anthropic API using your own API key
- **Search queries** are sent to Manifold and Polymarket public APIs
- **Article text** may be fetched via [Jina](https://r.jina.ai) as a fallback when direct fetch fails
- **No data is stored** on any server — your API key is stored locally in Chrome extension storage
- **No analytics or tracking** — the extension makes no requests beyond the market APIs, Anthropic, and Jina

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
    ├── background.js         Service worker (message routing, article pre-fetch)
    ├── sidepanel.js          Side panel for page analysis + ask feature
    ├── options.js            BYOK settings page
    │
    ├── prompts/              Prompt templates loaded at runtime
    │   ├── system.md         Base system prompt
    │   ├── tweet.md          Tweet output format
    │   ├── article.md        Article output format
    │   └── ask.md            Follow-up question format
    │
    └── lib/
        ├── gateway.js        Agent loop: Anthropic API with tool calling
        ├── market-search.js  Manifold + Polymarket search
        └── marked.esm.js     Markdown renderer (vendored)
```

All market API calls and LLM calls happen directly in the extension — no backend server required.

## License

MIT
