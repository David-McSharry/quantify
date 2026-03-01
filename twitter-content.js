/**
 * Twitter content script - injects Quantify buttons into tweets
 * and displays prediction market context in community-note-style boxes.
 */

(function() {
  if (window.__quantifyTwitterLoaded) return;
  window.__quantifyTwitterLoaded = true;

  const PROCESSED_ATTR = 'data-quantify-processed';

  /** Cache of results by tweet text hash */
  const resultsCache = new Map();

  /** Currently active progress element (set during analysis) */
  let activeProgressEl = null;

  // Listen for progress updates from the background service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'quantify-progress' && activeProgressEl) {
      activeProgressEl.textContent = message.message;
    }
  });

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
   * Extract text + metadata from a single tweet article element.
   */
  function extractTweetContent(tweetEl) {
    let text = '';
    const tweetTextEl = tweetEl.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl) text = tweetTextEl.innerText.trim();

    if (!text) {
      const cardTitle = tweetEl.querySelector('[data-testid="card.layoutLarge.detail"] span, [data-testid="card.layoutSmall.detail"] span');
      if (cardTitle) text = cardTitle.innerText.trim();
    }
    if (!text) {
      const cardLink = tweetEl.querySelector('a[href*="t.co"] span');
      if (cardLink) text = cardLink.innerText.trim();
    }

    // Author: User-Name contains display name + @handle
    const userNameEl = tweetEl.querySelector('[data-testid="User-Name"]');
    const author = userNameEl ? userNameEl.innerText.replace(/\n/g, ' ').trim() : '';

    // Timestamp
    const timeEl = tweetEl.querySelector('time');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : '';

    // Engagement metrics from the action bar aria-labels
    const metrics = {};
    for (const btn of tweetEl.querySelectorAll('[role="group"] button[aria-label]')) {
      const label = btn.getAttribute('aria-label') || '';
      // Labels like "123 Likes", "45 Reposts", "12 Replies", "67 Bookmarks"
      const match = label.match(/^(\d[\d,]*)\s+(repl|like|repost|bookmark|view)/i);
      if (match) {
        const key = match[2].toLowerCase().replace(/^repl.*/, 'replies').replace(/^like.*/, 'likes').replace(/^repost.*/, 'reposts').replace(/^bookmark.*/, 'bookmarks').replace(/^view.*/, 'views');
        metrics[key] = match[1].replace(/,/g, '');
      }
    }

    // Quoted tweet
    const quotedEl = tweetEl.querySelector('[data-testid="quoteTweet"]');
    let quotedText = '';
    if (quotedEl) {
      const qtText = quotedEl.querySelector('[data-testid="tweetText"]');
      const qtUser = quotedEl.querySelector('[data-testid="User-Name"]');
      if (qtText) {
        quotedText = (qtUser ? qtUser.innerText.replace(/\n/g, ' ').trim() + ': ' : '') + qtText.innerText.trim();
      }
    }

    return { text, author, timestamp, metrics, quotedText };
  }

  /**
   * Format a tweet summary for context.
   */
  function formatTweetSummary(info) {
    let line = '';
    if (info.author) line += info.author + ': ';
    line += info.text;
    return line;
  }

  /**
   * Gather thread context: parent tweets above and visible replies below.
   */
  function gatherThreadContext(targetTweet) {
    const allTweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const targetIdx = allTweets.indexOf(targetTweet);
    if (targetIdx === -1) return { before: [], after: [] };

    const before = [];
    const after = [];

    // Grab up to 5 tweets before (thread parents / conversation)
    for (let i = Math.max(0, targetIdx - 5); i < targetIdx; i++) {
      const info = extractTweetContent(allTweets[i]);
      if (info.text) before.push(formatTweetSummary(info));
    }

    // Grab up to 5 tweets after (replies)
    for (let i = targetIdx + 1; i < Math.min(allTweets.length, targetIdx + 6); i++) {
      const info = extractTweetContent(allTweets[i]);
      if (info.text) after.push(formatTweetSummary(info));
    }

    return { before, after };
  }

  /**
   * Handle click on the Quantify button
   */
  async function handleButtonClick(tweet, button) {
    const main = extractTweetContent(tweet);

    // Extract image URLs from the tweet
    const imageUrls = [];
    for (const img of tweet.querySelectorAll('[data-testid="tweetPhoto"] img')) {
      const src = img.src;
      if (src && !src.includes('emoji') && !src.includes('profile_images')) {
        imageUrls.push(src);
      }
    }

    // Extract link card URLs with domain info
    const linkUrls = [];
    for (const link of tweet.querySelectorAll('a[href*="t.co"]')) {
      const href = link.href;
      if (href && !linkUrls.includes(href)) {
        const cardText = link.querySelector('[data-testid="card.layoutSmall.detail"], [data-testid="card.layoutLarge.detail"]');
        const label = cardText ? cardText.innerText.trim() : '';
        linkUrls.push(label ? `${href} (${label})` : href);
      }
    }

    if (!main.text && imageUrls.length === 0 && linkUrls.length === 0) {
      console.log('[quantify] No tweet content found');
      showError(tweet, 'No content found in this tweet');
      return;
    }

    // Build full context string
    let tweetText = '';
    const { before, after } = gatherThreadContext(tweet);

    if (before.length > 0) {
      tweetText += '[Thread context (earlier tweets):\n' + before.join('\n') + ']\n\n';
    }

    // Target tweet with metadata
    tweetText += '[TARGET TWEET]';
    if (main.author) tweetText += '\nAuthor: ' + main.author;
    if (main.timestamp) tweetText += '\nPosted: ' + main.timestamp;
    tweetText += '\n' + main.text;

    // Engagement signals
    const metricParts = [];
    if (main.metrics.likes) metricParts.push(main.metrics.likes + ' likes');
    if (main.metrics.reposts) metricParts.push(main.metrics.reposts + ' reposts');
    if (main.metrics.replies) metricParts.push(main.metrics.replies + ' replies');
    if (main.metrics.views) metricParts.push(main.metrics.views + ' views');
    if (metricParts.length > 0) {
      tweetText += '\nEngagement: ' + metricParts.join(', ');
    }

    // Quoted tweet
    if (main.quotedText) {
      tweetText += '\n\n[Quoting: ' + main.quotedText + ']';
    }

    if (imageUrls.length > 0) {
      tweetText += '\n\n[Images attached:\n' + imageUrls.join('\n') + ']';
    }
    if (linkUrls.length > 0) {
      tweetText += '\n\n[Links attached:\n' + linkUrls.join('\n') + ']';
    }

    if (after.length > 0) {
      tweetText += '\n\n[Replies and discussion:\n' + after.join('\n') + ']';
    }

    console.log('[quantify] Extracted context:', tweetText);

    // Check cache
    const cacheKey = hashText(tweetText);
    if (resultsCache.has(cacheKey)) {
      console.log('[quantify] Cache hit for:', cacheKey);
      showResults(tweet, resultsCache.get(cacheKey));
      return;
    }

    // Show loading state with progress indicator
    button.classList.add('quantify-loading');
    button.disabled = true;

    const progressEl = document.createElement('div');
    progressEl.className = 'quantify-progress';
    progressEl.textContent = 'Analyzing content...';
    const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl && tweetTextEl.parentElement) {
      tweetTextEl.parentElement.insertAdjacentElement('afterend', progressEl);
    } else {
      tweet.appendChild(progressEl);
    }
    activeProgressEl = progressEl;

    console.log('[quantify] Sending to extension agent...');
    try {
      if (!chrome.runtime?.id) {
        throw new Error('Extension was updated. Please refresh the page.');
      }
      // Extract raw t.co URLs for article pre-fetching
      const rawLinkUrls = [];
      for (const link of tweet.querySelectorAll('a[href*="t.co"]')) {
        if (link.href && !rawLinkUrls.includes(link.href)) {
          rawLinkUrls.push(link.href);
        }
      }

      const response = await chrome.runtime.sendMessage({
        type: 'analyze-tweet',
        text: tweetText,
        linkUrls: rawLinkUrls,
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Analysis failed');
      }

      // Cache and show results
      console.log('[quantify] Got results, displaying...');
      resultsCache.set(cacheKey, response.data);
      showResults(tweet, response.data);
    } catch (err) {
      console.error('[quantify] Error:', err);
      if (err.message === 'API_KEY_MISSING') {
        showError(tweet, 'Please add your Anthropic API key in Quantify settings.');
        try { chrome.runtime.sendMessage({ type: 'open-options' }); } catch {}
      } else {
        showError(tweet, err.message);
      }
    } finally {
      button.classList.remove('quantify-loading');
      button.disabled = false;
      progressEl.remove();
      activeProgressEl = null;
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
      const response = await chrome.runtime.sendMessage({
        type: 'rewrite-tweet',
        analysis,
        tweetText,
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Rewrite failed');
      }

      // Insert into Twitter's compose box
      const composed = response.data;
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

    if (message.includes('Anthropic API key')) {
      const body = noteBox.querySelector('.quantify-note-body');
      const ctaWrap = document.createElement('div');
      ctaWrap.style.marginTop = '10px';
      const cta = document.createElement('button');
      cta.className = 'quantify-draft-tweet-button';
      cta.textContent = 'Open Settings';
      cta.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.openOptionsPage();
      });
      ctaWrap.appendChild(cta);
      body.appendChild(ctaWrap);
    }

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
    // Escape HTML first to prevent XSS, then apply markdown transforms
    let safe = escapeHtml(text);
    return safe
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Links: [text](url) — only allow http/https URLs
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
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
