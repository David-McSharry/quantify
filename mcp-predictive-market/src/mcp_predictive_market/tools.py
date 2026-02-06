"""Tool handler implementations for the MCP server."""
import sys
import time
from typing import Any

from mcp_predictive_market.adapters.base import PlatformAdapter
from mcp_predictive_market.analysis.matching import MarketMatcher
from mcp_predictive_market.schema import Market

MAX_DESC_LEN = 500


def _log(msg: str) -> None:
    """Log to stderr (stdout is reserved for MCP protocol)."""
    print(f"[mcp:tools] {msg}", file=sys.stderr, flush=True)


class ToolHandlers:
    """Handlers for MCP tool calls."""

    def __init__(self, adapters: dict[str, PlatformAdapter]) -> None:
        """Initialize with platform adapters."""
        self._adapters = adapters
        self._matcher = MarketMatcher()

    def _market_to_dict(self, market: Market) -> dict[str, Any]:
        """Convert a Market to a slim dict with only essential fields."""
        desc = ""
        if market.description:
            desc = str(market.description)
            if len(desc) > MAX_DESC_LEN:
                desc = desc[:MAX_DESC_LEN] + "..."

        result: dict[str, Any] = {
            "platform": market.platform,
            "title": market.title,
            "probability": round(market.probability, 3),
            "url": market.url,
        }
        if desc:
            result["description"] = desc
        if market.volume is not None:
            result["volume"] = round(market.volume)
        if market.resolved:
            result["resolved"] = True
            if market.resolution:
                result["resolution"] = market.resolution
        return result

    async def search_markets(
        self,
        query: str,
        platforms: list[str] | None = None,
    ) -> dict[str, Any]:
        """Search for markets across platforms."""
        target_adapters = self._adapters
        if platforms:
            target_adapters = {
                k: v for k, v in self._adapters.items() if k in platforms
            }

        _log(f"search_markets: query={query!r} platforms={list(target_adapters)}")

        all_markets = []
        errors = []

        for name, adapter in target_adapters.items():
            t_start = time.time()
            try:
                markets = await adapter.search_markets(query)
                elapsed = time.time() - t_start
                _log(f"  {name}: {len(markets)} markets in {elapsed:.1f}s")
                all_markets.extend(markets)
            except Exception as e:
                elapsed = time.time() - t_start
                _log(f"  {name}: ERROR in {elapsed:.1f}s: {e}")
                errors.append({"platform": name, "error": str(e)})

        _log(f"search_markets: {len(all_markets)} total markets from {len(target_adapters)} platforms")

        result: dict[str, Any] = {
            "markets": [self._market_to_dict(m) for m in all_markets],
        }
        if errors:
            result["errors"] = errors
        return result

    async def get_market_odds(
        self,
        platform: str,
        market_id: str,
    ) -> dict[str, Any]:
        """Get current odds for a specific market."""
        if platform not in self._adapters:
            raise ValueError(f"Unknown platform: {platform}")

        _log(f"get_market_odds: {platform}/{market_id}")
        t_start = time.time()
        adapter = self._adapters[platform]
        market = await adapter.get_market(market_id)
        elapsed = time.time() - t_start
        _log(f"get_market_odds: done in {elapsed:.1f}s")
        return self._market_to_dict(market)

    async def compare_platforms(
        self,
        query: str,
    ) -> dict[str, Any]:
        """Side-by-side comparison of markets matching a query."""
        _log(f"compare_platforms: query={query!r}")

        all_markets = []
        errors = []

        for name, adapter in self._adapters.items():
            t_start = time.time()
            try:
                markets = await adapter.search_markets(query)
                elapsed = time.time() - t_start
                _log(f"  {name}: {len(markets)} markets in {elapsed:.1f}s")
                all_markets.extend(markets)
            except Exception as e:
                elapsed = time.time() - t_start
                _log(f"  {name}: ERROR in {elapsed:.1f}s: {e}")
                errors.append({"platform": name, "error": str(e)})

        # Group similar markets across platforms
        _log(f"compare_platforms: matching {len(all_markets)} markets...")
        t_match_start = time.time()

        comparisons = []
        processed: set[str] = set()

        for target in all_markets:
            if target.id in processed:
                continue
            processed.add(target.id)
            candidates = [
                m for m in all_markets if m.id != target.id and m.id not in processed
            ]
            matches = self._matcher.find_matches(target, candidates, min_confidence=0.5)

            if matches:
                platforms = {
                    target.platform: {
                        "probability": round(target.probability, 3),
                        "url": target.url,
                    }
                }
                probs = [target.probability]
                for match in matches:
                    processed.add(match.market_b.id)
                    platforms[match.market_b.platform] = {
                        "probability": round(match.market_b.probability, 3),
                        "url": match.market_b.url,
                    }
                    probs.append(match.market_b.probability)
                comparisons.append({
                    "title": target.title,
                    "platforms": platforms,
                    "spread": round(max(probs) - min(probs), 3),
                })

        match_elapsed = time.time() - t_match_start
        _log(f"compare_platforms: matching done in {match_elapsed:.1f}s, {len(comparisons)} comparisons")

        result: dict[str, Any] = {"comparisons": comparisons}
        if errors:
            result["errors"] = errors
        return result
