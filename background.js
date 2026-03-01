import { analyzeText, rewriteTweet, fetchArticleText } from './lib/gateway.js';

// ─── Open side panel, fall back to new tab ───────────────────

async function openPanel(tab) {
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  await chrome.storage.local.set({ pendingAnalysis: tab.url });

  // Try side panel first
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    chrome.runtime.sendMessage({ type: 'analyze', url: tab.url }).catch(() => {});
    return;
  } catch (err) {
    console.warn('[background] sidePanel.open failed, falling back to tab:', err.message);
  }

  // Fallback: open sidepanel.html in a new tab
  chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
}

// ─── Entry points ────────────────────────────────────────────

// 1. Icon click (Chrome — won't fire if popup is set for Arc)
chrome.action.onClicked.addListener(openPanel);

// 2. Keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'analyze-page') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    openPanel(tab);
  }
});

// 3. Context menu (universal fallback — works in Arc and everywhere)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'quantify-analyze',
    title: 'Analyze with Quantify',
    contexts: ['page', 'selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'quantify-analyze') openPanel(tab);
});

// 4. Detect browsers where onClicked doesn't fire (Arc) and set popup fallback.
//    Arc's UA contains "Arc/" — if detected, set a popup so the icon click works.
(async () => {
  try {
    const ua = await chrome.runtime.getPlatformInfo().then(() => navigator.userAgent);
    if (ua.includes('Arc/')) {
      console.log('[background] Arc detected — enabling popup fallback');
      chrome.action.setPopup({ popup: 'popup.html' });
    }
  } catch {}
})();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message.type === 'analyze-tweet') {
    const tabId = sender.tab?.id;
    const onProgress = tabId
      ? (progress) => chrome.tabs.sendMessage(tabId, { type: 'quantify-progress', ...progress }).catch(() => {})
      : undefined;

    (async () => {
      let text = message.text;

      // Pre-fetch linked articles and append content
      const linkUrls = message.linkUrls || [];
      if (linkUrls.length > 0) {
        if (onProgress) onProgress({ step: 'fetching', message: `Fetching ${linkUrls.length} linked article${linkUrls.length > 1 ? 's' : ''}...` });
        const fetched = await Promise.all(
          linkUrls.map(async (url) => {
            try {
              const content = await fetchArticleText(url);
              console.log(`[background] fetched article from ${url}: ${content.length} chars`);
              return { url, content };
            } catch (err) {
              console.warn(`[background] failed to fetch ${url}:`, err.message);
              return null;
            }
          }),
        );
        const articles = fetched.filter(Boolean);
        if (articles.length > 0) {
          text += '\n\n[Linked article content:';
          for (const { url, content } of articles) {
            text += `\n\n--- ${url} ---\n${content}`;
          }
          text += ']';
        }
      }

      return analyzeText(text, undefined, onProgress);
    })()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'rewrite-tweet') {
    rewriteTweet(message.analysis, message.tweetText || '')
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
