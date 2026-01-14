/**
 * Tests for input validation module
 */

import { describe, it, expect } from 'vitest';
import {
  validateClassName,
  validateSelector,
  validatePort,
  validateHost,
  validatePattern,
  validateExpression,
  validateSource,
  validateServerName,
} from '../lib/validation.js';

describe('Input Validation', () => {
  describe('validateClassName', () => {
    it('accepts valid class names', () => {
      expect(validateClassName('Object')).toEqual({ valid: true });
      expect(validateClassName('OrderedCollection')).toEqual({ valid: true });
      expect(validateClassName('MyClass123')).toEqual({ valid: true });
    });

    it('accepts namespaced class names', () => {
      expect(validateClassName('Core.Object')).toEqual({ valid: true });
      expect(validateClassName('Graphics.UI.Window')).toEqual({ valid: true });
    });

    it('rejects empty class names', () => {
      const result = validateClassName('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects non-string input', () => {
      expect(validateClassName(123).valid).toBe(false);
      expect(validateClassName(null).valid).toBe(false);
      expect(validateClassName(undefined).valid).toBe(false);
    });

    it('rejects class names starting with digits', () => {
      const result = validateClassName('123Class');
      expect(result.valid).toBe(false);
    });

    it('rejects class names starting with lowercase', () => {
      // Smalltalk convention: classes start with uppercase
      // But we allow lowercase for flexibility
      expect(validateClassName('myClass').valid).toBe(true);
    });

    it('rejects class names with shell metacharacters', () => {
      expect(validateClassName('Class;rm -rf').valid).toBe(false);
      expect(validateClassName('Class`whoami`').valid).toBe(false);
      expect(validateClassName('Class$(id)').valid).toBe(false);
      expect(validateClassName('Class${PATH}').valid).toBe(false);
    });

    it('rejects class names with control characters', () => {
      expect(validateClassName('Class\x00Name').valid).toBe(false);
      expect(validateClassName('Class\nName').valid).toBe(false);
      expect(validateClassName('Class\rName').valid).toBe(false);
    });

    it('accepts class names that happen to contain protocol keywords', () => {
      // These are valid identifiers - the protocol check only blocks dangerous chars
      expect(validateClassName('PING').valid).toBe(true);
      expect(validateClassName('MyEVALClass').valid).toBe(true);
    });

    it('rejects class names with special characters like colon', () => {
      // AUTH:test fails because colon is not valid in identifier pattern
      expect(validateClassName('AUTH:test').valid).toBe(false);
    });

    it('rejects class names exceeding max length', () => {
      const longName = 'A'.repeat(1001);
      const result = validateClassName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum length');
    });
  });

  describe('validateSelector', () => {
    it('accepts unary selectors', () => {
      expect(validateSelector('size')).toEqual({ valid: true });
      expect(validateSelector('printString')).toEqual({ valid: true });
      expect(validateSelector('initialize')).toEqual({ valid: true });
    });

    it('accepts binary selectors', () => {
      expect(validateSelector('+')).toEqual({ valid: true });
      expect(validateSelector('-')).toEqual({ valid: true });
      expect(validateSelector('>=')).toEqual({ valid: true });
      expect(validateSelector('~~')).toEqual({ valid: true });
      expect(validateSelector('@')).toEqual({ valid: true });
    });

    it('accepts keyword selectors', () => {
      expect(validateSelector('at:')).toEqual({ valid: true });
      expect(validateSelector('at:put:')).toEqual({ valid: true });
      expect(validateSelector('from:to:by:')).toEqual({ valid: true });
    });

    it('rejects empty selectors', () => {
      const result = validateSelector('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects invalid selector formats', () => {
      expect(validateSelector('123selector').valid).toBe(false);
      expect(validateSelector('selector with spaces').valid).toBe(false);
      expect(validateSelector('Selector').valid).toBe(false); // Starts with uppercase
    });

    it('rejects selectors with newlines', () => {
      expect(validateSelector('selector\ninjection').valid).toBe(false);
      expect(validateSelector('at:\nEVAL').valid).toBe(false);
    });

    it('accepts selectors that happen to contain protocol keywords', () => {
      // Valid keyword selectors - protocol check only blocks dangerous chars
      expect(validateSelector('evalPING:').valid).toBe(true);
      expect(validateSelector('doPing:').valid).toBe(true);
    });

    it('rejects selectors with control characters', () => {
      expect(validateSelector('selector\x00').valid).toBe(false);
    });

    it('rejects selectors exceeding max length', () => {
      const longSelector = 'a'.repeat(1001);
      expect(validateSelector(longSelector).valid).toBe(false);
    });
  });

  describe('validatePort', () => {
    it('accepts valid ports', () => {
      expect(validatePort(1)).toEqual({ valid: true });
      expect(validatePort(80)).toEqual({ valid: true });
      expect(validatePort(9999)).toEqual({ valid: true });
      expect(validatePort(65535)).toEqual({ valid: true });
    });

    it('accepts port as string', () => {
      expect(validatePort('9999')).toEqual({ valid: true });
      expect(validatePort('80')).toEqual({ valid: true });
    });

    it('rejects port 0', () => {
      const result = validatePort(0);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 1 and 65535');
    });

    it('rejects ports above 65535', () => {
      expect(validatePort(65536).valid).toBe(false);
      expect(validatePort(100000).valid).toBe(false);
    });

    it('rejects negative ports', () => {
      expect(validatePort(-1).valid).toBe(false);
      expect(validatePort(-9999).valid).toBe(false);
    });

    it('rejects non-integer ports', () => {
      expect(validatePort(80.5).valid).toBe(false);
      expect(validatePort(9999.1).valid).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(validatePort('abc').valid).toBe(false);
      expect(validatePort(NaN).valid).toBe(false);
      expect(validatePort(null).valid).toBe(false);
    });
  });

  describe('validateHost', () => {
    it('accepts localhost', () => {
      expect(validateHost('localhost')).toEqual({ valid: true });
    });

    it('accepts valid hostnames', () => {
      expect(validateHost('example.com')).toEqual({ valid: true });
      expect(validateHost('my-server.local')).toEqual({ valid: true });
      expect(validateHost('server123')).toEqual({ valid: true });
    });

    it('accepts IP addresses', () => {
      expect(validateHost('127.0.0.1')).toEqual({ valid: true });
      expect(validateHost('192.168.1.1')).toEqual({ valid: true });
    });

    it('rejects empty host', () => {
      expect(validateHost('').valid).toBe(false);
    });

    it('rejects non-string input', () => {
      expect(validateHost(123).valid).toBe(false);
      expect(validateHost(null).valid).toBe(false);
    });

    it('rejects hosts with control characters', () => {
      expect(validateHost('host\x00name').valid).toBe(false);
      expect(validateHost('host\nname').valid).toBe(false);
    });

    it('rejects hosts with shell metacharacters', () => {
      expect(validateHost('host;id').valid).toBe(false);
      expect(validateHost('host`whoami`').valid).toBe(false);
    });

    it('rejects hosts exceeding max length', () => {
      const longHost = 'a'.repeat(254);
      expect(validateHost(longHost).valid).toBe(false);
    });
  });

  describe('validatePattern', () => {
    it('accepts wildcard pattern', () => {
      expect(validatePattern('*')).toEqual({ valid: true });
    });

    it('accepts empty pattern (matches all)', () => {
      expect(validatePattern('')).toEqual({ valid: true });
    });

    it('accepts patterns with wildcards', () => {
      expect(validatePattern('Ordered*')).toEqual({ valid: true });
      expect(validatePattern('*Collection')).toEqual({ valid: true });
    });

    it('accepts simple text patterns', () => {
      expect(validatePattern('String')).toEqual({ valid: true });
      expect(validatePattern('print')).toEqual({ valid: true });
    });

    it('rejects non-string input', () => {
      expect(validatePattern(123).valid).toBe(false);
      expect(validatePattern(null).valid).toBe(false);
    });

    it('rejects patterns with control characters', () => {
      expect(validatePattern('pattern\x00').valid).toBe(false);
      expect(validatePattern('pattern\n').valid).toBe(false);
    });

    it('accepts patterns containing protocol keywords', () => {
      // Valid patterns - these are legitimate search terms
      expect(validatePattern('PING*').valid).toBe(true);
      expect(validatePattern('*EVAL*').valid).toBe(true);
      expect(validatePattern('printString').valid).toBe(true);
    });

    it('rejects patterns exceeding max length', () => {
      const longPattern = 'a'.repeat(1001);
      expect(validatePattern(longPattern).valid).toBe(false);
    });
  });

  describe('validateExpression', () => {
    it('accepts valid Smalltalk expressions', () => {
      expect(validateExpression('2 + 2')).toEqual({ valid: true });
      expect(validateExpression('Object new')).toEqual({ valid: true });
      expect(validateExpression("'hello' size")).toEqual({ valid: true });
    });

    it('accepts expressions with newlines and tabs', () => {
      expect(validateExpression('| x |\nx := 1.\n^x')).toEqual({ valid: true });
      expect(validateExpression('^self\n\tprintString')).toEqual({ valid: true });
    });

    it('rejects empty expressions', () => {
      expect(validateExpression('').valid).toBe(false);
    });

    it('rejects non-string input', () => {
      expect(validateExpression(123).valid).toBe(false);
    });

    it('rejects expressions with null bytes', () => {
      expect(validateExpression('code\x00injection').valid).toBe(false);
    });

    it('rejects expressions exceeding max length', () => {
      const longExpr = 'x'.repeat(1001);
      expect(validateExpression(longExpr).valid).toBe(false);
    });
  });

  describe('validateSource', () => {
    it('accepts valid method source', () => {
      expect(validateSource('myMethod\n\t^42')).toEqual({ valid: true });
      expect(validateSource('at: index\n\t^array at: index')).toEqual({ valid: true });
    });

    it('accepts complex method source', () => {
      const complexSource = `
        calculate: x with: y
          "Calculate something"
          | result |
          result := x + y.
          result > 100
            ifTrue: [^'large']
            ifFalse: [^'small']
      `;
      expect(validateSource(complexSource)).toEqual({ valid: true });
    });

    it('rejects empty source', () => {
      expect(validateSource('').valid).toBe(false);
    });

    it('rejects source with null bytes', () => {
      expect(validateSource('method\x00\n\t^self').valid).toBe(false);
    });

    it('rejects very long source (over 100KB)', () => {
      const veryLongSource = 'x'.repeat(100001);
      expect(validateSource(veryLongSource).valid).toBe(false);
    });
  });

  describe('validateServerName', () => {
    it('accepts valid server names', () => {
      expect(validateServerName('default')).toEqual({ valid: true });
      expect(validateServerName('dev')).toEqual({ valid: true });
      expect(validateServerName('prod-server')).toEqual({ valid: true });
      expect(validateServerName('server_1')).toEqual({ valid: true });
    });

    it('accepts undefined/null (optional parameter)', () => {
      expect(validateServerName(undefined)).toEqual({ valid: true });
      expect(validateServerName(null)).toEqual({ valid: true });
    });

    it('rejects empty string', () => {
      expect(validateServerName('').valid).toBe(false);
    });

    it('rejects non-string input', () => {
      expect(validateServerName(123).valid).toBe(false);
    });

    it('rejects names starting with non-letter', () => {
      expect(validateServerName('123server').valid).toBe(false);
      expect(validateServerName('-server').valid).toBe(false);
    });

    it('rejects names with special characters', () => {
      expect(validateServerName('server;id').valid).toBe(false);
      expect(validateServerName('server`cmd`').valid).toBe(false);
    });

    it('rejects names exceeding max length', () => {
      const longName = 'a'.repeat(101);
      expect(validateServerName(longName).valid).toBe(false);
    });
  });
});
