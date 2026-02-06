const urlInput = document.getElementById('gateway-url');
const saveBtn = document.getElementById('save-btn');
const testBtn = document.getElementById('test-btn');
const statusEl = document.getElementById('status');

const DEFAULT_URL = 'http://127.0.0.1:18800';
let statusTimer = null;

function showStatus(message, type) {
  if (statusTimer) clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  if (type !== 'info') {
    statusTimer = setTimeout(() => { statusEl.className = 'status'; }, 5000);
  }
}

chrome.storage.local.get(['proxyUrl'], (result) => {
  urlInput.value = result.proxyUrl || DEFAULT_URL;
});

saveBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) { showStatus('URL is required.', 'error'); return; }
  chrome.storage.local.set({ proxyUrl: url }, () => {
    showStatus('Saved.', 'success');
  });
});

testBtn.addEventListener('click', () => {
  showStatus('Testing...', 'info');
  testBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'test-connection' }, (response) => {
    testBtn.disabled = false;
    if (chrome.runtime.lastError) {
      showStatus(`Failed: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    if (response?.ok) showStatus('Connected!', 'success');
    else showStatus(`Failed: ${response?.message || 'unreachable'}`, 'error');
  });
});

urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
