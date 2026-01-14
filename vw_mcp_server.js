#!/usr/bin/env node
/**
 * VisualWorks Smalltalk MCP Server
 *
 * A Model Context Protocol server that provides tools for interacting with
 * VisualWorks Smalltalk images via the CliBridge TCP server.
 *
 * Configuration:
 *   Config file (JSON with named servers):
 *     CLIBRIDGE_CONFIG - Path to config file
 *     ~/.config/clibridge/servers.json
 *     ~/.clibridge/servers.json
 *
 *   Legacy environment variables (single server, backward compat):
 *     VWCLI_HOST - Host to connect to (default: localhost)
 *     VWCLI_PORT - Port to connect to (default: 9999)
 *     VWCLI_API_KEY - API key for authentication
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  validateClassName,
  validateSelector,
  validatePattern,
  validateExpression,
  validateSource,
  validateServerName,
} from './lib/validation.js';

const TIMEOUT = 30000; // 30 seconds

// Configuration paths to search (in order)
const CONFIG_PATHS = [
  process.env.CLIBRIDGE_CONFIG,
  path.join(os.homedir(), '.config/clibridge/servers.json'),
  path.join(os.homedir(), '.clibridge/servers.json'),
].filter(Boolean);

let cachedConfig = null;

/**
 * Load configuration from file or environment variables
 */
function loadConfig() {
  if (cachedConfig) return cachedConfig;

  // Try config files
  for (const configPath of CONFIG_PATHS) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        cachedConfig = JSON.parse(content);
        console.error(`Loaded config from ${configPath}`);
        return cachedConfig;
      }
    } catch (e) {
      console.error(`Error loading config from ${configPath}: ${e.message}`);
    }
  }

  // Fallback: legacy env vars (backward compat)
  cachedConfig = {
    servers: {
      default: {
        host: process.env.VWCLI_HOST || 'localhost',
        port: parseInt(process.env.VWCLI_PORT || '9999', 10),
        apiKey: process.env.VWCLI_API_KEY || undefined,
      },
    },
    default: 'default',
  };
  return cachedConfig;
}

/**
 * Get server configuration by name
 */
function getServer(name) {
  const config = loadConfig();
  const serverName = name || config.default || Object.keys(config.servers)[0];
  const server = config.servers[serverName];

  if (!server) {
    const available = Object.keys(config.servers).join(', ');
    throw new Error(`Unknown server: ${serverName}. Available: ${available}`);
  }

  return { name: serverName, ...server };
}

/**
 * Send a command to CliBridge and return the parsed JSON response
 * @param {string} command - The command to send
 * @param {string} [imageName] - Optional server name from config
 */
function sendCommand(command, imageName) {
  return new Promise((resolve, _reject) => {
    let server;
    try {
      server = getServer(imageName);
    } catch (e) {
      resolve({ status: 'error', message: e.message });
      return;
    }

    const socket = new net.Socket();
    let response = '';

    socket.setTimeout(TIMEOUT);

    socket.on('connect', () => {
      // Prepend AUTH:key if apiKey is configured
      const prefix = server.apiKey ? `AUTH:${server.apiKey} ` : '';
      socket.write(prefix + command + '\n');
      socket.end(); // Signal we're done writing
    });

    socket.on('data', (data) => {
      response += data.toString();
    });

    socket.on('end', () => {
      try {
        const lines = response.trim().split('\n');
        const result = JSON.parse(lines[0]);

        // Handle auth errors with better messages
        if (result.status === 'error' && result.code === 'AUTH_REQUIRED') {
          resolve({
            status: 'error',
            message: `Authentication required for '${server.name}'. Add apiKey to your config.`,
          });
        } else if (result.status === 'error' && result.code === 'AUTH_FAILED') {
          resolve({
            status: 'error',
            message: `Invalid API key for '${server.name}'. Check your configuration.`,
          });
        } else {
          resolve(result);
        }
      } catch (e) {
        resolve({ status: 'error', message: `Invalid JSON response: ${e.message}` });
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        status: 'error',
        message: `Connection timed out to ${server.host}:${server.port}`,
      });
    });

    socket.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({
          status: 'error',
          message: `Connection refused to ${server.name} (${server.host}:${server.port}). Is CliBridge running?`,
        });
      } else {
        resolve({ status: 'error', message: `Connection error: ${err.message}` });
      }
    });

    socket.connect(server.port, server.host);
  });
}

