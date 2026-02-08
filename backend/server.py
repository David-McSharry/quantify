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


async def run_agent(url: str = None, text: str = None, source: str = None) -> str:
    today = date.today().isoformat()

    if text and source == 'twitter':
        # Twitter tweet analysis - direct text, no fetch needed
        prompt = (
            f"Today's date: {today}\n\n"
            f"Analyze this tweet:\n\n{text}\n\n"
            "If the tweet includes image URLs, use the fetch tool to view them for additional context.\n\n"
            "Search for prediction markets related to the topics, people, events, or claims "
            "mentioned or implied in this tweet. Be loose and creative with connections — "
            "if the tweet mentions a person, search for markets about them. If it mentions "
            "a topic, find interesting markets in that space. Add whatever is interesting!\n\n"
            "Format: For each relevant market, show **bold market name** as a hyperlink to its URL, "
            "the platform and current probability, and a short explanation. "
            "Keep it concise — this will display in a small box on Twitter.\n\n"
            "CRITICAL: Start immediately with market content. "
            "No meta-commentary, no 'I found...', no narration. "
            "If no relevant markets found, say 'No relevant markets found.' and stop."
        )
    else:
        # Article analysis - fetch URL first
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


async def run_rewrite(analysis: str, tweet_text: str) -> str:
    prompt = (
        "Condense this prediction market analysis into a single tweet (max 280 characters). "
        "ONLY state facts: market names and their probabilities. No opinions, no analysis, "
        "no editorializing, no connecting dots. Just pure context like: "
        "'X: 36% on Manifold. Y: 48% on Polymarket.' "
        "End with ' - by Quantify'. "
        "Do not use hashtags. Do not use emojis. Just output the tweet text, nothing else.\n\n"
    )
    if tweet_text:
        prompt += f"Original tweet being replied to:\n{tweet_text}\n\n"
    prompt += f"Analysis to condense:\n{analysis}"

    options = ClaudeAgentOptions(
        allowed_tools=[],
        permission_mode="bypassPermissions",
        max_turns=1,
    )

    last_text = ""
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    last_text = block.text

    return last_text.strip()


@app.post("/analyze")
def analyze():
    data = request.get_json()
    if not data:
        return jsonify(ok=False, error="missing request body"), 400

    url = data.get("url")
    text = data.get("text")
    source = data.get("source")

    if not url and not text:
        return jsonify(ok=False, error="missing url or text"), 400

    if text:
        print(f"\n[backend] === analyzing tweet: {text[:80]}...")
    else:
        print(f"\n[backend] === analyzing: {url}")
    t_start = time.time()

    try:
        result = asyncio.run(run_agent(url=url, text=text, source=source))
        elapsed = time.time() - t_start
        print(f"[backend] === done in {elapsed:.1f}s")
        return jsonify(ok=True, data=result)
    except Exception as e:
        elapsed = time.time() - t_start
        print(f"[backend] === error after {elapsed:.1f}s: {e}")
        return jsonify(ok=False, error=str(e)), 502


@app.post("/rewrite-tweet")
def rewrite_tweet():
    data = request.get_json()
    if not data or "analysis" not in data:
        return jsonify(ok=False, error="missing analysis"), 400

    analysis = data["analysis"]
    tweet_text = data.get("tweet_text", "")
    print(f"\n[backend] === rewriting to tweet...")

    t_start = time.time()
    try:
        result = asyncio.run(run_rewrite(analysis, tweet_text))
        elapsed = time.time() - t_start
        print(f"[backend] === rewrite done in {elapsed:.1f}s")
        return jsonify(ok=True, data=result)
    except Exception as e:
        elapsed = time.time() - t_start
        print(f"[backend] === rewrite error after {elapsed:.1f}s: {e}")
        return jsonify(ok=False, error=str(e)), 502


@app.get("/health")
def health():
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=18800)
