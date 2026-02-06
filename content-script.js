(() => {
  if (window.__quantifyLoaded) return;
  window.__quantifyLoaded = true;

  /** Invisible Unicode chars that news sites inject for tracking/layout */
  const INVISIBLE_RE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u200E\u200F]/g;

  /** @type {Map<number, HTMLElement[]>} quoteId -> list of <mark> elements */
  const marksByQuote = new Map();

  /**
   * Build a flat text map of the page.
   * Returns clean text (invisible chars stripped) plus a mapping
   * from clean-text indices back to original text positions.
   */
  function buildTextMap() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const entries = [];
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const len = node.textContent.length;
      if (len > 0) {
        entries.push({ node, offset, length: len });
        offset += len;
      }
    }

    const rawText = entries.map(e => e.node.textContent).join('');

    // Build clean text + index mapping (clean index -> raw index)
    const indexMap = [];
    const cleanChars = [];
    for (let i = 0; i < rawText.length; i++) {
      if (!INVISIBLE_RE.test(rawText[i])) {
        indexMap.push(i);
        cleanChars.push(rawText[i]);
      }
      INVISIBLE_RE.lastIndex = 0; // reset regex state
    }

    return { entries, rawText, cleanText: cleanChars.join(''), indexMap };
  }

  /**
   * Turn a quote into a case-insensitive regex with flexible
   * whitespace and smart/straight quote matching.
   */
  function quoteToRegex(quote) {
    // Strip invisible chars from the quote too
    const stripped = quote.replace(INVISIBLE_RE, '');
    INVISIBLE_RE.lastIndex = 0;

    // Strip leading/trailing quotation marks the LLM may have wrapped around the quote
    const trimmed = stripped.replace(/^[\s"'\u2018\u2019\u201C\u201D]+|[\s"'\u2018\u2019\u201C\u201D]+$/g, '');

    // Normalize smart quotes to straight
    const straight = trimmed
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D\u2033]/g, '"');

    // Escape regex special characters
    const escaped = straight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Make whitespace flexible
    const flexWs = escaped.replace(/\s+/g, '\\s+');

    // Make quotes match either smart or straight variants
    const flexQuotes = flexWs
      .replace(/'/g, "['\u2018\u2019\u2032]")
      .replace(/"/g, '["\u201C\u201D\u2033]');

    try {
      return new RegExp(flexQuotes, 'i');
    } catch {
      return null;
    }
  }

  /**
   * Find which text nodes a raw-text range (matchStart..matchEnd) spans.
   */
  function findNodesForRange(entries, matchStart, matchEnd) {
    const result = [];
    for (const entry of entries) {
      const nodeEnd = entry.offset + entry.length;
      if (entry.offset >= matchEnd) break;
      if (nodeEnd <= matchStart) continue;
      result.push({
        node: entry.node,
        startInNode: Math.max(0, matchStart - entry.offset),
        endInNode: Math.min(entry.length, matchEnd - entry.offset),
      });
    }
    return result;
  }

  function highlightQuotes(quotes) {
    clearHighlights();
    const matched = [];

    console.log(`[quantify] searching for ${quotes.length} quotes`);

    for (let i = 0; i < quotes.length; i++) {
      const quote = quotes[i];
      if (!quote || quote.length < 8) {
        console.log(`[quantify] quote ${i}: too short, skipping ("${quote}")`);
        continue;
      }

      const regex = quoteToRegex(quote);
      if (!regex) {
        console.log(`[quantify] quote ${i}: invalid regex, skipping`);
        continue;
      }

      // Rebuild text map each time (previous wraps mutate the DOM)
      const { entries, cleanText, indexMap } = buildTextMap();

      console.log(`[quantify] quote ${i}: searching for "${quote.substring(0, 50)}..."`);
      const match = regex.exec(cleanText);

      if (!match) {
        console.log(`[quantify] quote ${i}: no match`);
        continue;
      }

      // Map clean-text match indices back to raw-text indices
      const rawStart = indexMap[match.index];
      const rawEndCleanIdx = match.index + match[0].length;
      const rawEnd = rawEndCleanIdx < indexMap.length
        ? indexMap[rawEndCleanIdx]
        : indexMap[indexMap.length - 1] + 1;

      const nodeRanges = findNodesForRange(entries, rawStart, rawEnd);

      const marks = [];
      for (const nr of nodeRanges) {
        try {
          const range = document.createRange();
          range.setStart(nr.node, nr.startInNode);
          range.setEnd(nr.node, nr.endInNode);

          const mark = document.createElement('mark');
          mark.className = 'quantify-highlight';
          mark.dataset.quoteId = String(i);
          range.surroundContents(mark);

          mark.addEventListener('mouseenter', () => onMarkHover(i, true));
          mark.addEventListener('mouseleave', () => onMarkHover(i, false));
          marks.push(mark);
        } catch (err) {
          console.log(`[quantify] quote ${i}: wrap failed:`, err.message);
        }
      }

      if (marks.length > 0) {
        marksByQuote.set(i, marks);
        matched.push(i);
        console.log(`[quantify] quote ${i}: highlighted (${marks.length} segments)`);
      }
    }

    console.log(`[quantify] done: ${matched.length}/${quotes.length} quotes matched`);
    chrome.runtime.sendMessage({ type: 'quote-match-results', matched });
  }

  function onMarkHover(quoteId, active) {
    const marks = marksByQuote.get(quoteId) || [];
    for (const m of marks) {
      m.classList.toggle('quantify-highlight-active', active);
    }
    chrome.runtime.sendMessage({ type: 'quote-hover', quoteId, active });
  }

  function clearHighlights() {
    for (const marks of marksByQuote.values()) {
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      }
    }
    marksByQuote.clear();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'highlight-quotes') {
      highlightQuotes(message.quotes);
    } else if (message.type === 'quote-hover-from-sidebar') {
      const marks = marksByQuote.get(message.quoteId) || [];
      for (const m of marks) {
        m.classList.toggle('quantify-highlight-active', message.active);
      }
      if (message.active && marks.length > 0) {
        marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (message.type === 'clear-highlights') {
      clearHighlights();
      window.__quantifyLoaded = false;
    }
  });
})();
