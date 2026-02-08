import { testConnection } from './lib/gateway.js';

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
});
