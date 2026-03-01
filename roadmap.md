# Roadmap

## Future Platform Integrations

### Kalshi
Kalshi has no text search API. Their `GET /events` and `GET /markets` endpoints only support filtering by status, timestamps, and ticker codes — not natural language queries.

Options when adding Kalshi support:
- Paginate through events and apply local keyword matching (what the old code did)
- Monitor for a search endpoint being added to their API
- Use their WebSocket feed to maintain a local index

API docs: https://docs.kalshi.com/api-reference/market/get-markets.md

### Metaculus
Metaculus has a `search` parameter on `GET /api2/questions/` but it's weak and rate-limited. The old code supplemented it with pagination through recent open questions and local scoring.

Options when adding Metaculus support:
- Use their search param as-is, accept lower recall
- Supplement with pagination + local keyword matching
- Monitor for API improvements

API: `https://www.metaculus.com/api2/questions/?search=...&status=open`
