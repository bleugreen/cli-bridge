/**
 * Input Validation Module
 *
 * Provides validation functions to prevent command injection and ensure
 * inputs conform to Smalltalk naming conventions.
 */

// Maximum allowed length for any input
const MAX_INPUT_LENGTH = 1000;

// Valid Smalltalk identifier pattern: starts with letter, followed by letters/digits
// Allows namespaced names like 'Core.Object'
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

// More permissive pattern that allows lowercase start (for flexibility)
const FLEXIBLE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

// Smalltalk selectors can be:
// - unary: alphabetic identifier (e.g., 'size', 'printString')
// - binary: one or two special chars (e.g., '+', '>=', '~~')
// - keyword: one or more keywords ending in ':' (e.g., 'at:', 'at:put:')
const UNARY_SELECTOR_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const BINARY_SELECTOR_PATTERN = /^[+\-*/\\~<>=@%|&?!,]+$/;
const KEYWORD_SELECTOR_PATTERN = /^([a-z][a-zA-Z0-9]*:)+$/;

// Characters that could be used for command injection
const DANGEROUS_CHARS = /[\x00-\x1f\x7f`${}]/;

// Protocol command keywords that should never appear in user input
const PROTOCOL_COMMANDS = [
  'AUTH:',
  'PING',
  'CLASSES',
  'CLASS',
  'METHODS',
  'SOURCE',
  'FULLSOURCE',
  'HIERARCHY',
  'EVAL',
  'NAMESPACES',
  'SEARCH',
  'SENDERS',
  'IMPLEMENTORS',
  'MESSAGES',
  'EDIT',
  'UNDO',
  'CREATECLASS',
];

/**
 * Validation result object
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the input is valid
 * @property {string} [error] - Error message if invalid
 */

/**
 * Validate a Smalltalk class name
 * @param {string} name - The class name to validate
 * @returns {ValidationResult}
 */
export function validateClassName(name) {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Class name must be a string' };
  }

  if (name.length === 0) {
    return { valid: false, error: 'Class name cannot be empty' };
  }

  if (name.length > MAX_INPUT_LENGTH) {
    return { valid: false, error: `Class name exceeds maximum length of ${MAX_INPUT_LENGTH}` };
  }

  if (DANGEROUS_CHARS.test(name)) {
    return { valid: false, error: 'Class name contains invalid characters' };
  }

  if (!IDENTIFIER_PATTERN.test(name)) {
    return {
      valid: false,
      error: 'Class name must start with a letter and contain only letters, digits, or dots',
    };
  }

  // Valid identifiers that pass the pattern check are safe - they can't contain
  // spaces, newlines, or special characters that would enable command injection.
  // No need to check for protocol command substrings within valid identifiers.

  return { valid: true };
}

/**
 * Validate a Smalltalk method selector
 * @param {string} selector - The selector to validate
 * @returns {ValidationResult}
 */
export function validateSelector(selector) {
  if (typeof selector !== 'string') {
    return { valid: false, error: 'Selector must be a string' };
  }

  if (selector.length === 0) {
    return { valid: false, error: 'Selector cannot be empty' };
  }

  if (selector.length > MAX_INPUT_LENGTH) {
    return { valid: false, error: `Selector exceeds maximum length of ${MAX_INPUT_LENGTH}` };
  }

  if (DANGEROUS_CHARS.test(selector)) {
    return { valid: false, error: 'Selector contains invalid characters' };
  }

  // Check if it's a valid selector format
  const isUnary = UNARY_SELECTOR_PATTERN.test(selector);
  const isBinary = BINARY_SELECTOR_PATTERN.test(selector);
  const isKeyword = KEYWORD_SELECTOR_PATTERN.test(selector);

  if (!isUnary && !isBinary && !isKeyword) {
    return {
      valid: false,
      error:
        'Invalid selector format. Must be unary (e.g., size), binary (e.g., +), or keyword (e.g., at:put:)',
    };
  }

  // Valid selectors that pass the pattern check are safe - they can't contain
  // spaces, newlines, or special characters that would enable command injection.

  return { valid: true };
}

/**
 * Validate a port number
 * @param {number|string} port - The port to validate
 * @returns {ValidationResult}
 */
export function validatePort(port) {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  if (typeof portNum !== 'number' || isNaN(portNum)) {
    return { valid: false, error: 'Port must be a number' };
  }

  if (!Number.isInteger(portNum)) {
    return { valid: false, error: 'Port must be an integer' };
  }

  if (portNum < 1 || portNum > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }

  return { valid: true };
}

/**
 * Validate a hostname or IP address
 * @param {string} host - The host to validate
 * @returns {ValidationResult}
 */
export function validateHost(host) {
  if (typeof host !== 'string') {
    return { valid: false, error: 'Host must be a string' };
  }

  if (host.length === 0) {
    return { valid: false, error: 'Host cannot be empty' };
  }

  if (host.length > 253) {
    return { valid: false, error: 'Host exceeds maximum length' };
  }

  if (DANGEROUS_CHARS.test(host)) {
    return { valid: false, error: 'Host contains invalid characters' };
  }

  // Basic hostname validation (allows localhost, IP addresses, domain names)
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$/;
  if (!hostnamePattern.test(host) && host !== 'localhost') {
    return { valid: false, error: 'Invalid hostname format' };
  }

  return { valid: true };
}

/**
 * Sanitize a search pattern by validating it doesn't contain dangerous characters
 * @param {string} pattern - The pattern to sanitize
 * @returns {ValidationResult}
 */
export function validatePattern(pattern) {
  if (typeof pattern !== 'string') {
    return { valid: false, error: 'Pattern must be a string' };
  }

  if (pattern.length > MAX_INPUT_LENGTH) {
    return { valid: false, error: `Pattern exceeds maximum length of ${MAX_INPUT_LENGTH}` };
  }

  // Allow empty pattern (matches all)
  if (pattern.length === 0 || pattern === '*') {
    return { valid: true };
  }

  if (DANGEROUS_CHARS.test(pattern)) {
    return { valid: false, error: 'Pattern contains invalid characters' };
  }

  // Patterns that pass the dangerous chars check are safe - they can't contain
  // newlines or control characters that would enable command injection.

  return { valid: true };
}

/**
 * Validate a complete Smalltalk expression for eval
 * This is intentionally permissive since eval is designed to run arbitrary code
 * @param {string} expression - The expression to validate
 * @returns {ValidationResult}
 */
export function validateExpression(expression) {
  if (typeof expression !== 'string') {
    return { valid: false, error: 'Expression must be a string' };
  }

  if (expression.length === 0) {
    return { valid: false, error: 'Expression cannot be empty' };
  }

  if (expression.length > MAX_INPUT_LENGTH) {
    return { valid: false, error: `Expression exceeds maximum length of ${MAX_INPUT_LENGTH}` };
  }

  // Check for control characters (except newline and tab which are valid in code)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(expression)) {
    return { valid: false, error: 'Expression contains invalid control characters' };
  }

  return { valid: true };
}

/**
 * Validate method source code
 * @param {string} source - The source code to validate
 * @returns {ValidationResult}
 */
export function validateSource(source) {
  if (typeof source !== 'string') {
    return { valid: false, error: 'Source must be a string' };
  }

  if (source.length === 0) {
    return { valid: false, error: 'Source cannot be empty' };
  }

  // Source can be quite long for complex methods
  const MAX_SOURCE_LENGTH = 100000;
  if (source.length > MAX_SOURCE_LENGTH) {
    return { valid: false, error: `Source exceeds maximum length of ${MAX_SOURCE_LENGTH}` };
  }

  // Check for null bytes which could cause issues
  if (source.includes('\x00')) {
    return { valid: false, error: 'Source contains null bytes' };
  }

  return { valid: true };
}

/**
 * Validate an image/server name from config
 * @param {string} name - The server name to validate
 * @returns {ValidationResult}
 */
export function validateServerName(name) {
  if (name === undefined || name === null) {
    return { valid: true }; // Optional parameter, will use default
  }

  if (typeof name !== 'string') {
    return { valid: false, error: 'Server name must be a string' };
  }

  if (name.length === 0) {
    return { valid: false, error: 'Server name cannot be empty string' };
  }

  if (name.length > 100) {
    return { valid: false, error: 'Server name exceeds maximum length' };
  }

  if (DANGEROUS_CHARS.test(name)) {
    return { valid: false, error: 'Server name contains invalid characters' };
  }

  // Server names should be simple identifiers
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    return {
      valid: false,
      error: 'Server name must start with a letter and contain only letters, digits, underscores, or hyphens',
    };
  }

  return { valid: true };
}
