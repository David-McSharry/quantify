"""MCP server entry point for prediction market aggregation."""
import json
import sys
import time

from mcp.server import Server
from mcp.types import Tool, TextContent

from mcp_predictive_market.adapters.manifold import ManifoldAdapter
from mcp_predictive_market.adapters.polymarket import PolymarketAdapter
from mcp_predictive_market.adapters.metaculus import MetaculusAdapter
from mcp_predictive_market.adapters.predictit import PredictItAdapter
from mcp_predictive_market.adapters.kalshi import KalshiAdapter
from mcp_predictive_market.tools import ToolHandlers


def _log(msg: str) -> None:
    """Log to stderr (stdout is reserved for MCP protocol)."""
    print(f"[mcp] {msg}", file=sys.stderr, flush=True)


def create_server() -> Server:
    """Create and configure the MCP server."""
    server = Server("mcp-predictive-market")

    # Initialize adapters
    adapters = {
        "manifold": ManifoldAdapter(),
        "polymarket": PolymarketAdapter(),
        "metaculus": MetaculusAdapter(),
        "predictit": PredictItAdapter(),
        "kalshi": KalshiAdapter(),
    }

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        """List available tools."""
        return [
            Tool(
                name="search_markets",
                description="Search for prediction markets across platforms",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query (e.g., 'Will Trump win 2024?')",
                        },
                        "platforms": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional: filter to specific platforms",
                        },
                    },
                    "required": ["query"],
                },
            ),
            Tool(
                name="get_market_odds",
                description="Get current odds for a specific market",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "platform": {
                            "type": "string",
                            "description": "Platform name (manifold, polymarket, etc.)",
                        },
                        "market_id": {
                            "type": "string",
                            "description": "The market's native ID",
                        },
                    },
                    "required": ["platform", "market_id"],
                },
            ),
            Tool(
                name="compare_platforms",
                description="Side-by-side odds comparison for markets matching a query",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query to find markets to compare",
                        },
                    },
                    "required": ["query"],
                },
            ),
        ]

    handlers = ToolHandlers(adapters)

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[TextContent]:
        """Handle tool calls."""
        _log(f"call_tool: {name}({arguments})")
        t_start = time.time()

        if name == "search_markets":
            result = await handlers.search_markets(**arguments)
        elif name == "get_market_odds":
            result = await handlers.get_market_odds(**arguments)
        elif name == "compare_platforms":
            result = await handlers.compare_platforms(**arguments)
        else:
            raise ValueError(f"Unknown tool: {name}")

        elapsed = time.time() - t_start
        market_count = len(result.get("markets", result.get("comparisons", [])))
        _log(f"call_tool: {name} done in {elapsed:.1f}s ({market_count} results)")

        return [TextContent(type="text", text=json.dumps(result, separators=(",", ":")))]

    return server


def main() -> None:
    """Run the MCP server."""
    import asyncio
    from mcp.server.stdio import stdio_server

    server = create_server()

    async def run():
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options(),
            )

    asyncio.run(run())


if __name__ == "__main__":
    main()
