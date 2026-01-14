/**
 * Global test setup for Vitest
 *
 * This file runs before each test file and provides common
 * utilities and mocks for testing the MCP server.
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Store original environment variables
const originalEnv = { ...process.env };

// Reset environment and mocks before each test
beforeEach(() => {
  // Clear all cached modules
  vi.resetModules();

  // Reset environment variables
  process.env = { ...originalEnv };

  // Clear specific env vars that affect config loading
  delete process.env.CLIBRIDGE_CONFIG;
  delete process.env.VWCLI_HOST;
  delete process.env.VWCLI_PORT;
  delete process.env.VWCLI_API_KEY;
});

afterEach(() => {
  // Restore original environment
  process.env = { ...originalEnv };

  // Clear all mocks
  vi.clearAllMocks();
});

// Global test utilities

/**
 * Create a mock TCP socket for testing
 * @param {object} options - Configuration options
 * @param {string} options.response - JSON response to return
 * @param {string} options.error - Error to emit (e.g., 'ECONNREFUSED')
 * @param {boolean} options.timeout - Whether to simulate timeout
 * @returns {object} Mock socket and captured data
 */
export function createMockSocket(options = {}) {
  const captured = {
    host: null,
    port: null,
    data: null,
  };

  const mockSocket = {
    _events: {},
    setTimeout: vi.fn(),
    write: vi.fn((data) => {
      captured.data = data;
    }),
    end: vi.fn(),
    destroy: vi.fn(),
    connect: vi.fn((port, host) => {
      captured.port = port;
      captured.host = host;

      // Simulate async connection
      setTimeout(() => {
        if (options.error) {
          const err = new Error(options.error);
          err.code = options.error;
          mockSocket._events.error?.(err);
        } else if (options.timeout) {
          mockSocket._events.timeout?.();
        } else {
          mockSocket._events.connect?.();
          if (options.response) {
            mockSocket._events.data?.(Buffer.from(options.response));
          }
          mockSocket._events.end?.();
        }
      }, 0);
    }),
    on: vi.fn((event, handler) => {
      mockSocket._events[event] = handler;
      return mockSocket;
    }),
  };

  return { socket: mockSocket, captured };
}

/**
 * Create a valid JSON response for testing
 * @param {object} data - The data to include in the response
 * @returns {string} JSON string response
 */
export function createResponse(data) {
  return JSON.stringify({ status: 'ok', data });
}

/**
 * Create an error JSON response for testing
 * @param {string} message - Error message
 * @param {string} code - Optional error code
 * @returns {string} JSON string response
 */
export function createErrorResponse(message, code) {
  const response = { status: 'error', message };
  if (code) response.code = code;
  return JSON.stringify(response);
}
