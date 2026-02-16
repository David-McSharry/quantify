import { searchMarketsAcrossPlatforms } from './market-search.js';

const DEFAULT_MODEL = 'claude-opus-4-6';

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

function truncate(text, maxLen = 500) {
  const value = String(text || '');
  return value.length <= maxLen ? value : `${value.slice(0, maxLen)}...`;
}

const QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'been', 'but', 'by', 'can', 'do',
  'for', 'from', 'get', 'got', 'had', 'has', 'have', 'he', 'her', 'him',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'let',
  'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'out', 'say', 'says',
  'she', 'so', 'some', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'too', 'up', 'us', 'very', 'was',
  'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'would',
  'you', 'your', 'about', 'after', 'again', 'all', 'also', 'am', 'any',
  'because', 'before', 'being', 'between', 'both', 'could', 'did', 'does',
  'doing', 'down', 'during', 'each', 'few', 'here', 'https', 'http', 'www',
  'com', 'co', 'rt', 'via', 'new', 'now', 'looking', 'think', 'going',
  'really', 'still', 'much', 'ever', 'huge', 'big', 'major', 'just',
  'breaking', 'incredible', 'amazing', 'step', 'moving', 'closer', 'year',
  'shows', 'show', 'says', 'said', 'told', 'tells', 'announced', 'reports',
  'according', 'suggests', 'revealed', 'confirmed', 'claimed', 'stated',
  'points', 'point', 'percent', 'second', 'first', 'last', 'next', 'likely',
  'latest', 'today', 'yesterday', 'tomorrow', 'recently', 'right',
  'crossed', 'reached', 'hit', 'made', 'took', 'came', 'went', 'gave', 'goes',
  'found', 'seen', 'called', 'started', 'trying', 'open', 'full', 'like', 'posted',
  'look', 'looks', 'make', 'makes', 'take', 'takes', 'give', 'gives',
  'come', 'comes', 'keep', 'keeps', 'turn', 'turns', 'seem', 'seems',
  'become', 'becomes', 'leave', 'leaves', 'run', 'runs', 'set', 'long',
  'high', 'well', 'back', 'even', 'way', 'many', 'must', 'own', 'most',
  'over', 'such', 'through', 'where', 'while', 'only',
]);

