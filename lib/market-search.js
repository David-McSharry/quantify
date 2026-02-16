const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'by', 'for', 'from', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with',
  'how', 'what', 'when', 'who', 'before', 'after', 'this', 'year',
]);

function tokenize(text) {
  const tokens = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const expanded = [];
  for (const token of tokens) {
    expanded.push(token);
    if (token === 'sbf') expanded.push('sam', 'bankman', 'fried');
    if (token === 'ftx') expanded.push('bankman');
  }
  return expanded;
}

function scoreText(text, query) {
  const queryTokens = tokenize(query).filter((t) => !STOPWORDS.has(t) && t.length >= 2 && !/^\d+$/.test(t));
  if (queryTokens.length === 0) return 0;

  const hayTokens = tokenize(text);
  const haySet = new Set(hayTokens);
  const haystack = hayTokens.join(' ');
  const fullQuery = queryTokens.join(' ');
  const matched = new Set();
  let score = 0;

  if (fullQuery && haystack.includes(fullQuery)) score += 8;
  for (const token of queryTokens) {
    if (haySet.has(token)) {
      score += 2;
      matched.add(token);
    }
  }
  for (let i = 0; i < queryTokens.length - 1; i += 1) {
    const phrase = `${queryTokens[i]} ${queryTokens[i + 1]}`;
    if (haystack.includes(phrase)) score += 3;
  }

  if (queryTokens.length >= 3 && matched.size < 2 && !haystack.includes(fullQuery)) return 0;
  return score;
}

