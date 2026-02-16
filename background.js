import { testConnection, analyzeText, rewriteTweet } from './lib/gateway.js';

async function analyzeCurrentTab(tab) {
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  // Must open panel synchronously (before any await) to stay in user gesture context
  chrome.storage.local.set({ pendingAnalysis: tab.url });
  await chrome.sidePanel.open({ tabId: tab.id });

  // Also send a message in case the panel is already open
  chrome.runtime.sendMessage({ type: 'analyze', url: tab.url }).catch(() => {});
}

chrome.action.onClicked.addListener(analyzeCurrentTab);

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'analyze-page') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    analyzeCurrentTab(tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'test-connection') {
    testConnection().then(sendResponse);
    return true;
  }

  if (message.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message.type === 'analyze-tweet') {
    analyzeText(message.text)
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