function extractKeywords(text) {
  const words = String(text || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, '')            // strip URLs
    .replace(/@\w+/g, '')                       // strip @mentions
    .replace(/[^a-z0-9\s'-]/g, ' ')            // keep letters, numbers, hyphens, apostrophes
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !QUERY_STOPWORDS.has(w) && !/^\d+$/.test(w));
  // Dedupe while preserving order
  const seen = new Set();
  return words.filter((w) => { if (seen.has(w)) return false; seen.add(w); return true; });
}

function buildQueries(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const keywords = extractKeywords(normalized);
  const queries = [];

  // Primary query: top 4 keywords (sweet spot for Manifold's search API)
  if (keywords.length > 0) {
    queries.push(keywords.slice(0, 4).join(' '));
  }

  // Secondary query: first 2 keywords (more focused, catches different results)
  if (keywords.length > 2) {
    queries.push(keywords.slice(0, 2).join(' '));
  }

  // Topic-specific supplemental queries for better Polymarket/Kalshi local matching
  // Use cleaned text (URLs and @mentions stripped) to avoid false triggers from handles/URLs
  const cleaned = normalized.toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@\w+/g, '');
  const lower = cleaned;
  if (lower.includes('sbf') || lower.includes('sam bankman') || lower.includes('ftx')) queries.push('trump pardon sbf');
  if (lower.includes('fed') || lower.includes('interest rate')) queries.push('federal reserve interest rate');
  if (lower.includes('powell') || lower.includes('warsh')) queries.push('fed chair');
  if (lower.includes('bitcoin') || lower.includes('btc') || lower.includes('crypto')) queries.push('bitcoin price');
  if (lower.includes('inflation') || lower.includes('cpi')) queries.push('us inflation');
  if (lower.includes('covid') || lower.includes('lab leak')) queries.push('covid lab leak');
  if (lower.includes('ukraine') || lower.includes('zelensky') || lower.includes('russia')) queries.push('ukraine russia ceasefire');
  if (lower.includes('openai') || lower.includes('anthropic') || lower.includes('ai ')) queries.push('artificial intelligence');
  if (lower.includes('agi') || lower.includes('superintelligence')) queries.push('agi artificial general intelligence');
  if (lower.includes('elon') || lower.includes('musk')) queries.push('elon musk');
  if (lower.includes('tesla')) queries.push('tesla autonomous self driving');
  if (lower.includes('china') || lower.includes('taiwan')) queries.push('china taiwan');
  if (lower.includes('recession')) queries.push('us recession');
  if (lower.includes('super bowl') || lower.includes('nfl')) queries.push('super bowl');

  // Dedupe queries
  const seen = new Set();
  return queries.filter((q) => {
    const key = q.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

async function callAnthropic({ apiKey, model, prompt, signal, maxTokens = 700 }) {
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
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Anthropic API error (${response.status})`);
  }
  const textParts = (payload.content || []).filter((block) => block.type === 'text').map((block) => block.text);
  return textParts.join('\n').trim();
}

async function fetchArticleText(url, signal) {
  try {
    const response = await fetch(url, { signal });
    if (response.ok) {
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return truncate(doc.body?.innerText || '', 8000);
    }
  } catch {}

  const fallback = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`, { signal });
  if (!fallback.ok) throw new Error(`Could not fetch article content for ${url}`);
  return truncate(await fallback.text(), 8000);
}

function markdownFallback(markets) {
  if (!markets.length) return 'No relevant markets found.';
  return markets.slice(0, 3)
    .map((market) => {
      const pct = Math.round((market.probability || 0.5) * 100);
      return `- **[${market.title}](${market.url})** - ${market.platform[0].toUpperCase()}${market.platform.slice(1)}, ${pct}%`;
    })
    .join('\n');
}

async function analyzeWithAnthropic(context, signal) {
  const { anthropicApiKey, anthropicModel } = await loadSettings();
  if (!anthropicApiKey) {
    chrome.runtime.openOptionsPage();
    throw new Error('API_KEY_MISSING');
  }

  const queries = buildQueries(context.searchText);
  const queryResults = await Promise.all(
    queries.map((query) => searchMarketsAcrossPlatforms(query, signal).catch(() => [])),
  );
  let markets = queryResults.flat();
  const byIdentity = new Map();
  for (const market of markets) {
    const key = `${market.platform}:${market.marketId}`;
    const existing = byIdentity.get(key);
    if (!existing || market.score > existing.score) byIdentity.set(key, market);
  }
  markets = [...byIdentity.values()].sort((a, b) => (b.score - a.score) || ((b.volume || 0) - (a.volume || 0)));

  if (markets.length === 0) {
    const q = encodeURIComponent(truncate(context.contextText, 100));
    return `No relevant prediction markets found.\n\n[Create one on Manifold](https://manifold.markets/create?q=${q})`;
  }

  const prompt = [
    'You are a prediction-market relevance filter and formatter.',
    '',
    'TASK: Given a tweet/article and a list of candidate prediction markets, select ONLY markets that are genuinely relevant to the content. Then format them as concise bullet points.',
    '',
    'STRICT RELEVANCE RULES:',
    '- A market is relevant ONLY if it directly relates to a claim, event, person, or outcome discussed in the content.',
    '- Sharing a single keyword (e.g. "France") is NOT enough. The market must be about the same TOPIC as the content.',
    '- Example: A tweet about French science investment is NOT relevant to "Will France win the FIFA World Cup?" — these are completely different topics that happen to share the word "France".',
    '- Example: A tweet about Fed rate cuts IS relevant to "Will the Fed cut rates in March 2026?" — same topic.',
    '- If NONE of the candidate markets are genuinely relevant, respond with exactly: No relevant markets found.',
    '- It is MUCH better to return "No relevant markets found." than to present irrelevant markets. Be conservative.',
    '',
    'FORMAT: Output ONLY bullet points, nothing else. No intro, no summary, no commentary.',
    'Each bullet follows this EXACT syntax:',
    '- **[TITLE](URL)** - Platform, N% - one sentence why relevant',
    '',
    'Examples:',
    '- **[Will Bitcoin hit $200k?](https://manifold.markets/example)** - Manifold, 42% - tweet discusses BTC price targets',
    '- **[Fed rate cut March 2026](https://polymarket.com/example)** - Polymarket, 67% - directly relates to rate cut discussion',
    '',
    'RULES:',
    '- Max 3 markets. Output ONLY the bullet points — no other text.',
    '- Copy title and url EXACTLY from the JSON. Never invent or modify links.',
    '- Probability: multiply the JSON probability field by 100 and round to get the percentage.',
    '- Platform: capitalize first letter of the platform field.',
    '- Reason: one short sentence explaining relevance. Keep it brief.',
    '- When multiple platforms have relevant markets, prefer showing one from each platform for diversity.',
    '',
    `Content (${context.type}):\n${truncate(context.contextText, 2000)}`,
    '',
    `Candidate markets JSON:\n${JSON.stringify(markets.slice(0, 15), null, 2)}`,
  ].join('\n');

  const createLink = `[Create one on Manifold](https://manifold.markets/create?q=${encodeURIComponent(truncate(context.contextText, 100))})`;

  try {
    const output = await callAnthropic({
      apiKey: anthropicApiKey,
      model: anthropicModel,
      prompt,
      signal,
      maxTokens: 350,
    });
    if (!output) return markdownFallback(markets);
    if (output.toLowerCase().includes('no relevant markets found')) {
      return `No relevant prediction markets found.\n\n${createLink}`;
    }
    return output;
  } catch {
    return markdownFallback(markets);
  }
}

export async function analyzeText(text, signal) {
  return analyzeWithAnthropic({
    type: 'tweet',
    searchText: text,
    contextText: text,
  }, signal);
}

export async function analyzeUrl(url, signal) {
  const articleText = await fetchArticleText(url, signal);
  return analyzeWithAnthropic({
    type: 'article',
    searchText: `${url} ${articleText}`,
    contextText: articleText,
  }, signal);
}

export async function rewriteTweet(analysis, tweetText, signal) {
  const { anthropicApiKey, anthropicModel } = await loadSettings();
  if (!anthropicApiKey) {
    chrome.runtime.openOptionsPage();
    throw new Error('API_KEY_MISSING');
  }

  const prompt = [
    'Condense this prediction market analysis into one tweet under 280 characters.',
    'Facts only. Mention market names and probabilities. End with " - by Quantify".',
    '',
    `Original tweet:\n${truncate(tweetText, 1000)}`,
    '',
    `Analysis:\n${truncate(analysis, 2500)}`,
  ].join('\n');

  return callAnthropic({
    apiKey: anthropicApiKey,
    model: anthropicModel,
    prompt,
    signal,
    maxTokens: 180,
  });
}

export async function testConnection() {
  const { anthropicApiKey, anthropicModel } = await loadSettings();
  if (!anthropicApiKey) return { ok: false, message: 'Missing Anthropic API key' };
  try {
    await callAnthropic({
      apiKey: anthropicApiKey,
      model: anthropicModel,
      prompt: 'Reply with exactly: OK',
      maxTokens: 5,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