function clampProbability(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function parseMaybeJsonList(raw, fallback = []) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function dedupeMarkets(markets) {
  const byId = new Map();
  for (const market of markets) {
    const key = `${market.platform}:${market.marketId}`;
    const existing = byId.get(key);
    if (!existing || market.score > existing.score || (market.score === existing.score && (market.volume || 0) > (existing.volume || 0))) {
      byId.set(key, market);
    }
  }
  return [...byId.values()];
}

async function fetchJson(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function searchManifold(query, signal) {
  const url = `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(query)}&limit=20`;
  const now = Date.now();
  const data = await fetchJson(url, signal);
  return data
    .filter((m) => !m.isResolved && (!m.closeTime || m.closeTime > now))
    .map((m) => ({
      platform: 'manifold',
      marketId: String(m.id),
      title: m.question,
      url: m.url || `https://manifold.markets/market/${m.id}`,
      probability: clampProbability(m.probability),
      outcomes: [
        { name: 'Yes', probability: clampProbability(m.probability) },
        { name: 'No', probability: clampProbability(1 - (m.probability ?? 0.5)) },
      ],
      description: typeof m.textDescription === 'string' ? m.textDescription : '',
      volume: Number(m.volume || 0),
      score: scoreText(`${m.question} ${m.textDescription || ''}`, query),
    })).filter((m) => m.score > 0);
}

function parsePolymarket(raw, query, event = null) {
  const outcomeNames = parseMaybeJsonList(raw.outcomes, ['Yes', 'No']).map((name) => String(name));
  const outcomePrices = parseMaybeJsonList(raw.outcomePrices, []).map((price) => clampProbability(price));
  const outcomes = outcomeNames.map((name, idx) => ({ name, probability: clampProbability(outcomePrices[idx], 0.5) }));
  const lowerNames = new Set(outcomes.map((o) => o.name.toLowerCase().trim()));
  const isYesNo = outcomes.length === 2 && lowerNames.has('yes') && lowerNames.has('no');

  let probability = 0.5;
  if (outcomes.length > 0) {
    if (isYesNo) {
      const yes = outcomes.find((o) => o.name.toLowerCase().trim() === 'yes');
      probability = yes ? yes.probability : outcomes[0].probability;
    } else {
      const queryTokens = new Set(tokenize(query).filter((t) => !STOPWORDS.has(t) && t.length >= 3));
      let bestIdx = 0;
      let bestOverlap = -1;
      outcomes.forEach((outcome, idx) => {
        const overlap = tokenize(outcome.name).filter((t) => queryTokens.has(t)).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestIdx = idx;
        }
      });
      probability = outcomes[bestIdx]?.probability ?? outcomes[0].probability;
    }
  }

  const eventSlug = (raw.events && raw.events[0] && raw.events[0].slug) || event?.slug;
  const url = eventSlug
    ? `https://polymarket.com/event/${eventSlug}`
    : `https://polymarket.com/market/${raw.slug || raw.id}`;

  const text = [raw.question, raw.description, raw.slug, raw.groupItemTitle, outcomes.map((o) => o.name).join(' '), event?.title || ''].join(' ');
  return {
    platform: 'polymarket',
    marketId: String(raw.id),
    title: raw.question,
    url,
    probability,
    outcomes,
    description: raw.description || '',
    volume: Number(raw.volume || 0),
    score: scoreText(text, query),
  };
}

async function searchPolymarket(query, signal) {
  const direct = await fetchJson('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200', signal);
  const markets = [];
  const seen = new Set();

  for (const raw of direct) {
    const parsed = parsePolymarket(raw, query);
    if (parsed.score <= 0) continue;
    seen.add(parsed.marketId);
    markets.push(parsed);
  }

  for (let page = 0; page < 4; page += 1) {
    const events = await fetchJson(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=200&offset=${page * 200}`, signal);
    if (!Array.isArray(events) || events.length === 0) break;
    for (const event of events) {
      const eventScore = scoreText(`${event.title || ''} ${event.slug || ''} ${event.description || ''}`, query);
      if (eventScore <= 0) continue;
      for (const raw of event.markets || []) {
        const marketId = String(raw.id || '');
        if (!marketId || seen.has(marketId)) continue;
        const parsed = parsePolymarket({ ...raw, events: raw.events || [{ slug: event.slug, title: event.title }] }, query, event);
        parsed.score = Math.max(parsed.score, eventScore);
        if (parsed.score <= 0) continue;
        seen.add(marketId);
        markets.push(parsed);
      }
    }
  }

  return markets;
}

function isNoisyKalshiMarket(market) {
  const ticker = String(market.ticker || '');
  const title = String(market.title || '').toLowerCase();
  if (ticker.startsWith('KXMVE')) return true;
  if (market.mve_collection_ticker) return true;
  return title.split(',').length >= 4 && (title.includes('yes ') || title.includes('no '));
}

function parseKalshi(raw, query, event = null) {
  const probability = clampProbability(
    raw.yes_ask != null ? Number(raw.yes_ask) / 100 : Number(raw.last_price) / 100,
    0.5,
  );
  const score = scoreText(
    `${raw.title || ''} ${raw.subtitle || ''} ${raw.ticker || ''} ${raw.event_ticker || ''} ${event?.title || ''}`,
    query,
  ) + (Number(raw.volume || 0) > 0 ? 1 : 0);

  return {
    platform: 'kalshi',
    marketId: String(raw.ticker),
    title: raw.title,
    url: `https://kalshi.com/markets/${raw.ticker}`,
    probability,
    outcomes: [
      { name: 'Yes', probability },
      { name: 'No', probability: clampProbability(1 - probability) },
    ],
    description: raw.subtitle || '',
    volume: Number(raw.volume || 0),
    score,
  };
}

async function searchKalshi(query, signal) {
  const markets = [];
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < 5; page += 1) {
    const url = cursor
      ? `https://api.elections.kalshi.com/trade-api/v2/events?limit=200&cursor=${encodeURIComponent(cursor)}`
      : 'https://api.elections.kalshi.com/trade-api/v2/events?limit=200';
    const payload = await fetchJson(url, signal);
    const events = payload.events || [];
    for (const event of events) {
      const eventScore = scoreText(
        `${event.title || ''} ${event.sub_title || ''} ${event.event_ticker || ''} ${event.series_ticker || ''}`,
        query,
      );
      if (eventScore <= 0 || !event.event_ticker) continue;
      const eventMarkets = await fetchJson(
        `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=${encodeURIComponent(event.event_ticker)}&status=open&limit=200`,
        signal,
      );
      for (const raw of eventMarkets.markets || []) {
        if (isNoisyKalshiMarket(raw)) continue;
        const parsed = parseKalshi(raw, query, event);
        parsed.score = Math.max(parsed.score, eventScore);
        if (parsed.score <= 0 || seen.has(parsed.marketId)) continue;
        seen.add(parsed.marketId);
        markets.push(parsed);
      }
    }
    cursor = payload.cursor;
    if (!cursor) break;
  }
  return markets;
}

async function searchMetaculus(query, signal) {
  const markets = [];
  for (let page = 0; page < 2; page += 1) {
    const payload = await fetchJson(
      `https://www.metaculus.com/api2/questions/?limit=50&offset=${page * 50}&status=open`,
      signal,
    );
    const results = payload.results || [];
    if (results.length === 0) break;
    for (const q of results) {
      const categoryNames = (q.categories || []).map((cat) => cat.name || '').join(' ');
      const titleScore = scoreText(`${q.title || ''} ${categoryNames}`, query);
      const descScore = scoreText(q.description || '', query);
      const score = titleScore > 0 ? titleScore + 1 : (descScore >= 6 ? descScore : 0);
      if (score <= 0) continue;
      const probability = clampProbability(q?.community_prediction?.full?.q2, 0.5);
      markets.push({
        platform: 'metaculus',
        marketId: String(q.id),
        title: q.title,
        url: q.page_url || `https://www.metaculus.com/questions/${q.id}/`,
        probability,
        outcomes: [
          { name: 'Yes', probability },
          { name: 'No', probability: clampProbability(1 - probability) },
        ],
        description: q.description || '',
        volume: Number(q.number_of_forecasters || 0),
        score,
      });
    }
    if (results.length < 50) break;
  }
  return markets;
}

export async function searchMarketsAcrossPlatforms(query, signal) {
  const tasks = [
    searchPolymarket(query, signal),
    searchManifold(query, signal),
    searchKalshi(query, signal),
    searchMetaculus(query, signal),
  ];
  const settled = await Promise.allSettled(tasks);
  const all = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') all.push(...result.value);
  }
  const deduped = dedupeMarkets(all);
  deduped.sort((a, b) => (b.score - a.score) || ((b.volume || 0) - (a.volume || 0)));
  return deduped.slice(0, 20);
}
