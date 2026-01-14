/**
 * Mock socket utilities for testing MCP tools without real TCP connections
 */

import { vi } from 'vitest';

/**
 * Create a mock socket that simulates TCP connection behavior
 * @param {object} options Configuration options
 * @param {string|object} options.response - Response to send (string or object to stringify)
 * @param {string} options.errorCode - Error code to emit (e.g., 'ECONNREFUSED')
 * @param {boolean} options.timeout - Whether to simulate timeout
 * @param {number} options.delay - Delay before responding (ms)
 * @returns {object} Mock socket with captured data
 */
export function createMockSocket(options = {}) {
  const captured = {
    host: null,
    port: null,
    command: null,
  };

  const events = {};

  const socket = {
    setTimeout: vi.fn(),
    write: vi.fn((data) => {
      captured.command = data;
    }),
    end: vi.fn(),
    destroy: vi.fn(),
    connect: vi.fn((port, host) => {
      captured.port = port;
      captured.host = host;

      const respond = () => {
        if (options.errorCode) {
          const err = new Error(`Connection error: ${options.errorCode}`);
          err.code = options.errorCode;
          events.error?.(err);
        } else if (options.timeout) {
          events.timeout?.();
        } else {
          events.connect?.();
          if (options.response !== undefined) {
            const responseStr =
              typeof options.response === 'string'
                ? options.response
                : JSON.stringify(options.response);
            events.data?.(Buffer.from(responseStr));
          }
          events.end?.();
        }
      };

      if (options.delay) {
        setTimeout(respond, options.delay);
      } else {
        // Use setImmediate to simulate async behavior
        setImmediate(respond);
      }
    }),
    on: vi.fn((event, handler) => {
      events[event] = handler;
      return socket;
    }),
  };

  return { socket, captured, events };
}

/**
 * Create a success response object
 */
export function okResponse(data) {
  return { status: 'ok', data };
}

/**
 * Create an error response object
 */
export function errorResponse(message, code) {
  const resp = { status: 'error', message };
  if (code) resp.code = code;
  return resp;
}

/**
 * Install mock socket on net module
 * @param {object} netMock - The mocked net module
 * @param {object} options - Options to pass to createMockSocket
 * @returns {object} The mock socket and captured data
 */
export function installMockSocket(netMock, options = {}) {
  const { socket, captured, events } = createMockSocket(options);
  vi.mocked(netMock.Socket).mockImplementation(() => socket);
  return { socket, captured, events };
}
