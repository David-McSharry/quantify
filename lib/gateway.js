import { searchMarkets } from './market-search.js';

const DEFAULT_MODEL = 'claude-opus-4-6';
const MAX_ITERATIONS = 10;

// ─── Settings ────────────────────────────────────────────────

export async function loadSettings() {
  const result = await chrome.storage.local.get(['anthropicApiKey', 'anthropicModel']);
  return {
    anthropicApiKey: result.anthropicApiKey || '',
    anthropicModel: result.anthropicModel || DEFAULT_MODEL,
  };
}

export async function saveSettings({ anthropicApiKey, anthropicModel }) {
  await chrome.storage.local.set({
    anthropicApiKey: anthropicApiKey || '',
    anthropicModel: anthropicModel || DEFAULT_MODEL,
  });
}

// ─── Tool definition (Anthropic format) ──────────────────────

const TOOLS = [
  {
    name: 'search_markets',
    description: 'Search for prediction markets across Manifold and Polymarket. Returns markets with titles, current probabilities, URLs, volume, and descriptions.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g. "bitcoin price", "fed rate cut", "Trump 2028")',
        },
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['manifold', 'polymarket'] },
          description: 'Optional: filter to specific platforms. Searches all by default.',
        },
      },
      required: ['query'],
    },
  },
];

// ─── Tool execution ──────────────────────────────────────────

async function executeToolCall(name, input, signal) {
  if (name === 'search_markets') {
    return searchMarkets(input.query, input.platforms || null, signal);
  }
  throw new Error(`Unknown tool: ${name}`);
}

// ─── Agent loop ──────────────────────────────────────────────

// ─── Prompts (loaded from .md files) ─────────────────────────

async function loadPrompt(filename) {
  const url = chrome.runtime.getURL(`prompts/${filename}`);
  const response = await fetch(url);
  return response.text();
}

let _promptCache = null;
async function getPrompts() {
  if (!_promptCache) {
    const [system, tweet, article, ask] = await Promise.all([
      loadPrompt('system.md'),
      loadPrompt('tweet.md'),
      loadPrompt('article.md'),
      loadPrompt('ask.md'),
    ]);
    _promptCache = { system, tweet, article, ask };
  }
  return _promptCache;
}

async function runAgentLoop({ systemPrompt, userMessage, apiKey, model, signal, onProgress }) {
  console.log('[agent] starting loop');
  console.log('[agent] user message:', userMessage.slice(0, 200) + (userMessage.length > 200 ? '...' : ''));
  console.log('[agent] model:', model);

  const progress = onProgress || (() => {});
  const messages = [{ role: 'user', content: userMessage }];
  let totalMarketsFound = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[agent] iteration ${i + 1}/${MAX_ITERATIONS} — calling Anthropic...`);

    if (i === 0) {
      progress({ step: 'thinking', message: 'Analyzing content...' });
    } else {
      progress({ step: 'thinking', message: 'Refining search...', iteration: i + 1 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 10000,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[agent] Anthropic API error:', payload.error || response.status);
      throw new Error(payload.error?.message || `Anthropic API error (${response.status})`);
    }

    console.log('[agent] stop_reason:', payload.stop_reason);
    console.log('[agent] usage:', payload.usage);

    // Append assistant response to conversation
    messages.push({ role: 'assistant', content: payload.content });

    // If the model is done (no more tool calls), extract final text
    if (payload.stop_reason !== 'tool_use') {
      progress({ step: 'done', message: 'Preparing results...' });
      const finalText = (payload.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      console.log('[agent] done — final response:', finalText);
      return finalText;
    }

    // Execute tool calls in parallel
    const toolUseBlocks = payload.content.filter((block) => block.type === 'tool_use');
    console.log(`[agent] ${toolUseBlocks.length} tool call(s):`);
    for (const block of toolUseBlocks) {
      console.log(`  [tool] ${block.name}(${JSON.stringify(block.input)})`);
    }

    const queries = toolUseBlocks.map((b) => b.input.query).filter(Boolean);
    progress({ step: 'searching', message: `Searching: ${queries.join(', ')}` });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const start = Date.now();
        try {
          const result = await executeToolCall(block.name, block.input, signal);
          const elapsed = Date.now() - start;
          const marketCount = result.markets?.length ?? 0;
          const errors = result.errors?.length ?? 0;
          totalMarketsFound += marketCount;
          console.log(`  [tool] ${block.name}("${block.input.query}") → ${marketCount} markets, ${errors} errors (${elapsed}ms)`);
          if (marketCount > 0) {
            for (const m of result.markets) {
              console.log(`    - [${m.platform}] ${m.title} (${Math.round(m.probability * 100)}%)`);
            }
          }
          if (errors > 0) {
            for (const e of result.errors) {
              console.warn(`    ! ${e.platform}: ${e.error}`);
            }
          }
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          };
        } catch (err) {
          const elapsed = Date.now() - start;
          console.error(`  [tool] ${block.name}("${block.input.query}") FAILED (${elapsed}ms):`, err.message);
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true,
          };
        }
      }),
    );

    progress({
      step: 'searched',
      message: `Found ${totalMarketsFound} market${totalMarketsFound !== 1 ? 's' : ''} so far...`,
      totalMarkets: totalMarketsFound,
    });

    messages.push({ role: 'user', content: toolResults });
  }

  console.error('[agent] exceeded max iterations');
  throw new Error('Agent exceeded max iterations');
}

// ─── Article text extraction ─────────────────────────────────

function truncate(text, maxLen = 8000) {
  const value = String(text || '');
  return value.length <= maxLen ? value : `${value.slice(0, maxLen)}...`;
}

export async function fetchArticleText(url, signal) {
  try {
    const response = await fetch(url, { signal });
    if (response.ok) {
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return truncate(doc.body?.innerText || '');
    }
  } catch { /* fall through to Jina */ }

  const fallback = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`, { signal });
  if (!fallback.ok) throw new Error(`Could not fetch article content for ${url}`);
  return truncate(await fallback.text());
}

