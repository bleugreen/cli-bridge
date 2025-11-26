# VisualWorks Smalltalk CLI Bridge

A TCP bridge that exposes VisualWorks Smalltalk code browsing and evaluation capabilities via a simple line-based protocol. Includes an MCP (Model Context Protocol) server for integration with Claude Code.

## Features

- Browse classes, methods, and hierarchies
- Read source code (when available)
- Evaluate arbitrary Smalltalk expressions
- Find senders and implementors of selectors
- Analyze compiled methods (messages sent, literals referenced)
- Works with deployed images (no source required for reflection)

## Quick Start

### 1. Start CliBridge in VisualWorks

```smalltalk
"File in the code"
(Filename named: '/path/to/CliBridge.st') fileIn.

"Start the server (defaults to port 9999)"
CliBridge start.

"Or specify a port"
CliBridge startOn: 9999.
```

Or start with command line argument:
```bash
./vwlinuxx86_64gui myimage.im -clibridge:9999
```

### 2. Install MCP Server Dependencies

```bash
cd /path/to/cli-bridge
npm install
```

### 3. Add MCP Server to Claude Code

```bash
# Local connection (defaults to localhost:9999)
claude mcp add --transport stdio visualworks \
  -- node /path/to/cli-bridge/vw_mcp_server.js

# Custom port
claude mcp add --transport stdio visualworks \
  --env VWCLI_PORT=9999 \
  -- node /path/to/cli-bridge/vw_mcp_server.js

# Remote connection (different machine)
claude mcp add --transport stdio visualworks \
  --env VWCLI_HOST=192.168.1.100 \
  --env VWCLI_PORT=9999 \
  -- node /path/to/cli-bridge/vw_mcp_server.js
```

### 4. Restart Claude Code

The MCP tools will be available after restart.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VWCLI_HOST` | `localhost` | Host running CliBridge |
| `VWCLI_PORT` | `9999` | Port CliBridge is listening on |

### Project-Level Config (.mcp.json)

For team sharing, create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "visualworks": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cli-bridge/vw_mcp_server.js"],
      "env": {
        "VWCLI_HOST": "smalltalk-server.local",
        "VWCLI_PORT": "9999"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `ping` | Test connection to CliBridge |
| `classes` | List classes (with optional pattern filter) |
| `class_info` | Get class definition (superclass, ivars, cvars) |
| `methods` | List instance or class methods |
| `source` | Get method source code |
| `fullsource` | Get all source for a class |
| `hierarchy` | Show superclasses and subclasses |
| `eval_smalltalk` | Evaluate Smalltalk expressions |
| `namespaces` | List all namespaces |
| `search` | Search classes and methods by pattern |
| `senders` | Find all callers of a selector |
| `implementors` | Find all implementations of a selector |
| `messages` | Get messages/literals from a method |

## Protocol

CliBridge uses a simple line-based TCP protocol:

**Request:** `COMMAND [args...]\n`
**Response:** `{"status":"ok","data":...}\n` or `{"status":"error","message":"..."}\n`

### Commands

```
PING                          → "pong"
CLASSES [pattern]             → ["ClassName", ...]
CLASS className               → {name, superclass, instanceVariables, ...}
METHODS className [class|instance] → ["selector", ...]
SOURCE className selector     → "source code..."
FULLSOURCE className          → "all methods..."
HIERARCHY className           → {class, superclasses, subclasses}
EVAL expression               → {result, class}
NAMESPACES                    → ["Namespace", ...]
SEARCH pattern                → [{type, name/class, selector}, ...]
SENDERS selector              → [{class, selector}, ...]
IMPLEMENTORS selector         → [{class, side}, ...]
MESSAGES className selector   → {messages, literals}
```

## CLI Wrapper (vwcli)

A bash wrapper is included for command-line usage:

```bash
# Set port
export VWCLI_PORT=9999

# Test connection
./vwcli ping

# List classes matching pattern
./vwcli classes Servlet

# Get class info
./vwcli class HttpServlet

# Get method source
./vwcli source GetVersionServlet doGet:response:

# Evaluate expression
./vwcli eval "Date today"

# Find senders
./vwcli senders restorePartQuarry:

# Find implementors
./vwcli implementors doGet:response:
```

## Files

| File | Description |
|------|-------------|
| `CliBridge.st` | Smalltalk server (file into VW image) |
| `vw_mcp_server.js` | MCP server for Claude Code |
| `vwcli` | Bash CLI wrapper for testing |
| `package.json` | Node.js dependencies |

## Requirements

- VisualWorks Smalltalk 8.x or 9.x
- Node.js 18+ (run `npm install` in this directory)
- Claude Code (for MCP integration)

## Security Notes

- CliBridge listens on all interfaces by default
- No authentication - use firewall rules for network access
- `eval` command executes arbitrary code - use with caution

## Troubleshooting

**Connection refused:**
- Ensure CliBridge is running: `CliBridge default` should return the instance
- Check port: `CliBridge default port`

**Connection timeout:**
- Verify host/port settings
- Check firewall allows the port

**No source available:**
- Some deployed images don't include source code
- Use `messages` tool to analyze compiled methods

**Port already in use:**
- Wait ~30 seconds for TIME_WAIT to clear
- Or use a different port

## License

MIT
