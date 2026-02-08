/**
 * Twitter content script - injects Quantify buttons into tweets
 * and displays prediction market context in community-note-style boxes.
 */

(function() {
  if (window.__quantifyTwitterLoaded) return;
  window.__quantifyTwitterLoaded = true;

  const API_URL = 'http://127.0.0.1:18800';
  const PROCESSED_ATTR = 'data-quantify-processed';

  /** Cache of results by tweet text hash */
  const resultsCache = new Map();

  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }

  /**
   * Find all tweets on the page and inject buttons
   */
  function processTweets() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');

    for (const tweet of tweets) {
      if (tweet.hasAttribute(PROCESSED_ATTR)) continue;
      tweet.setAttribute(PROCESSED_ATTR, 'true');

      injectButton(tweet);
    }
  }

  /**
   * Inject the Quantify button into a tweet's action bar
   */
  function injectButton(tweet) {
    // Find the action bar (contains reply, retweet, like, etc.)
    const actionBar = tweet.querySelector('[role="group"]');
    if (!actionBar) return;

    // Create our button container (matches Twitter's action button style)
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'quantify-button-container';

    const button = document.createElement('button');
    button.className = 'quantify-tweet-button';
    button.innerHTML = '<span class="quantify-icon">Q</span>';
    button.title = 'Find prediction market context';

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleButtonClick(tweet, button);
    });

    buttonContainer.appendChild(button);
    actionBar.appendChild(buttonContainer);
  }

  /**
   * Handle click on the Quantify button
   */
  async function handleButtonClick(tweet, button) {
    // Extract tweet text - try multiple sources
    let tweetText = '';

    // 1. Try the main tweet text element
    const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl) {
      tweetText = tweetTextEl.innerText.trim();
    }

    // 2. If no text, try to get card title/description (for link-only tweets)
    if (!tweetText) {
      const cardTitle = tweet.querySelector('[data-testid="card.layoutLarge.detail"] span, [data-testid="card.layoutSmall.detail"] span');
      if (cardTitle) {
        tweetText = cardTitle.innerText.trim();
      }
    }

    // 3. Try any link card text
    if (!tweetText) {
      const cardLink = tweet.querySelector('a[href*="t.co"] span');
      if (cardLink) {
        tweetText = cardLink.innerText.trim();
      }
    }

    // 4. Extract image URLs from the tweet
    const imageUrls = [];
    for (const img of tweet.querySelectorAll('[data-testid="tweetPhoto"] img')) {
      const src = img.src;
      if (src && !src.includes('emoji') && !src.includes('profile_images')) {
        imageUrls.push(src);
      }
    }

    // 5. Extract link card URLs (article attachments)
    const linkUrls = [];
    for (const link of tweet.querySelectorAll('a[href*="t.co"]')) {
      const href = link.href;
      if (href && !linkUrls.includes(href)) {
        // Get the card title if available
        const cardText = link.querySelector('[data-testid="card.layoutSmall.detail"], [data-testid="card.layoutLarge.detail"]');
        const label = cardText ? cardText.innerText.trim() : '';
        linkUrls.push(label ? `${href} (${label})` : href);
      }
    }

    if (!tweetText && imageUrls.length === 0 && linkUrls.length === 0) {
      console.log('[quantify] No tweet content found');
      showError(tweet, 'No content found in this tweet');
      return;
    }

    // Append image URLs to the text for analysis
    if (imageUrls.length > 0) {
      tweetText += '\n\n[Images attached to this tweet:\n' + imageUrls.join('\n') + ']';
    }

    // Append link URLs to the text for analysis
    if (linkUrls.length > 0) {
      tweetText += '\n\n[Links attached to this tweet:\n' + linkUrls.join('\n') + ']';
    }

    console.log('[quantify] Extracted tweet text:', tweetText);

    // Check cache
    const cacheKey = hashText(tweetText);
    if (resultsCache.has(cacheKey)) {
      console.log('[quantify] Cache hit for:', cacheKey);
      showResults(tweet, resultsCache.get(cacheKey));
      return;
    }

    // Show loading state
    button.classList.add('quantify-loading');
    button.disabled = true;

    console.log('[quantify] Sending to backend...');
    try {
      const body = JSON.stringify({ text: tweetText, source: 'twitter' });
      console.log('[quantify] Request body:', body);

      const response = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const data = await response.json();
      console.log('[quantify] Response:', response.status, data.ok, data.error || '');

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      // Cache and show results
      console.log('[quantify] Got results, displaying...');
      resultsCache.set(cacheKey, data.data);
      showResults(tweet, data.data);
    } catch (err) {
      console.error('[quantify] Error:', err);
      showError(tweet, err.message);
    } finally {
      button.classList.remove('quantify-loading');
      button.disabled = false;
    }
  }

  /**
   * Show results in a community-note-style box
   */
  function showResults(tweet, content) {
    // Remove any existing note box
    const existingBox = tweet.querySelector('.quantify-note-box');
    if (existingBox) existingBox.remove();

    // Create the note box
    const noteBox = document.createElement('div');
    noteBox.className = 'quantify-note-box';

    // Header
    const header = document.createElement('div');
    header.className = 'quantify-note-header';
    header.innerHTML = `
      <span class="quantify-note-title">Prediction Market Context</span>
      <button class="quantify-note-close" title="Close">&times;</button>
    `;

    header.querySelector('.quantify-note-close').addEventListener('click', (e) => {
      e.stopPropagation();
      noteBox.remove();
    });

    // Content
    const body = document.createElement('div');
    body.className = 'quantify-note-body';
    body.innerHTML = formatContent(content);

    // Make links open in new tab
    for (const link of body.querySelectorAll('a')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }

    // Footer with Draft Tweet button
    const footer = document.createElement('div');
    footer.className = 'quantify-note-footer';
    const draftBtn = document.createElement('button');
    draftBtn.className = 'quantify-draft-tweet-button';
    draftBtn.textContent = 'Draft Tweet';
    draftBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]');
      const originalText = tweetTextEl ? tweetTextEl.innerText.trim() : '';
      handleDraftTweet(draftBtn, content, originalText);
    });
    footer.appendChild(draftBtn);

    noteBox.appendChild(header);
    noteBox.appendChild(body);
    noteBox.appendChild(footer);

    // Insert after tweet text, before action bar
    const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl && tweetTextEl.parentElement) {
      tweetTextEl.parentElement.insertAdjacentElement('afterend', noteBox);
    } else {
      // Fallback: insert at end of tweet
      tweet.appendChild(noteBox);
    }
  }

  /**
   * Rewrite analysis as a tweet and insert into compose box
   */
  async function handleDraftTweet(button, analysis, tweetText) {
    button.disabled = true;
    button.textContent = 'Drafting...';
    console.log('[quantify] Drafting tweet from analysis...');

    try {
      const response = await fetch(`${API_URL}/rewrite-tweet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis, tweet_text: tweetText }),
      });

      const data = await response.json();
      console.log('[quantify] Rewrite response:', data);

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Rewrite failed');
      }

      // Insert into Twitter's compose box
      const composed = data.data;
      console.log('[quantify] Drafted tweet:', composed);

      const composeBox = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (composeBox) {
        composeBox.focus();
        document.execCommand('insertText', false, composed);
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(composed);
        button.textContent = 'Copied to clipboard!';
        setTimeout(() => { button.textContent = 'Draft Tweet'; button.disabled = false; }, 2000);
        return;
      }

      button.textContent = 'Drafted!';
      setTimeout(() => { button.textContent = 'Draft Tweet'; button.disabled = false; }, 2000);
    } catch (err) {
      console.error('[quantify] Draft tweet error:', err);
      button.textContent = 'Failed';
      setTimeout(() => { button.textContent = 'Draft Tweet'; button.disabled = false; }, 2000);
    }
  }

  /**
   * Show error message
   */
  function showError(tweet, message) {
    const existingBox = tweet.querySelector('.quantify-note-box');
    if (existingBox) existingBox.remove();

    const noteBox = document.createElement('div');
    noteBox.className = 'quantify-note-box quantify-note-error';
    noteBox.innerHTML = `
      <div class="quantify-note-header">
        <span class="quantify-note-title">Error</span>
        <button class="quantify-note-close" title="Close">&times;</button>
      </div>
      <div class="quantify-note-body">${escapeHtml(message)}</div>
    `;

    noteBox.querySelector('.quantify-note-close').addEventListener('click', (e) => {
      e.stopPropagation();
      noteBox.remove();
    });

    const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl && tweetTextEl.parentElement) {
      tweetTextEl.parentElement.insertAdjacentElement('afterend', noteBox);
    } else {
      tweet.appendChild(noteBox);
    }
  }

  /**
   * Format markdown-ish content to HTML
   */
  function formatContent(text) {
    // Simple markdown-like formatting
    return text
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Line breaks
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initial processing
  processTweets();

  // Watch for new tweets (Twitter is a SPA)
  const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldProcess = true;
        break;
      }
    }
    if (shouldProcess) {
      processTweets();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('[quantify] Twitter content script loaded');
})();
