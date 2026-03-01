// Popup fallback for browsers where chrome.action.onClicked doesn't fire (e.g. Arc).
// Dynamically enabled by background.js only when needed.

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    window.close();
    return;
  }

  await chrome.storage.local.set({ pendingAnalysis: tab.url });

  // Try side panel
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    chrome.runtime.sendMessage({ type: 'analyze', url: tab.url }).catch(() => {});
    window.close();
    return;
  } catch {}

  // Fallback: open in a new tab
  await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
  window.close();
})();
