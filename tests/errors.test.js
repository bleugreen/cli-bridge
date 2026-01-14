/**
 * Tests for error handling scenarios
 *
 * These tests verify the server handles various error conditions
 * gracefully without crashing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { installMockSocket } from './mocks/socket.js';

// Mock fs module
vi.mock('fs');

// Mock net module
vi.mock('net', () => ({
  default: { Socket: vi.fn() },
}));

import net from 'net';

describe('Error Handling', () => {
  let testExports;
  let sendCommand;

  beforeEach(async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    vi.resetModules();
    const module = await import('../vw_mcp_server.js');
    testExports = module.testExports;

    if (testExports) {
      testExports.clearConfigCache();
      sendCommand = testExports.sendCommand;
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection Errors', () => {
    it('handles ECONNREFUSED gracefully', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        errorCode: 'ECONNREFUSED',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Connection refused');
      expect(result.message).toContain('Is CliBridge running?');
    });

    it('handles ENOTFOUND (DNS resolution failure)', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        errorCode: 'ENOTFOUND',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Connection error');
    });

    it('handles ETIMEDOUT', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        errorCode: 'ETIMEDOUT',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Connection error');
    });

    it('handles ECONNRESET', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        errorCode: 'ECONNRESET',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
    });

    it('handles socket timeout (30 seconds)', async () => {
      if (!sendCommand) return;

      const { socket } = installMockSocket(net, {
        timeout: true,
      });

      const result = await sendCommand('SLOW_COMMAND');

      expect(result.status).toBe('error');
      expect(result.message).toContain('timed out');
      expect(socket.destroy).toHaveBeenCalled();
    });
  });

  describe('Response Parsing Errors', () => {
    it('handles empty response', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: '',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid JSON');
    });

    it('handles malformed JSON response', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: '{ invalid json }',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid JSON');
    });

    it('handles truncated JSON response', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: '{"status": "ok", "data":',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid JSON');
    });

    it('handles non-JSON response', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: 'ERROR: Something went wrong\n',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
    });

    it('handles response with only whitespace', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: '   \n\t\n   ',
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
    });
  });

  describe('Authentication Errors', () => {
    it('handles AUTH_REQUIRED with server name in message', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: { status: 'error', code: 'AUTH_REQUIRED' },
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Authentication required');
      expect(result.message).toContain("'default'");
    });

    it('handles AUTH_FAILED with server name in message', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: { status: 'error', code: 'AUTH_FAILED' },
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid API key');
      expect(result.message).toContain("'default'");
    });
  });

  describe('Server Configuration Errors', () => {
    it('returns error for unknown server name', async () => {
      if (!sendCommand) return;

      const result = await sendCommand('PING', 'nonexistent_server');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Unknown server');
      expect(result.message).toContain('nonexistent_server');
    });

    it('includes available servers in unknown server error', async () => {
      if (!testExports) return;

      const config = {
        servers: {
          dev: { host: 'dev.local', port: 9998 },
          prod: { host: 'prod.local', port: 9999 },
        },
        default: 'dev',
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      vi.resetModules();
      const module = await import('../vw_mcp_server.js');
      sendCommand = module.testExports.sendCommand;

      const result = await sendCommand('PING', 'staging');

      expect(result.status).toBe('error');
      expect(result.message).toContain('Available:');
      expect(result.message).toContain('dev');
      expect(result.message).toContain('prod');
    });
  });

  describe('Network Edge Cases', () => {
    it('handles connection close before any data', async () => {
      if (!sendCommand) return;

      // Socket connects then immediately closes without data
      const { socket, events } = installMockSocket(net, {});

      // Override to manually control flow
      socket.connect = vi.fn((_port, _host) => {
        setImmediate(() => {
          events.connect?.();
          events.end?.(); // Close immediately without data
        });
      });

      const result = await sendCommand('PING');

      expect(result.status).toBe('error');
    });

    it('handles large response data', async () => {
      if (!sendCommand) return;

      // Create a large array of class names
      const largeData = Array.from({ length: 1000 }, (_, i) => `Class${i}`);

      installMockSocket(net, {
        response: { status: 'ok', data: largeData },
      });

      const result = await sendCommand('CLASSES *');

      expect(result.status).toBe('ok');
      expect(result.data.length).toBe(1000);
    });

    it('handles special characters in response', async () => {
      if (!sendCommand) return;

      const specialData = {
        source: 'method\n\t"A comment with \'quotes\'"\n\t^self + 1',
        class: 'Test\u0000Class', // null byte
      };

      installMockSocket(net, {
        response: { status: 'ok', data: specialData },
      });

      const result = await sendCommand('SOURCE Test method');

      expect(result.status).toBe('ok');
      expect(result.data.source).toContain('comment');
    });

    it('handles unicode in response', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: { status: 'ok', data: '日本語テスト émoji 🎉' },
      });

      const result = await sendCommand('EVAL "test"');

      expect(result.status).toBe('ok');
      expect(result.data).toContain('日本語');
      expect(result.data).toContain('🎉');
    });
  });

  describe('formatResponse Error Cases', () => {
    it('handles error response with missing message', () => {
      if (!testExports) return;

      const formatted = testExports.formatResponse({ status: 'error' });
      expect(formatted).toBe('Error: Unknown error');
    });

    it('handles primitive data types', () => {
      if (!testExports) return;

      expect(testExports.formatResponse({ status: 'ok', data: 42 })).toBe('42');
      expect(testExports.formatResponse({ status: 'ok', data: true })).toBe('true');
      expect(testExports.formatResponse({ status: 'ok', data: false })).toBe('false');
    });

    it('handles deeply nested objects', () => {
      if (!testExports) return;

      const nested = {
        level1: {
          level2: {
            level3: { value: 'deep' },
          },
        },
      };

      const formatted = testExports.formatResponse({ status: 'ok', data: nested });
      expect(formatted).toContain('deep');
    });
  });
});
