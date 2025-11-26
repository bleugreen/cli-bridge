#!/usr/bin/env node
/**
 * VisualWorks Smalltalk MCP Server
 *
 * A Model Context Protocol server that provides tools for interacting with
 * VisualWorks Smalltalk images via the CliBridge TCP server.
 *
 * Configuration via environment variables:
 *   VWCLI_HOST - Host to connect to (default: localhost)
 *   VWCLI_PORT - Port to connect to (default: 9999)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import net from "net";

const HOST = process.env.VWCLI_HOST || "localhost";
const PORT = parseInt(process.env.VWCLI_PORT || "9999", 10);
const TIMEOUT = 30000; // 30 seconds

/**
 * Send a command to CliBridge and return the parsed JSON response
 */
function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let response = "";

    socket.setTimeout(TIMEOUT);

    socket.on("connect", () => {
      socket.write(command + "\n");
      socket.end(); // Signal we're done writing
    });

    socket.on("data", (data) => {
      response += data.toString();
    });

    socket.on("end", () => {
      try {
        const lines = response.trim().split("\n");
        resolve(JSON.parse(lines[0]));
      } catch (e) {
        resolve({ status: "error", message: `Invalid JSON response: ${e.message}` });
      }
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ status: "error", message: `Connection timed out to ${HOST}:${PORT}` });
    });

    socket.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        resolve({ status: "error", message: `Connection refused to ${HOST}:${PORT}. Is CliBridge running?` });
      } else {
        resolve({ status: "error", message: `Connection error: ${err.message}` });
      }
    });

    socket.connect(PORT, HOST);
  });
}

/**
 * Format a CliBridge response for display
 */
