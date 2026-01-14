/**
 * Tests for command protocol and sendCommand functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';

// Mock fs module
vi.mock('fs');

// Mock net module
vi.mock('net', () => {
  return {
    default: {
      Socket: vi.fn(),
    },
  };
});

import net from 'net';

describe('Command Protocol', () => {
  let testExports;
  let mockSocket;
  let socketEvents;

  beforeEach(async () => {
    // Set up mock socket
    socketEvents = {};
    mockSocket = {
      setTimeout: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
      connect: vi.fn(),
      on: vi.fn((event, handler) => {
        socketEvents[event] = handler;
        return mockSocket;
      }),
    };

    vi.mocked(net.Socket).mockImplementation(() => mockSocket);

    // Set up default config (no config file, use env defaults)
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // Reset modules to get fresh imports
    vi.resetModules();
    const module = await import('../vw_mcp_server.js');
    testExports = module.testExports;

    // Clear config cache
    if (testExports) {
      testExports.clearConfigCache();
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendCommand', () => {
    it('formats commands correctly without auth', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('PING');

      // Simulate connection
      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"ok","data":"pong"}'));
      socketEvents.end?.();

      await commandPromise;

      expect(mockSocket.write).toHaveBeenCalledWith('PING\n');
    });

    it('formats commands correctly with auth prefix', async () => {
      if (!testExports) return;

      // Set up config with API key
      const config = {
        servers: { default: { host: 'localhost', port: 9999, apiKey: 'secret123' } },
        default: 'default',
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      // Reset to pick up new config
      vi.resetModules();
      const module = await import('../vw_mcp_server.js');
      testExports = module.testExports;

      const commandPromise = testExports.sendCommand('PING');

      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"ok","data":"pong"}'));
      socketEvents.end?.();

      await commandPromise;

      expect(mockSocket.write).toHaveBeenCalledWith('AUTH:secret123 PING\n');
    });

    it('connects to correct host and port', async () => {
      if (!testExports) return;

      const config = {
        servers: { myserver: { host: 'example.com', port: 1234 } },
        default: 'myserver',
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      vi.resetModules();
      const module = await import('../vw_mcp_server.js');
      testExports = module.testExports;

      const commandPromise = testExports.sendCommand('PING');

      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"ok"}'));
      socketEvents.end?.();

      await commandPromise;

      expect(mockSocket.connect).toHaveBeenCalledWith(1234, 'example.com');
    });

    it('parses JSON responses correctly', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('CLASSES *');

      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"ok","data":["Object","String","Array"]}'));
      socketEvents.end?.();

      const result = await commandPromise;

      expect(result.status).toBe('ok');
      expect(result.data).toEqual(['Object', 'String', 'Array']);
    });

    it('handles multi-line responses (takes first line)', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('TEST');

      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"ok","data":"first"}\n{"extra":"ignored"}'));
      socketEvents.end?.();

      const result = await commandPromise;

      expect(result.status).toBe('ok');
      expect(result.data).toBe('first');
    });

    it('handles chunked data correctly', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('TEST');

      socketEvents.connect?.();
      // Send data in chunks
      socketEvents.data?.(Buffer.from('{"status":'));
      socketEvents.data?.(Buffer.from('"ok","data"'));
      socketEvents.data?.(Buffer.from(':"complete"}'));
      socketEvents.end?.();

      const result = await commandPromise;

      expect(result.status).toBe('ok');
      expect(result.data).toBe('complete');
    });

    it('handles AUTH_REQUIRED error with helpful message', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('PING');

      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"error","code":"AUTH_REQUIRED"}'));
      socketEvents.end?.();

      const result = await commandPromise;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Authentication required');
      expect(result.message).toContain('Add apiKey to your config');
    });

    it('handles AUTH_FAILED error with helpful message', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('PING');

      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"error","code":"AUTH_FAILED"}'));
      socketEvents.end?.();

      const result = await commandPromise;

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid API key');
    });

    it('handles timeout correctly', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('SLOW');

      socketEvents.connect?.();
      socketEvents.timeout?.();

      const result = await commandPromise;

      expect(result.status).toBe('error');
      expect(result.message).toContain('timed out');
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('sets socket timeout to 30 seconds', async () => {
      if (!testExports) return;

      testExports.sendCommand('PING');

      expect(mockSocket.setTimeout).toHaveBeenCalledWith(30000);
    });

    it('calls socket.end() after writing command', async () => {
      if (!testExports) return;

      const commandPromise = testExports.sendCommand('PING');

      socketEvents.connect?.();
      socketEvents.data?.(Buffer.from('{"status":"ok"}'));
      socketEvents.end?.();

      await commandPromise;

      expect(mockSocket.write).toHaveBeenCalled();
      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('returns error for unknown server name', async () => {
      if (!testExports) return;

      const result = await testExports.sendCommand('PING', 'nonexistent');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Unknown server');
    });
  });

  describe('formatResponse', () => {
    it('formats error responses', async () => {
      if (!testExports) return;

      const result = testExports.formatResponse({ status: 'error', message: 'Test error' });
      expect(result).toBe('Error: Test error');
    });

    it('formats string data', async () => {
      if (!testExports) return;

      const result = testExports.formatResponse({ status: 'ok', data: 'Hello world' });
      expect(result).toBe('Hello world');
    });

    it('formats array data as newline-separated', async () => {
      if (!testExports) return;

      const result = testExports.formatResponse({ status: 'ok', data: ['one', 'two', 'three'] });
      expect(result).toBe('one\ntwo\nthree');
    });

    it('formats object data as JSON', async () => {
      if (!testExports) return;

      const result = testExports.formatResponse({ status: 'ok', data: { key: 'value' } });
      expect(result).toBe('{\n  "key": "value"\n}');
    });

    it('handles null data', async () => {
      if (!testExports) return;

      const result = testExports.formatResponse({ status: 'ok', data: null });
      expect(result).toBe('No data returned');
    });

    it('handles undefined data', async () => {
      if (!testExports) return;

      const result = testExports.formatResponse({ status: 'ok' });
      expect(result).toBe('No data returned');
    });

    it('handles unknown error message', async () => {
      if (!testExports) return;

      const result = testExports.formatResponse({ status: 'error' });
      expect(result).toBe('Error: Unknown error');
    });
  });
});
