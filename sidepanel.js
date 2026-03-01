import { analyzeUrl, askQuestion } from './lib/gateway.js';
import { marked } from './lib/marked.esm.js';

const stateIdle = document.getElementById('state-idle');
const stateLoading = document.getElementById('state-loading');
const stateResults = document.getElementById('state-results');
const stateError = document.getElementById('state-error');
const loadingUrl = document.getElementById('loading-url');
const loadingStatus = document.getElementById('loading-status');
const resultsUrl = document.getElementById('results-url');
const responseText = document.getElementById('response-text');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');

/** @type {AbortController|null} */
let inflightController = null;
/** @type {string|null} */
let lastUrl = null;
/** @type {number|null} */
let activeTabId = null;

function showState(state) {
  stateIdle.classList.toggle('hidden', state !== 'idle');
  stateLoading.classList.toggle('hidden', state !== 'loading');
  stateResults.classList.toggle('hidden', state !== 'results');
  stateError.classList.toggle('hidden', state !== 'error');
  if (state !== 'results') {
    document.getElementById('ask-bar').classList.add('hidden');
    document.getElementById('ask-panel').classList.add('hidden');
  }
}

function truncateUrl(url, maxLen = 50) {
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen) + '...';
}

async function clearPreviousHighlights() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'clear-highlights' }).catch(() => {});
    }
  } catch {}
}

async function injectAndHighlight(quotes) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    activeTabId = tab.id;

    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content-highlight.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });

    chrome.tabs.sendMessage(tab.id, { type: 'highlight-quotes', quotes });
  } catch {}
}

async function runAnalysis(url) {
  if (inflightController) inflightController.abort();
  inflightController = new AbortController();
  const { signal } = inflightController;

  await clearPreviousHighlights();

  lastUrl = url;
  loadingUrl.textContent = truncateUrl(url);
  loadingStatus.textContent = 'Fetching...';
  showState('loading');

  try {
    const onProgress = (p) => { loadingStatus.textContent = p.message; };
    const result = await analyzeUrl(url, signal, onProgress);
    if (signal.aborted) return;
    const text = typeof result === 'object' ? result.analysis : result;
    const articleBody = typeof result === 'object' ? result.articleText : '';
    // Store full context for follow-up questions
    lastArticleText = `URL: ${url}\n\nArticle text:\n${articleBody}\n\nPrediction markets found:\n${text}`;
    resultsUrl.textContent = truncateUrl(url);
    responseText.innerHTML = marked.parse(text);

    // Open links in new tab so they don't navigate inside the side panel
    for (const a of responseText.querySelectorAll('a')) {
      a.target = '_blank';
      a.rel = 'noopener';
    }

    // Extract quotes from <em> tags and set up highlighting
    const emElements = responseText.querySelectorAll('em');
    const quotes = [];
    for (const [i, em] of emElements.entries()) {
      em.setAttribute('data-quote-id', String(i));
      em.classList.add('quantify-sidebar-quote');
      quotes.push(em.textContent);

      em.addEventListener('mouseenter', () => {
        em.classList.add('quantify-sidebar-quote-active');
        if (activeTabId) {
          chrome.tabs.sendMessage(activeTabId, {
            type: 'quote-hover-from-sidebar', quoteId: i, active: true,
          }).catch(() => {});
        }
      });
      em.addEventListener('mouseleave', () => {
        em.classList.remove('quantify-sidebar-quote-active');
        if (activeTabId) {
          chrome.tabs.sendMessage(activeTabId, {
            type: 'quote-hover-from-sidebar', quoteId: i, active: false,
          }).catch(() => {});
        }
      });
    }

    if (quotes.length > 0) {
      console.log(`[quantify] extracted ${quotes.length} quotes from response:`, quotes);
      await injectAndHighlight(quotes);
    } else {
      console.log('[quantify] no <em> tags found in response');
    }

    showState('results');
    showAskBar(true);
    askPanel.classList.add('hidden');
    askResponse.innerHTML = '';
  } catch (err) {
    if (signal.aborted) return;
    if (err.message === 'API_KEY_MISSING') {
      errorMessage.textContent = 'Please add your Anthropic API key in settings. Opening now...';
      chrome.runtime.openOptionsPage();
    } else {
      errorMessage.textContent = err.message || 'An unknown error occurred.';
    }
    showState('error');
  } finally {
    if (inflightController?.signal === signal) inflightController = null;
  }
}

// Listen for hover events from the content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'analyze') {
    runAnalysis(message.url);
    return;
  }

  if (message.type === 'quote-hover') {
    const em = responseText.querySelector(`em[data-quote-id="${message.quoteId}"]`);
    if (!em) return;
    em.classList.toggle('quantify-sidebar-quote-active', message.active);
    if (message.active) {
      em.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  if (message.type === 'quote-match-results') {
    // Dim quotes that weren't found on the page
    const matchedSet = new Set(message.matched);
    for (const em of responseText.querySelectorAll('em.quantify-sidebar-quote')) {
      const id = Number(em.getAttribute('data-quote-id'));
      em.classList.toggle('quantify-sidebar-quote-unmatched', !matchedSet.has(id));
    }
  }
});

retryBtn.addEventListener('click', () => {
  if (lastUrl) {
    runAnalysis(lastUrl);
  }
});

// ─── Ask feature ─────────────────────────────────────────────

const askBar = document.getElementById('ask-bar');
const askPanel = document.getElementById('ask-panel');
const askInput = document.getElementById('ask-input');
const askBtn = document.getElementById('ask-btn');
const askResponse = document.getElementById('ask-response');
const askLoading = document.getElementById('ask-loading');
let askController = null;
let lastArticleText = null;

function showAskBar(visible) {
  askBar.classList.toggle('hidden', !visible);
}

async function handleAsk() {
  const question = askInput.value.trim();
  if (!question) return;

  if (askController) askController.abort();
  askController = new AbortController();
  const { signal } = askController;

  askBtn.disabled = true;
  askPanel.classList.remove('hidden');
  askLoading.classList.remove('hidden');
  askResponse.innerHTML = '';

  try {
    const result = await askQuestion(question, lastArticleText, signal);
    if (signal.aborted) return;
    askResponse.innerHTML = marked.parse(result);
    for (const a of askResponse.querySelectorAll('a')) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    askInput.value = '';
  } catch (err) {
    if (!signal.aborted) {
      askResponse.innerHTML = `<p style="color: var(--error)">${err.message}</p>`;
    }
  } finally {
    askBtn.disabled = false;
    askLoading.classList.add('hidden');
    if (askController?.signal === signal) askController = null;
  }
}

askBtn.addEventListener('click', handleAsk);
askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAsk();
});

showState('idle');

// Check for a pending analysis (set by background before opening the panel)
chrome.storage.local.get('pendingAnalysis').then(({ pendingAnalysis }) => {
  if (pendingAnalysis) {
    chrome.storage.local.remove('pendingAnalysis');
    runAnalysis(pendingAnalysis);
  }
});
