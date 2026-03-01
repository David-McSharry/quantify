/**
 * Prediction market search — Manifold + Polymarket.
 * Uses each platform's native search API. No local scoring.
 */

const MAX_DESC_LEN = 500;

function truncateDesc(text) {
  const s = String(text || '');
  return s.length <= MAX_DESC_LEN ? s : s.slice(0, MAX_DESC_LEN) + '...';
}

function clampProbability(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function parseMaybeJson(raw, fallback = []) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch { return fallback; }
  }
  return fallback;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

// ─── Manifold ────────────────────────────────────────────────

async function searchManifold(query, limit, signal) {
  const url = `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(query)}&limit=${limit}`;
  const now = Date.now();
  const data = await fetchJson(url, signal);
  const filtered = data.filter((m) => !m.isResolved && (!m.closeTime || m.closeTime > now));

  // For multi-choice markets, fetch full market data to get answer options
  const needsAnswers = filtered.filter((m) =>
    m.outcomeType === 'MULTIPLE_CHOICE' || m.outcomeType === 'MULTI_NUMERIC'
  );
  const answerMap = new Map();
  if (needsAnswers.length > 0) {
    const fetches = needsAnswers.map(async (m) => {
      try {
        const full = await fetchJson(`https://api.manifold.markets/v0/market/${m.id}`, signal);
        if (full.answers) {
          const sorted = full.answers
            .filter((a) => !a.isOther)
            .sort((a, b) => (b.probability || 0) - (a.probability || 0));
          answerMap.set(m.id, sorted.slice(0, 5).map((a) => ({
            text: a.text,
            probability: clampProbability(a.probability),
          })));
        }
      } catch {}
    });
    await Promise.all(fetches);
  }

  return filtered.map((m) => {
    const market = {
      platform: 'manifold',
      title: m.question,
      url: m.url || `https://manifold.markets/market/${m.id}`,
      outcomeType: m.outcomeType || 'BINARY',
      description: truncateDesc(typeof m.textDescription === 'string' ? m.textDescription : ''),
      volume: Number(m.volume || 0),
    };
    const answers = answerMap.get(m.id);
    if (answers) {
      market.answers = answers;
    } else {
      market.probability = clampProbability(m.probability);
    }
    return market;
  });
}

// ─── Polymarket ──────────────────────────────────────────────

function parsePolymarketMarket(raw, event) {
  const outcomeNames = parseMaybeJson(raw.outcomes, ['Yes', 'No']).map(String);
  const outcomePrices = parseMaybeJson(raw.outcomePrices, []).map((p) => clampProbability(p));

  let probability = 0.5;
  if (outcomePrices.length >= 1) {
    const yesIdx = outcomeNames.findIndex((n) => n.toLowerCase().trim() === 'yes');
    probability = yesIdx >= 0 ? outcomePrices[yesIdx] : outcomePrices[0];
  }

  const eventSlug = (raw.events?.[0]?.slug) || event?.slug;
  const url = eventSlug
    ? `https://polymarket.com/event/${eventSlug}`
    : `https://polymarket.com/market/${raw.slug || raw.id}`;

  return {
    platform: 'polymarket',
    title: raw.question || raw.title || '',
    url,
    probability,
    description: truncateDesc(raw.description || ''),
    volume: Number(raw.volume || raw.volumeNum || 0),
  };
}

async function searchPolymarket(query, limit, signal) {
  const url = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(query)}&limit_per_type=${limit}`;
  const data = await fetchJson(url, signal);

  const markets = [];
  const seen = new Set();

  // Events contain nested markets
  for (const event of data.events || []) {
    for (const raw of event.markets || []) {
      const id = String(raw.id || '');
      if (!id || seen.has(id)) continue;
      // Skip closed/inactive markets
      if (raw.closed || raw.active === false) continue;
      seen.add(id);
      markets.push(parsePolymarketMarket(raw, event));
    }
  }

  return markets;
}

// ─── Combined search ─────────────────────────────────────────

/**
 * Search prediction markets across platforms.
 * @param {string} query - search query
 * @param {string[]|null} platforms - optional filter, defaults to all
 * @param {AbortSignal} signal
 * @returns {Promise<{markets: object[], errors: object[]}>}
 */
export async function searchMarkets(query, platforms, signal) {
  const limit = 10;
  const all = platforms || ['manifold', 'polymarket'];

  const tasks = [];
  if (all.includes('manifold')) tasks.push(searchManifold(query, limit, signal).catch((e) => ({ _error: 'manifold', message: e.message })));
  if (all.includes('polymarket')) tasks.push(searchPolymarket(query, limit, signal).catch((e) => ({ _error: 'polymarket', message: e.message })));

  const settled = await Promise.all(tasks);

  const markets = [];
  const errors = [];

  for (const result of settled) {
    if (result && result._error) {
      errors.push({ platform: result._error, error: result.message });
    } else if (Array.isArray(result)) {
      markets.push(...result);
    }
  }

  // Dedupe by URL
  const byUrl = new Map();
  for (const m of markets) {
    if (!byUrl.has(m.url)) byUrl.set(m.url, m);
  }

  const response = { markets: [...byUrl.values()] };
  if (errors.length) response.errors = errors;
  return response;
}
