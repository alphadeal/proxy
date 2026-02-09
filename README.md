# @relayplane/proxy

Intelligent AI model routing proxy for cost optimization and observability.

## Installation

```bash
npm install -g @relayplane/proxy
```

## Quick Start

```bash
# Set your API keys
export ANTHROPIC_API_KEY=your-key
export OPENAI_API_KEY=your-key

# Start the proxy
relayplane-proxy

# Configure your tools to use the proxy
export ANTHROPIC_BASE_URL=http://localhost:3001
export OPENAI_BASE_URL=http://localhost:3001

# Run your AI tools (Claude Code, Cursor, Aider, etc.)
```

## Features

- **Intelligent Routing**: Routes requests to the optimal model based on task type
- **Cost Tracking**: Tracks and reports API costs across all providers
- **Provider Agnostic**: Works with Anthropic, OpenAI, Gemini, xAI, and more
- **Local Learning**: Learns from your usage patterns to improve routing
- **Privacy First**: Never sees your prompts or responses

## CLI Options

```bash
relayplane-proxy [command] [options]

Commands:
  (default)              Start the proxy server
  telemetry [on|off|status]  Manage telemetry settings
  stats                  Show usage statistics
  config                 Show configuration

Options:
  --port <number>    Port to listen on (default: 3001)
  --host <string>    Host to bind to (default: 127.0.0.1)
  --offline          Disable all network calls except LLM endpoints
  --audit            Show telemetry payloads before sending
  -v, --verbose      Enable verbose logging
  -h, --help         Show this help message
  --version          Show version
```

## Telemetry

RelayPlane collects anonymous telemetry to improve model routing. This data helps us understand usage patterns and optimize routing decisions.

### What We Collect (Exact Schema)

```json
{
  "device_id": "anon_8f3a...",
  "task_type": "code_review",
  "model": "claude-3-5-haiku",
  "tokens_in": 1847,
  "tokens_out": 423,
  "latency_ms": 2341,
  "success": true,
  "cost_usd": 0.02
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `device_id` | string | Anonymous random ID (not fingerprintable) |
| `task_type` | string | Inferred from token patterns, NOT prompt content |
| `model` | string | The model that handled the request |
| `tokens_in` | number | Input token count |
| `tokens_out` | number | Output token count |
| `latency_ms` | number | Request latency in milliseconds |
| `success` | boolean | Whether the request succeeded |
| `cost_usd` | number | Estimated cost in USD |

### Task Types

Task types are inferred from request characteristics (token counts, ratios, etc.) - never from prompt content:

- `quick_task` - Short input/output (< 500 tokens each)
- `code_review` - Medium-long input, medium output
- `generation` - High output/input ratio
- `classification` - Low output/input ratio, short output
- `long_context` - Input > 10,000 tokens
- `content_generation` - Output > 1,000 tokens
- `tool_use` - Request includes tool calls
- `general` - Default classification

### What We NEVER Collect

- ❌ Your prompts
- ❌ Model responses
- ❌ File paths or contents
- ❌ Anything that could identify you or your project

### Verification

You can verify exactly what data is collected:

```bash
# See telemetry payloads before they're sent
relayplane-proxy --audit

# Disable all telemetry transmission
relayplane-proxy --offline

# View the source code
# https://github.com/RelayPlane/proxy
```

### Opt-Out

To disable telemetry completely:

```bash
relayplane-proxy telemetry off
```

To re-enable:

```bash
relayplane-proxy telemetry on
```

Check current status:

```bash
relayplane-proxy telemetry status
```

## Configuration

Configuration is stored in `~/.relayplane/config.json`.

### Set API Key (Pro Features)

```bash
relayplane-proxy config set-key your-api-key
```

### View Configuration

```bash
relayplane-proxy config
```

## Usage Statistics

View your usage statistics:

```bash
relayplane-proxy stats
```

This shows:
- Total requests and cost
- Success rate
- Breakdown by model
- Breakdown by task type

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `XAI_API_KEY` | xAI/Grok API key |
| `MOONSHOT_API_KEY` | Moonshot API key |

## License

MIT
