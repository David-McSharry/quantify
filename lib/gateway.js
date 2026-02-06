/**
 * Gateway client — talks to the local proxy via HTTP.
 * Dead simple: POST /analyze with { url } and get results back.
 */

const DEFAULT_PROXY_URL = 'http://127.0.0.1:18800';

export async function loadSettings() {
  const result = await chrome.storage.local.get(['proxyUrl']);
  return {
    proxyUrl: result.proxyUrl || DEFAULT_PROXY_URL,
  };
}

export async function saveSettings(proxyUrl) {
  await chrome.storage.local.set({ proxyUrl });
}

/**
 * Send a URL to the proxy for analysis.
 * @param {string} url - The page URL to analyze
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<object>} The analysis result
 */
export async function analyzeUrl(url, signal) {
  const { proxyUrl } = await loadSettings();

  const response = await fetch(`${proxyUrl}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data.data;
}

/**
 * Check if the proxy is reachable.
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
export async function testConnection() {
  const { proxyUrl } = await loadSettings();

  try {
    const response = await fetch(`${proxyUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    return { ok: data.ok === true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
