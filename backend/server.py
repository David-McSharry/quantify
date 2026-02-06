import asyncio
import time
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from claude_agent_sdk import (
    query,
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    ClaudeAgentOptions,
)

load_dotenv()

app = Flask(__name__)
CORS(app)

MCP_SERVER_DIR = str(Path(__file__).resolve().parent.parent / "mcp-predictive-market")


async def run_agent(url: str) -> str:
    today = date.today().isoformat()
    prompt = (
        f"Today's date: {today}\n\n"
        f"Use the fetch tool to retrieve this article: {url}\n\n"
        "Search for prediction markets related to claims and predictions made in this article. "
        "Then give the user a brief of what prediction markets say about those claims.\n\n"
        "Structure: group by topic. For each topic, start with a short bold heading, then "
        "a line of article context using short verbatim quotes from the article in italics "
        "(copied word-for-word, not paraphrased). "
        "Below that, list the relevant markets — hyperlink market names to their URLs, "
        "mention the platform and current probability, and add a short dash of explanation "
        "or context where the connection isn't obvious. "
        "Separate each topic group with a blank line. "
        "Only include markets that directly address a specific claim or prediction in the article — "
        "if you have to stretch to explain the connection, leave it out. "
        "Line breaks are your friend — keep it easy to scan.\n\n"
        "CRITICAL: Your final response must start immediately with market content. "
        "Never narrate what you did or what you searched for. Never say things like "
        "'I found...', 'The searches...', 'Unfortunately...', 'I wasn't able to...', "
        "'Here's what's available...', 'But I didn't find...'. "
        "No meta-commentary about the search process at all. "
        "Never mention markets you didn't find or topics with no results — just omit them silently. "
        "Only show markets that exist. If none found at all, say 'No relevant markets found.' and stop."
    )

    options = ClaudeAgentOptions(
        allowed_tools=["mcp__fetch__*", "mcp__prediction-market__*"],
        permission_mode="bypassPermissions",
        max_turns=8,
        mcp_servers={
            "fetch": {
                "command": "uvx",
                "args": ["mcp-server-fetch"],
            },
            "prediction-market": {
                "command": "uv",
                "args": ["run", "--directory", MCP_SERVER_DIR, "python", "-m", "mcp_predictive_market.server"],
            },
        },
    )

    last_text_parts = []
    turn = 0
    t_agent_start = time.time()

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            turn += 1
            elapsed = time.time() - t_agent_start
            # Reset each turn — we only want the very last assistant message's text
            last_text_parts = []
            for block in message.content:
                if isinstance(block, TextBlock):
                    snippet = block.text[:120].replace("\n", " ")
                    print(f"[agent] turn {turn} (+{elapsed:.1f}s) text: {snippet}...")
                    last_text_parts.append(block.text)
                elif isinstance(block, ToolUseBlock):
                    print(f"[agent] turn {turn} (+{elapsed:.1f}s) tool_call: {block.name}({block.input})")
        elif isinstance(message, ResultMessage):
            elapsed = time.time() - t_agent_start
            print(f"[agent] finished: {message.num_turns} turns, {elapsed:.1f}s wall, "
                  f"{message.duration_ms}ms sdk, cost=${message.total_cost_usd:.4f}")

    return "\n".join(last_text_parts)


@app.post("/analyze")
def analyze():
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify(ok=False, error="missing url"), 400

    url = data["url"]
    print(f"\n[backend] === analyzing: {url}")
    t_start = time.time()

    try:
        result = asyncio.run(run_agent(url))
        elapsed = time.time() - t_start
        print(f"[backend] === done in {elapsed:.1f}s: {url}")
        return jsonify(ok=True, data=result)
    except Exception as e:
        elapsed = time.time() - t_start
        print(f"[backend] === error after {elapsed:.1f}s: {e}")
        return jsonify(ok=False, error=str(e)), 502


@app.get("/health")
def health():
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=18800)