function formatResponse(result) {
  if (result.status === "error") {
    return `Error: ${result.message || "Unknown error"}`;
  }

  const data = result.data;
  if (data === null || data === undefined) {
    return "No data returned";
  }

  if (typeof data === "string") {
    return data;
  } else if (Array.isArray(data)) {
    return data.map(String).join("\n");
  } else if (typeof data === "object") {
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}

// Create MCP server
const server = new McpServer({
  name: "visualworks",
  version: "1.0.0",
});

// Tool: ping
server.tool(
  "ping",
  "Test connection to the VisualWorks CliBridge server",
  {},
  async () => {
    const result = await sendCommand("PING");
    if (result.status === "ok") {
      return { content: [{ type: "text", text: `Connected to CliBridge at ${HOST}:${PORT}` }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: classes
server.tool(
  "classes",
  "List all classes in the VisualWorks image, optionally filtered by pattern",
  {
    pattern: z.string().optional().default("*").describe("Pattern to filter class names (case-insensitive substring match)")
  },
  async ({ pattern }) => {
    const result = await sendCommand(`CLASSES ${pattern}`);
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: class_info
server.tool(
  "class_info",
  "Get detailed information about a class",
  {
    class_name: z.string().describe("The name of the class to inspect")
  },
  async ({ class_name }) => {
    const result = await sendCommand(`CLASS ${class_name}`);
    if (result.status === "ok") {
      const d = result.data;
      const lines = [
        `Class: ${d.name || "Unknown"}`,
        `Superclass: ${d.superclass || "Unknown"}`,
        `Instance Variables: ${(d.instanceVariables || []).join(", ") || "(none)"}`,
        `Class Variables: ${(d.classVariables || []).join(", ") || "(none)"}`,
        `Category: ${d.category || "(none)"}`,
      ];
      if (d.comment) lines.push(`Comment: ${d.comment}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: methods
server.tool(
  "methods",
  "List methods for a class",
  {
    class_name: z.string().describe("The name of the class"),
    side: z.enum(["instance", "class"]).optional().default("instance").describe("'instance' or 'class' side methods")
  },
  async ({ class_name, side }) => {
    const result = await sendCommand(`METHODS ${class_name} ${side}`);
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: source
server.tool(
  "source",
  "Get the source code of a method",
  {
    class_name: z.string().describe("The name of the class containing the method"),
    selector: z.string().describe("The method selector (e.g., 'at:', 'at:put:', 'initialize')")
  },
  async ({ class_name, selector }) => {
    const result = await sendCommand(`SOURCE ${class_name} ${selector}`);
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: fullsource
server.tool(
  "fullsource",
  "Get the complete source code for a class including all methods",
  {
    class_name: z.string().describe("The name of the class")
  },
  async ({ class_name }) => {
    const result = await sendCommand(`FULLSOURCE ${class_name}`);
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: hierarchy
server.tool(
  "hierarchy",
  "Get the class hierarchy for a class (superclasses and subclasses)",
  {
    class_name: z.string().describe("The name of the class")
  },
  async ({ class_name }) => {
    const result = await sendCommand(`HIERARCHY ${class_name}`);
    if (result.status === "ok") {
      const d = result.data;
      const lines = [
        `Class: ${d.class || "Unknown"}`,
        "",
        "Superclasses (ancestors):",
        ...(d.superclasses || []).map(s => `  ${s}`),
        "",
        "Direct Subclasses:",
        ...(d.subclasses?.length ? d.subclasses.map(s => `  ${s}`) : ["  (none)"])
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: eval_smalltalk
server.tool(
  "eval_smalltalk",
  "Evaluate a Smalltalk expression in the running image",
  {
    expression: z.string().describe("The Smalltalk expression to evaluate")
  },
  async ({ expression }) => {
    const result = await sendCommand(`EVAL ${expression}`);
    if (result.status === "ok") {
      const d = result.data;
      return { content: [{ type: "text", text: `${d.result} (${d.class})` }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: namespaces
server.tool(
  "namespaces",
  "List all namespaces in the VisualWorks image",
  {},
  async () => {
    const result = await sendCommand("NAMESPACES");
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: search
server.tool(
  "search",
  "Search for classes and methods matching a pattern",
  {
    pattern: z.string().describe("The search pattern (case-insensitive substring match)")
  },
  async ({ pattern }) => {
    const result = await sendCommand(`SEARCH ${pattern}`);
    if (result.status === "ok") {
      const data = result.data || [];
      if (!data.length) return { content: [{ type: "text", text: "No matches found" }] };

      const lines = data.map(item => {
        if (item.type === "class") {
          return `[class] ${item.name}`;
        } else if (item.type === "method") {
          return `[method] ${item.class} >> ${item.selector}`;
        }
        return `[${item.type}] ${JSON.stringify(item)}`;
      });
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: senders
server.tool(
  "senders",
  "Find all methods that send a given message selector",
  {
    selector: z.string().describe("The message selector to find senders of (e.g., 'at:', 'do:')")
  },
  async ({ selector }) => {
    const result = await sendCommand(`SENDERS ${selector}`);
    if (result.status === "ok") {
      const data = result.data || [];
      if (!data.length) return { content: [{ type: "text", text: `No senders of #${selector} found` }] };

      const lines = [`Senders of #${selector} (${data.length} found):`];
      for (const item of data) {
        lines.push(`  ${item.class} >> ${item.selector}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: implementors
server.tool(
  "implementors",
  "Find all classes that implement a given selector",
  {
    selector: z.string().describe("The message selector to find implementors of (e.g., 'printOn:')")
  },
  async ({ selector }) => {
    const result = await sendCommand(`IMPLEMENTORS ${selector}`);
    if (result.status === "ok") {
      const data = result.data || [];
      if (!data.length) return { content: [{ type: "text", text: `No implementors of #${selector} found` }] };

      const lines = [`Implementors of #${selector} (${data.length} found):`];
      for (const item of data) {
        if (item.side === "class") {
          lines.push(`  ${item.class} class >> ${selector}`);
        } else {
          lines.push(`  ${item.class} >> ${selector}`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Tool: messages
server.tool(
  "messages",
  "Get messages sent and literals referenced by a method (works without source code)",
  {
    class_name: z.string().describe("The name of the class containing the method"),
    selector: z.string().describe("The method selector")
  },
  async ({ class_name, selector }) => {
    const result = await sendCommand(`MESSAGES ${class_name} ${selector}`);
    if (result.status === "ok") {
      const d = result.data;
      const lines = [
        `Method: ${d.class} >> ${d.selector}`,
        "",
        "Messages sent:",
        ...(d.messages || []).map(m => `  #${m}`),
        "",
        "Literals referenced:",
        ...(d.literals || []).map(l => `  ${l}`)
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    return { content: [{ type: "text", text: formatResponse(result) }] };
  }
);

// Start the server
async function main() {
  console.error(`VisualWorks MCP Server starting (connecting to ${HOST}:${PORT})`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