// ─── Public API (same signatures as before) ──────────────────

export async function analyzeText(text, signal, onProgress) {
  console.log('[analyzeText] called with:', text.slice(0, 100) + (text.length > 100 ? '...' : ''));
  const { anthropicApiKey, anthropicModel } = await loadSettings();
  if (!anthropicApiKey) {
    console.warn('[analyzeText] no API key set');
    chrome.runtime.openOptionsPage();
    throw new Error('API_KEY_MISSING');
  }

  const prompts = await getPrompts();
  return runAgentLoop({
    systemPrompt: prompts.system + '\n' + prompts.tweet,
    userMessage: `Find prediction markets relevant to this tweet:\n\n${text}`,
    apiKey: anthropicApiKey,
    model: anthropicModel,
    signal,
    onProgress,
  });
}

export async function analyzeUrl(url, signal, onProgress) {
  console.log('[analyzeUrl] called with:', url);
  const { anthropicApiKey, anthropicModel } = await loadSettings();
  if (!anthropicApiKey) {
    console.warn('[analyzeUrl] no API key set');
    chrome.runtime.openOptionsPage();
    throw new Error('API_KEY_MISSING');
  }

  if (onProgress) onProgress({ step: 'fetching', message: 'Fetching article...' });

  console.log('[analyzeUrl] fetching article text...');
  const articleText = await fetchArticleText(url, signal);
  console.log('[analyzeUrl] article text length:', articleText.length);

  const prompts = await getPrompts();
  const analysis = await runAgentLoop({
    systemPrompt: prompts.system + '\n' + prompts.article,
    userMessage: `Find prediction markets relevant to this article:\n\nURL: ${url}\n\n${articleText}`,
    apiKey: anthropicApiKey,
    model: anthropicModel,
    signal,
    onProgress,
  });

  return { analysis, articleText };
}

export async function askQuestion(question, articleContext, signal) {
  console.log('[askQuestion] called with:', question);
  const { anthropicApiKey, anthropicModel } = await loadSettings();
  if (!anthropicApiKey) {
    chrome.runtime.openOptionsPage();
    throw new Error('API_KEY_MISSING');
  }

  const prompts = await getPrompts();
  const context = articleContext ? `\n\nArticle context:\n${truncate(articleContext, 4000)}` : '';
  return runAgentLoop({
    systemPrompt: prompts.system + '\n' + prompts.ask,
    userMessage: `${question}${context}`,
    apiKey: anthropicApiKey,
    model: anthropicModel,
    signal,
  });
}

export async function rewriteTweet(analysis, tweetText, signal) {
  const { anthropicApiKey, anthropicModel } = await loadSettings();
  if (!anthropicApiKey) {
    chrome.runtime.openOptionsPage();
    throw new Error('API_KEY_MISSING');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 180,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          'Condense this prediction market analysis into one tweet under 280 characters.',
          'Facts only. Mention market names and probabilities. End with " - by Quantify".',
          '',
          `Original tweet:\n${truncate(tweetText, 1000)}`,
          '',
          `Analysis:\n${truncate(analysis, 2500)}`,
        ].join('\n'),
      }],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Anthropic API error (${response.status})`);
  }
  return (payload.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}


