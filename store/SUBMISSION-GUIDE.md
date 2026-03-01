# Chrome Web Store Submission Guide

## Prerequisites

1. Chrome Web Store developer account ($5 one-time fee)
   - Sign up at: https://chrome.google.com/webstore/devconsole

2. Privacy policy hosted at a public URL
   - The file `privacy-policy.html` is in the repo root
   - Host it via GitHub Pages: enable Pages on your repo (Settings > Pages > Source: main branch), then the URL will be:
     `https://david-mcsharry.github.io/quantify/privacy-policy.html`

## Files Ready

| File | Purpose |
|------|---------|
| `dist/quantify-extension.zip` | Extension package (run `bash scripts/package.sh` to generate) |
| `store/description.txt` | Chrome Web Store listing description (copy-paste) |
| `store/screenshot-1280x800.png` | Promotional screenshot (branded tile) |
| `store/small-tile-440x280.png` | Small promotional tile |
| `icons/icon128.png` | Store icon (128x128) |
| `privacy-policy.html` | Privacy policy page |

## Submission Steps

### 1. Build the zip
```bash
bash scripts/package.sh
```

### 2. Go to the Developer Dashboard
https://chrome.google.com/webstore/devconsole

### 3. Click "New Item" and upload `dist/quantify-extension.zip`

### 4. Fill in the Store Listing tab

- **Language**: English
- **Description**: Copy from `store/description.txt`
- **Category**: Social & Communication
- **Icon**: Already in the zip via manifest.json (128x128)
- **Screenshots**: Upload `store/screenshot-1280x800.png`
  - ALSO take a real screenshot of the extension working on a tweet (1280x800 or 640x400)
  - To take a real screenshot: go to X/Twitter, click Q on a tweet, wait for results, screenshot the browser window, crop to 1280x800
- **Small promo tile** (optional): Upload `store/small-tile-440x280.png`

### 5. Fill in the Privacy tab

- **Privacy policy URL**: Your hosted privacy-policy.html URL
- **Single purpose description**: "Finds prediction markets relevant to the page you're reading"

**Data usage disclosures** (check these options):
- "I do not sell or transfer user data to third parties" -> YES
- "I do not use or transfer user data for purposes unrelated to the item's single purpose" -> YES
- "I do not use or transfer user data to determine creditworthiness or for lending purposes" -> YES

**Data collected**: Select NONE for all categories. The extension does not collect user data — it processes content locally and sends API requests using the user's own key.

### 6. Fill in the Distribution tab

- **Visibility**: Public
- **Markets**: All regions (or select specific ones)

### 7. Justify permissions (if asked)

| Permission | Justification |
|-----------|---------------|
| `activeTab` | Read current page content when user clicks extension icon to find relevant prediction markets |
| `sidePanel` | Display prediction market results in Chrome side panel |
| `storage` | Store user's Anthropic API key and model preference locally |
| `scripting` | Inject prediction market button into X/Twitter tweet action bars |
| `host_permissions: twitter.com, x.com` | Content script injection for tweet analysis feature |
| `host_permissions: api.anthropic.com` | Send content to Anthropic API for relevance filtering (using user's own API key) |
| `host_permissions: api.manifold.markets` | Search Manifold prediction markets |
| `host_permissions: gamma-api.polymarket.com` | Search Polymarket prediction markets |
| `host_permissions: r.jina.ai` | Fallback article text extraction when direct fetch fails |

### 8. Submit for review

Review typically takes 1-3 business days.

**Common rejection reasons and mitigations:**
- Missing privacy policy -> We have one ready
- Overly broad permissions -> All permissions are justified and minimal
- Missing screenshots -> We have generated tiles + you should add a real screenshot
- "Remote code" concern -> All code is bundled in the zip, no remote loading

## Taking a Real Screenshot

The generated promotional images are branded tiles. Chrome Web Store also benefits from a real screenshot showing the extension in action:

1. Load the extension in Chrome
2. Go to a tweet with an interesting topic (politics, crypto, AI, etc.)
3. Click the Q button and wait for results
4. Take a screenshot of the browser showing the tweet + market results
5. Crop to 1280x800 pixels
6. Upload as an additional screenshot in the Store Listing
