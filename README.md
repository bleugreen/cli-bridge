# VisualWorks Smalltalk CLI Bridge

A TCP bridge that exposes VisualWorks Smalltalk code browsing and evaluation capabilities via a simple line-based protocol. Includes an MCP (Model Context Protocol) server for integration with Claude Code.

## Features

- Browse classes, methods, and hierarchies
- Read source code (when available)
- **Create classes** and **edit methods** with single-level undo support
- Evaluate arbitrary Smalltalk expressions
- Find senders and implementors of selectors
- Analyze compiled methods (messages sent, literals referenced)
- Works with deployed images (no source required for reflection)

## Quick Start

### 1. Start CliBridge in VisualWorks

```smalltalk
"File in the code"
(Filename named: '/path/to/CliBridge.st') fileIn.

"Start without auth (local development)"
CliBridge startOn: 9999.

"Start with authentication (production/remote access)"
CliBridge startWithAuthOn: 9999.
"Prints API key to Transcript - copy this to your MCP config"
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

### Multi-Image Configuration (Recommended)

Create a config file to manage multiple Smalltalk images:

**~/.config/clibridge/servers.json** or **~/.clibridge/servers.json**:

```json
{
  "servers": {
    "local": {
      "host": "localhost",
      "port": 9999
    },
    "production": {
      "host": "prod-server.example.com",
      "port": 9999,
      "apiKey": "vw_abc123..."
    },
    "staging": {
      "host": "staging.example.com",
      "port": 9999,
      "apiKey": "vw_def456..."
    }
  },
  "default": "local"
}
```

Then add the MCP server:

```bash
claude mcp add --transport stdio visualworks \
  --env CLIBRIDGE_CONFIG=~/.config/clibridge/servers.json \
  -- node /path/to/cli-bridge/vw_mcp_server.js
```

All tools accept an optional `image` parameter to target a specific server:

```
mcp__visualworks__classes({ pattern: "Http" })                  # uses default
mcp__visualworks__classes({ pattern: "Http", image: "production" })  # uses production
mcp__visualworks__list_images()                                 # shows all servers
```

### Legacy Environment Variables (Single Server)

For simple setups, you can use environment variables:

| Variable        | Default     | Description                    |
| --------------- | ----------- | ------------------------------ |
| `VWCLI_HOST`    | `localhost` | Host running CliBridge         |
| `VWCLI_PORT`    | `9999`      | Port CliBridge is listening on |
| `VWCLI_API_KEY` | (none)      | API key for authentication     |

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
        "CLIBRIDGE_CONFIG": "/path/to/servers.json"
      }
    }
  }
}
```

## Available Tools

All tools accept an optional `image` parameter to target a specific server from your config.

| Tool             | Description                                                |
| ---------------- | ---------------------------------------------------------- |
| `ping`           | Test connection to CliBridge                               |
| `list_images`    | List all configured servers                                |
| `classes`        | List classes (with optional pattern filter)                |
| `class_info`     | Get class definition (superclass, ivars, cvars)            |
| `methods`        | List instance or class methods                             |
| `source`         | Get method source code                                     |
| `fullsource`     | Get all source for a class                                 |
| `hierarchy`      | Show superclasses and subclasses                           |
| `eval_smalltalk` | Evaluate Smalltalk expressions                             |
| `namespaces`     | List all namespaces                                        |
| `search`         | Search classes and methods by pattern                      |
| `senders`        | Find all callers of a selector                             |
| `implementors`   | Find all implementations of a selector                     |
| `messages`       | Get messages/literals from a method                        |
| `edit_method`    | Add or replace a method (auto-backup for undo)             |
| `undo_edit`      | Restore previous version of a method                       |
| `create_class`   | Create a new class with specified superclass and variables |

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
EDIT className selector side base64Source → {class, selector, side, wasNew}
UNDO className selector side  → {restored, class, selector, side}
CREATECLASS base64JsonPayload → {created, name, superclass, category}
```

### Edit Protocol Notes

The `EDIT` command uses Base64-encoded source to handle multi-line methods:

- `side`: "instance" or "class"
- `base64Source`: Complete method source including signature line, Base64-encoded
- Previous version is automatically saved for single-level undo
- Undo is cleared after use (single-level only)

### Create Class Protocol

The `CREATECLASS` command uses a Base64-encoded JSON payload:

```json
{
  "name": "MyClass",
  "superclass": "Object",
  "instanceVariables": ["foo", "bar"],
  "classVariables": ["SharedState"],
  "classInstanceVariables": [],
  "category": "MyApp-Model"
}
```

- Fails if class already exists
- All fields except `name` are optional

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

| File               | Description                           |
| ------------------ | ------------------------------------- |
| `CliBridge.st`     | Smalltalk server (file into VW image) |
| `vw_mcp_server.js` | MCP server for Claude Code            |
| `vwcli`            | Bash CLI wrapper for testing          |
| `package.json`     | Node.js dependencies                  |

## Requirements

- VisualWorks Smalltalk 8.x or 9.x
- Node.js 18+ (run `npm install` in this directory)
- Claude Code (for MCP integration)

## Authentication

CliBridge supports optional API key authentication for remote access.

### Enabling Auth (Smalltalk side)

```smalltalk
"Start with authentication required"
CliBridge startWithAuthOn: 9999.

"API key is auto-generated and saved to ~/.clibridge/api-key"
"Also printed to Transcript for copying to your MCP config"
```

The API key is:

- Generated once on first `startWithAuthOn:` call
- Persisted in `~/.clibridge/api-key`
- Printed to Transcript so you can copy it
- Can be overridden by `CLIBRIDGE_API_KEY` environment variable (useful for EC2/SSM)

### Auth Protocol

When auth is enabled, clients must prefix commands with `AUTH:key`:

```
AUTH:vw_abc123 PING
AUTH:vw_abc123 CLASSES Array
```

Without auth prefix, you'll receive:

```json
{ "status": "error", "code": "AUTH_REQUIRED", "message": "Authentication required" }
```

### Security Notes

- `startOn:` - No auth, suitable for local development
- `startWithAuthOn:` - Auth required for ALL connections
- `eval` command executes arbitrary code - use with caution
- `edit` command modifies code in the running image - changes are immediate
- API keys are transmitted in plaintext - use SSH tunnel or VPN for untrusted networks

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
