# VisualWorks MCP Server - Usage Notes

## Working Tools

| Tool             | Status | Notes                                                       |
| ---------------- | ------ | ----------------------------------------------------------- |
| `ping`           | OK     | Confirms connection to CliBridge                            |
| `classes`        | OK     | Pattern filtering works, found 6900+ classes                |
| `class_info`     | OK     | Shows superclass, ivars, cvars                              |
| `methods`        | OK     | Lists instance/class methods                                |
| `source`         | OK     | Gets individual method source                               |
| `fullsource`     | OK     | All methods for a class - very useful                       |
| `hierarchy`      | OK     | Shows ancestors and direct subclasses                       |
| `eval_smalltalk` | OK     | Arbitrary expression evaluation - powerful                  |
| `search`         | OK     | Finds classes and methods by pattern                        |
| `senders`        | NEW    | Find all callers of a selector                              |
| `implementors`   | NEW    | Find all classes implementing a selector                    |
| `messages`       | NEW    | Get messages/literals from a method (works without source!) |
| `namespaces`     | ?      | Timed out - may need investigation                          |

## Source Code Availability

- **Classes with source**: Recently edited classes (e.g., `GetVersionServlet`, `CliBridge`)
- **Classes without source**: Deployed/compiled classes show structure but empty method bodies
- Timestamps in source comments indicate edit history (e.g., `@__bryan 09/20/2025`)

## Useful Patterns

```
# Find all servlet classes
classes("Servlet")

# Check class hierarchy
hierarchy("HttpServlet")

# Get full implementation
fullsource("GetVersionServlet")

# Run arbitrary Smalltalk
eval_smalltalk("Smalltalk allClasses size")
eval_smalltalk("Date today")

# NEW: Find who calls a method
senders("restorePartQuarry:")

# NEW: Find all implementations
implementors("doGet:response:")

# NEW: Understand method without source
messages("QuarryDB", "restorePartQuarry:")
# Returns: messages sent + literals (classes referenced)
```

## Configuration

- Port set via `VWCLI_PORT` environment variable
- Host set via `VWCLI_HOST` (default: localhost)
- Config in `~/.claude.json` under project's `mcpServers`
- CliBridge must be running in VW image: `CliBridge startOn: <port>`

## Remote Connection

```bash
# CliBridge listens on all interfaces by default
# From another machine:
claude mcp add --transport stdio visualworks \
  --env VWCLI_HOST=192.168.1.100 \
  --env VWCLI_PORT=9999 \
  -- python3 /path/to/vw_mcp_server.py
```

## Known Issues

- Socket must be closed properly (fixed with `ensure:` block in CliBridge)
- ~30 second TIME_WAIT between restarts on same port (SO_REUSEADDR attempted but VW API issues)
- `namespaces` command may timeout on large images
- No authentication - use firewall for network security
