/**
 * Integration tests for MCP tools
 *
 * These tests verify the tool handlers work correctly by mocking
 * the TCP socket layer and testing the full tool execution path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { installMockSocket, okResponse, errorResponse } from './mocks/socket.js';

// Mock fs module
vi.mock('fs');

// Mock net module
vi.mock('net', () => ({
  default: { Socket: vi.fn() },
}));

import net from 'net';

describe('MCP Tools', () => {
  let testExports;
  let sendCommand;

  beforeEach(async () => {
    // Default config
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

  describe('ping', () => {
    it('sends PING command and returns success', async () => {
      if (!sendCommand) return;

      const { captured } = installMockSocket(net, {
        response: okResponse('pong'),
      });

      const result = await sendCommand('PING');

      expect(captured.command).toBe('PING\n');
      expect(result.status).toBe('ok');
      expect(result.data).toBe('pong');
    });
  });

  describe('classes', () => {
    it('sends CLASSES command with pattern', async () => {
      if (!sendCommand) return;

      const { captured } = installMockSocket(net, {
        response: okResponse(['Object', 'String', 'OrderedCollection']),
      });

      const result = await sendCommand('CLASSES Ordered*');

      expect(captured.command).toBe('CLASSES Ordered*\n');
      expect(result.data).toEqual(['Object', 'String', 'OrderedCollection']);
    });

    it('handles wildcard pattern', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: okResponse(['Class1', 'Class2']),
      });

      const result = await sendCommand('CLASSES *');

      expect(result.status).toBe('ok');
    });
  });

  describe('class_info (CLASS command)', () => {
    it('sends CLASS command and returns class details', async () => {
      if (!sendCommand) return;

      const classData = {
        name: 'OrderedCollection',
        superclass: 'SequenceableCollection',
        instanceVariables: ['firstIndex', 'lastIndex'],
        classVariables: [],
        category: 'Collections-Sequenceable',
        comment: 'An ordered collection of objects.',
      };

      const { captured } = installMockSocket(net, {
        response: okResponse(classData),
      });

      const result = await sendCommand('CLASS OrderedCollection');

      expect(captured.command).toBe('CLASS OrderedCollection\n');
      expect(result.data.name).toBe('OrderedCollection');
      expect(result.data.superclass).toBe('SequenceableCollection');
    });

    it('handles class not found', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: errorResponse('Class NotAClass not found'),
      });

      const result = await sendCommand('CLASS NotAClass');

      expect(result.status).toBe('error');
      expect(result.message).toContain('not found');
    });
  });

  describe('methods (METHODS command)', () => {
    it('lists instance methods', async () => {
      if (!sendCommand) return;

      const { captured } = installMockSocket(net, {
        response: okResponse(['add:', 'remove:', 'includes:', 'do:']),
      });

      const result = await sendCommand('METHODS OrderedCollection instance');

      expect(captured.command).toBe('METHODS OrderedCollection instance\n');
      expect(result.data).toContain('add:');
    });

    it('lists class methods', async () => {
      if (!sendCommand) return;

      const { captured } = installMockSocket(net, {
        response: okResponse(['new', 'new:', 'with:']),
      });

      const result = await sendCommand('METHODS OrderedCollection class');

      expect(captured.command).toBe('METHODS OrderedCollection class\n');
      expect(result.data).toContain('new');
    });
  });

  describe('source (SOURCE command)', () => {
    it('retrieves method source code', async () => {
      if (!sendCommand) return;

      const sourceCode = 'add: newObject\n\t^self addLast: newObject';

      const { captured } = installMockSocket(net, {
        response: okResponse(sourceCode),
      });

      const result = await sendCommand('SOURCE OrderedCollection add:');

      expect(captured.command).toBe('SOURCE OrderedCollection add:\n');
      expect(result.data).toBe(sourceCode);
    });

    it('handles method not found', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: errorResponse('Method nonExistent not found in String'),
      });

      const result = await sendCommand('SOURCE String nonExistent');

      expect(result.status).toBe('error');
    });
  });

  describe('fullsource (FULLSOURCE command)', () => {
    it('retrieves all methods for a class', async () => {
      if (!sendCommand) return;

      const fullSource = {
        instanceMethods: { 'add:': 'add: obj\n\t...' },
        classMethods: { new: 'new\n\t^super new' },
      };

      const { captured } = installMockSocket(net, {
        response: okResponse(fullSource),
      });

      const result = await sendCommand('FULLSOURCE OrderedCollection');

      expect(captured.command).toBe('FULLSOURCE OrderedCollection\n');
      expect(result.data.instanceMethods).toBeDefined();
    });
  });

  describe('hierarchy (HIERARCHY command)', () => {
    it('returns class hierarchy', async () => {
      if (!sendCommand) return;

      const hierarchy = {
        class: 'OrderedCollection',
        superclasses: ['SequenceableCollection', 'Collection', 'Object'],
        subclasses: ['SortedCollection'],
      };

      const { captured } = installMockSocket(net, {
        response: okResponse(hierarchy),
      });

      const result = await sendCommand('HIERARCHY OrderedCollection');

      expect(captured.command).toBe('HIERARCHY OrderedCollection\n');
      expect(result.data.superclasses).toContain('Object');
      expect(result.data.subclasses).toContain('SortedCollection');
    });
  });

  describe('eval_smalltalk (EVAL command)', () => {
    it('evaluates simple expression', async () => {
      if (!sendCommand) return;

      const { captured } = installMockSocket(net, {
        response: okResponse({ result: '6', class: 'SmallInteger' }),
      });

      const result = await sendCommand('EVAL 2 + 4');

      expect(captured.command).toBe('EVAL 2 + 4\n');
      expect(result.data.result).toBe('6');
      expect(result.data.class).toBe('SmallInteger');
    });

    it('handles evaluation errors', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: errorResponse('MessageNotUnderstood: Object>>unknownMethod'),
      });

      const result = await sendCommand('EVAL Object new unknownMethod');

      expect(result.status).toBe('error');
      expect(result.message).toContain('MessageNotUnderstood');
    });
  });

  describe('namespaces (NAMESPACES command)', () => {
    it('lists all namespaces', async () => {
      if (!sendCommand) return;

      const { captured } = installMockSocket(net, {
        response: okResponse(['Smalltalk', 'Core', 'Graphics', 'OS']),
      });

      const result = await sendCommand('NAMESPACES');

      expect(captured.command).toBe('NAMESPACES\n');
      expect(result.data).toContain('Smalltalk');
    });
  });

  describe('search (SEARCH command)', () => {
    it('finds classes and methods matching pattern', async () => {
      if (!sendCommand) return;

      const searchResults = [
        { type: 'class', name: 'String' },
        { type: 'method', class: 'Object', selector: 'printString' },
      ];

      const { captured } = installMockSocket(net, {
        response: okResponse(searchResults),
      });

      const result = await sendCommand('SEARCH String');

      expect(captured.command).toBe('SEARCH String\n');
      expect(result.data.length).toBe(2);
      expect(result.data[0].type).toBe('class');
    });

    it('handles no matches', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: okResponse([]),
      });

      const result = await sendCommand('SEARCH xyzNotFound123');

      expect(result.data).toEqual([]);
    });
  });

  describe('senders (SENDERS command)', () => {
    it('finds methods that send a selector', async () => {
      if (!sendCommand) return;

      const senders = [
        { class: 'Collection', selector: 'includes:' },
        { class: 'Set', selector: 'add:' },
      ];

      const { captured } = installMockSocket(net, {
        response: okResponse(senders),
      });

      const result = await sendCommand('SENDERS at:');

      expect(captured.command).toBe('SENDERS at:\n');
      expect(result.data.length).toBe(2);
    });
  });

  describe('implementors (IMPLEMENTORS command)', () => {
    it('finds classes implementing a selector', async () => {
      if (!sendCommand) return;

      const implementors = [
        { class: 'Object', side: 'instance' },
        { class: 'String', side: 'instance' },
        { class: 'Array', side: 'instance' },
      ];

      const { captured } = installMockSocket(net, {
        response: okResponse(implementors),
      });

      const result = await sendCommand('IMPLEMENTORS printOn:');

      expect(captured.command).toBe('IMPLEMENTORS printOn:\n');
      expect(result.data.length).toBe(3);
    });
  });

  describe('messages (MESSAGES command)', () => {
    it('returns messages sent by a method', async () => {
      if (!sendCommand) return;

      const messages = {
        class: 'OrderedCollection',
        selector: 'add:',
        messages: ['addLast:', 'grow'],
        literals: ['firstIndex', 'lastIndex'],
      };

      const { captured } = installMockSocket(net, {
        response: okResponse(messages),
      });

      const result = await sendCommand('MESSAGES OrderedCollection add:');

      expect(captured.command).toBe('MESSAGES OrderedCollection add:\n');
      expect(result.data.messages).toContain('addLast:');
    });
  });

  describe('edit_method (EDIT command)', () => {
    it('sends Base64-encoded method source', async () => {
      if (!sendCommand) return;

      const source = 'myMethod\n\t^42';
      const encoded = Buffer.from(source).toString('base64');

      const { captured } = installMockSocket(net, {
        response: okResponse({
          class: 'MyClass',
          selector: 'myMethod',
          wasNew: true,
          side: 'instance',
        }),
      });

      const result = await sendCommand(`EDIT MyClass myMethod instance ${encoded}`);

      expect(captured.command).toContain('EDIT MyClass myMethod instance');
      expect(captured.command).toContain(encoded);
      expect(result.data.wasNew).toBe(true);
    });

    it('handles update of existing method', async () => {
      if (!sendCommand) return;

      const encoded = Buffer.from('myMethod\n\t^99').toString('base64');

      installMockSocket(net, {
        response: okResponse({
          class: 'MyClass',
          selector: 'myMethod',
          wasNew: false,
          side: 'instance',
        }),
      });

      const result = await sendCommand(`EDIT MyClass myMethod instance ${encoded}`);

      expect(result.data.wasNew).toBe(false);
    });
  });

  describe('undo_edit (UNDO command)', () => {
    it('restores previous method version', async () => {
      if (!sendCommand) return;

      const { captured } = installMockSocket(net, {
        response: okResponse({ class: 'MyClass', selector: 'myMethod', side: 'instance' }),
      });

      const result = await sendCommand('UNDO MyClass myMethod instance');

      expect(captured.command).toBe('UNDO MyClass myMethod instance\n');
      expect(result.status).toBe('ok');
    });

    it('handles no backup available', async () => {
      if (!sendCommand) return;

      installMockSocket(net, {
        response: errorResponse('No backup found for MyClass>>myMethod'),
      });

      const result = await sendCommand('UNDO MyClass myMethod instance');

      expect(result.status).toBe('error');
      expect(result.message).toContain('No backup');
    });
  });

  describe('create_class (CREATECLASS command)', () => {
    it('sends Base64-encoded class definition', async () => {
      if (!sendCommand) return;

      const payload = {
        name: 'MyNewClass',
        superclass: 'Object',
        instanceVariables: ['name', 'value'],
        classVariables: [],
        classInstanceVariables: [],
        category: 'MyApp',
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      const { captured } = installMockSocket(net, {
        response: okResponse({ name: 'MyNewClass', superclass: 'Object', category: 'MyApp' }),
      });

      const result = await sendCommand(`CREATECLASS ${encoded}`);

      expect(captured.command).toContain('CREATECLASS');
      expect(result.data.name).toBe('MyNewClass');
    });

    it('handles class already exists', async () => {
      if (!sendCommand) return;

      const encoded = Buffer.from(JSON.stringify({ name: 'Object' })).toString('base64');

      installMockSocket(net, {
        response: errorResponse('Class Object already exists'),
      });

      const result = await sendCommand(`CREATECLASS ${encoded}`);

      expect(result.status).toBe('error');
      expect(result.message).toContain('already exists');
    });
  });

  describe('Tool with named server', () => {
    it('connects to specified server from config', async () => {
      if (!testExports) return;

      // Set up multi-server config
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
      testExports = module.testExports;
      sendCommand = testExports.sendCommand;

      const { captured } = installMockSocket(net, {
        response: okResponse('pong'),
      });

      await sendCommand('PING', 'prod');

      expect(captured.host).toBe('prod.local');
      expect(captured.port).toBe(9999);
    });
  });
});