/**
 * Format a validation error for MCP response
 */
function validationError(result) {
  return {
    content: [{ type: 'text', text: `Validation error: ${result.error}` }],
    isError: true,
  };
}

/**
 * Format a CliBridge response for display
 */
function formatResponse(result) {
  if (result.status === 'error') {
    return `Error: ${result.message || 'Unknown error'}`;
  }

  const data = result.data;
  if (data === null || data === undefined) {
    return 'No data returned';
  }

  if (typeof data === 'string') {
    return data;
  } else if (Array.isArray(data)) {
    return data.map(String).join('\n');
  } else if (typeof data === 'object') {
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}

// Create MCP server
const server = new McpServer({
  name: 'visualworks',
  version: '1.0.0',
});

// Tool: ping
server.tool(
  'ping',
  'Test connection to the VisualWorks CliBridge server',
  {
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ image }) => {
    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand('PING', image);
    if (result.status === 'ok') {
      const server = getServer(image);
      return {
        content: [
          {
            type: 'text',
            text: `Connected to CliBridge '${server.name}' at ${server.host}:${server.port}`,
          },
        ],
      };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: classes
server.tool(
  'classes',
  'List all classes in the VisualWorks image, optionally filtered by pattern',
  {
    pattern: z
      .string()
      .optional()
      .default('*')
      .describe('Pattern to filter class names (case-insensitive substring match)'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ pattern, image }) => {
    const patternValidation = validatePattern(pattern);
    if (!patternValidation.valid) return validationError(patternValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`CLASSES ${pattern}`, image);
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: class_info
server.tool(
  'class_info',
  'Get detailed information about a class',
  {
    class_name: z.string().describe('The name of the class to inspect'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`CLASS ${class_name}`, image);
    if (result.status === 'ok') {
      const d = result.data;
      const lines = [
        `Class: ${d.name || 'Unknown'}`,
        `Superclass: ${d.superclass || 'Unknown'}`,
        `Instance Variables: ${(d.instanceVariables || []).join(', ') || '(none)'}`,
        `Class Variables: ${(d.classVariables || []).join(', ') || '(none)'}`,
        `Category: ${d.category || '(none)'}`,
      ];
      if (d.comment) lines.push(`Comment: ${d.comment}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: methods
server.tool(
  'methods',
  'List methods for a class',
  {
    class_name: z.string().describe('The name of the class'),
    side: z
      .enum(['instance', 'class'])
      .optional()
      .default('instance')
      .describe("'instance' or 'class' side methods"),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, side, image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`METHODS ${class_name} ${side}`, image);
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: source
server.tool(
  'source',
  'Get the source code of a method',
  {
    class_name: z.string().describe('The name of the class containing the method'),
    selector: z.string().describe("The method selector (e.g., 'at:', 'at:put:', 'initialize')"),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, selector, image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const selectorValidation = validateSelector(selector);
    if (!selectorValidation.valid) return validationError(selectorValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`SOURCE ${class_name} ${selector}`, image);
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: fullsource
server.tool(
  'fullsource',
  'Get the complete source code for a class including all methods',
  {
    class_name: z.string().describe('The name of the class'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`FULLSOURCE ${class_name}`, image);
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: hierarchy
server.tool(
  'hierarchy',
  'Get the class hierarchy for a class (superclasses and subclasses)',
  {
    class_name: z.string().describe('The name of the class'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`HIERARCHY ${class_name}`, image);
    if (result.status === 'ok') {
      const d = result.data;
      const lines = [
        `Class: ${d.class || 'Unknown'}`,
        '',
        'Superclasses (ancestors):',
        ...(d.superclasses || []).map((s) => `  ${s}`),
        '',
        'Direct Subclasses:',
        ...(d.subclasses?.length ? d.subclasses.map((s) => `  ${s}`) : ['  (none)']),
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: eval_smalltalk
server.tool(
  'eval_smalltalk',
  'Evaluate a Smalltalk expression in the running image',
  {
    expression: z.string().describe('The Smalltalk expression to evaluate'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ expression, image }) => {
    const exprValidation = validateExpression(expression);
    if (!exprValidation.valid) return validationError(exprValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`EVAL ${expression}`, image);
    if (result.status === 'ok') {
      const d = result.data;
      return { content: [{ type: 'text', text: `${d.result} (${d.class})` }] };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: namespaces
server.tool(
  'namespaces',
  'List all namespaces in the VisualWorks image',
  {
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ image }) => {
    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand('NAMESPACES', image);
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: search
server.tool(
  'search',
  'Search for classes and methods matching a pattern',
  {
    pattern: z.string().describe('The search pattern (case-insensitive substring match)'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ pattern, image }) => {
    const patternValidation = validatePattern(pattern);
    if (!patternValidation.valid) return validationError(patternValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`SEARCH ${pattern}`, image);
    if (result.status === 'ok') {
      const data = result.data || [];
      if (!data.length) return { content: [{ type: 'text', text: 'No matches found' }] };

      const lines = data.map((item) => {
        if (item.type === 'class') {
          return `[class] ${item.name}`;
        } else if (item.type === 'method') {
          return `[method] ${item.class} >> ${item.selector}`;
        }
        return `[${item.type}] ${JSON.stringify(item)}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: senders
server.tool(
  'senders',
  'Find all methods that send a given message selector',
  {
    selector: z.string().describe("The message selector to find senders of (e.g., 'at:', 'do:')"),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ selector, image }) => {
    const selectorValidation = validateSelector(selector);
    if (!selectorValidation.valid) return validationError(selectorValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`SENDERS ${selector}`, image);
    if (result.status === 'ok') {
      const data = result.data || [];
      if (!data.length)
        return { content: [{ type: 'text', text: `No senders of #${selector} found` }] };

      const lines = [`Senders of #${selector} (${data.length} found):`];
      for (const item of data) {
        lines.push(`  ${item.class} >> ${item.selector}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: implementors
server.tool(
  'implementors',
  'Find all classes that implement a given selector',
  {
    selector: z
      .string()
      .describe("The message selector to find implementors of (e.g., 'printOn:')"),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ selector, image }) => {
    const selectorValidation = validateSelector(selector);
    if (!selectorValidation.valid) return validationError(selectorValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`IMPLEMENTORS ${selector}`, image);
    if (result.status === 'ok') {
      const data = result.data || [];
      if (!data.length)
        return { content: [{ type: 'text', text: `No implementors of #${selector} found` }] };

      const lines = [`Implementors of #${selector} (${data.length} found):`];
      for (const item of data) {
        if (item.side === 'class') {
          lines.push(`  ${item.class} class >> ${selector}`);
        } else {
          lines.push(`  ${item.class} >> ${selector}`);
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: messages
server.tool(
  'messages',
  'Get messages sent and literals referenced by a method (works without source code)',
  {
    class_name: z.string().describe('The name of the class containing the method'),
    selector: z.string().describe('The method selector'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, selector, image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const selectorValidation = validateSelector(selector);
    if (!selectorValidation.valid) return validationError(selectorValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`MESSAGES ${class_name} ${selector}`, image);
    if (result.status === 'ok') {
      const d = result.data;
      const lines = [
        `Method: ${d.class} >> ${d.selector}`,
        '',
        'Messages sent:',
        ...(d.messages || []).map((m) => `  #${m}`),
        '',
        'Literals referenced:',
        ...(d.literals || []).map((l) => `  ${l}`),
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: edit_method
server.tool(
  'edit_method',
  'Add or replace a method in a VisualWorks class. Automatically backs up existing method for single-level undo.',
  {
    class_name: z.string().describe('The class name'),
    selector: z.string().describe("Method selector (e.g., 'at:', 'at:put:', 'initialize')"),
    source: z.string().describe('Complete method source code including the method signature line'),
    side: z
      .enum(['instance', 'class'])
      .optional()
      .default('instance')
      .describe("'instance' for instance methods (default), 'class' for class-side methods"),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, selector, source, side = 'instance', image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const selectorValidation = validateSelector(selector);
    if (!selectorValidation.valid) return validationError(selectorValidation);

    const sourceValidation = validateSource(source);
    if (!sourceValidation.valid) return validationError(sourceValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    // Base64 encode the source to handle newlines and special characters
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    const result = await sendCommand(`EDIT ${class_name} ${selector} ${side} ${encoded}`, image);

    if (result.status === 'ok') {
      const d = result.data;
      const action = d.wasNew ? 'Created' : 'Updated';
      const sideLabel = d.side === 'class' ? ' (class side)' : '';
      return {
        content: [{ type: 'text', text: `${action} ${d.class}>>${d.selector}${sideLabel}` }],
      };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: undo_edit
server.tool(
  'undo_edit',
  'Restore the previous version of a method (single-level undo). Only works once per method after an edit.',
  {
    class_name: z.string().describe('The class name'),
    selector: z.string().describe('Method selector to undo'),
    side: z
      .enum(['instance', 'class'])
      .optional()
      .default('instance')
      .describe("'instance' or 'class' - must match the side of the original edit"),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({ class_name, selector, side = 'instance', image }) => {
    const classValidation = validateClassName(class_name);
    if (!classValidation.valid) return validationError(classValidation);

    const selectorValidation = validateSelector(selector);
    if (!selectorValidation.valid) return validationError(selectorValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    const result = await sendCommand(`UNDO ${class_name} ${selector} ${side}`, image);

    if (result.status === 'ok') {
      const d = result.data;
      const sideLabel = d.side === 'class' ? ' (class side)' : '';
      return {
        content: [{ type: 'text', text: `Restored ${d.class}>>${d.selector}${sideLabel}` }],
      };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: create_class
server.tool(
  'create_class',
  'Create a new class in the VisualWorks image. Fails if class already exists.',
  {
    name: z.string().describe('The name of the new class'),
    superclass: z
      .string()
      .optional()
      .default('Object')
      .describe('The superclass name (default: Object)'),
    instance_variables: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Instance variable names (e.g., ['name', 'age'])"),
    class_variables: z
      .array(z.string())
      .optional()
      .default([])
      .describe("Class variable names (e.g., ['DefaultTimeout'])"),
    class_instance_variables: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Class instance variable names'),
    category: z
      .string()
      .optional()
      .default('CliBridge-Created')
      .describe('Category/package for the class'),
    image: z.string().optional().describe('Server name from config (uses default if omitted)'),
  },
  async ({
    name,
    superclass = 'Object',
    instance_variables = [],
    class_variables = [],
    class_instance_variables = [],
    category = 'CliBridge-Created',
    image,
  }) => {
    const nameValidation = validateClassName(name);
    if (!nameValidation.valid) return validationError(nameValidation);

    const superclassValidation = validateClassName(superclass);
    if (!superclassValidation.valid) return validationError(superclassValidation);

    const serverValidation = validateServerName(image);
    if (!serverValidation.valid) return validationError(serverValidation);

    // Build JSON payload and Base64 encode it
    const payload = {
      name,
      superclass,
      instanceVariables: instance_variables,
      classVariables: class_variables,
      classInstanceVariables: class_instance_variables,
      category,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const result = await sendCommand(`CREATECLASS ${encoded}`, image);

    if (result.status === 'ok') {
      const d = result.data;
      return {
        content: [
          {
            type: 'text',
            text: `Created class ${d.name} < ${d.superclass} in category '${d.category}'`,
          },
        ],
      };
    }
    return { content: [{ type: 'text', text: formatResponse(result) }] };
  }
);

// Tool: list_images
server.tool('list_images', 'List all configured VisualWorks servers', {}, () => {
  const config = loadConfig();
  const lines = Object.entries(config.servers).map(([name, s]) => {
    const isDefault = name === config.default ? ' (default)' : '';
    const hasAuth = s.apiKey ? ' [auth]' : '';
    return `${name}: ${s.host}:${s.port}${hasAuth}${isDefault}`;
  });
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

// Start the server
async function main() {
  const config = loadConfig();
  const serverCount = Object.keys(config.servers).length;
  console.error(
    `VisualWorks MCP Server starting (${serverCount} server(s) configured, default: ${config.default})`
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Export internals for testing (only when not running as main)
export const testExports =
  process.env.NODE_ENV === 'test' || process.env.VITEST
    ? {
        loadConfig,
        getServer,
        sendCommand,
        formatResponse,
        clearConfigCache: () => {
          cachedConfig = null;
        },
      }
    : null;

// Only start server when run directly (not when imported for testing)
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
