import type { AssertionOperator } from './automation.ts';

export function checkValue(value: unknown): string {
  try {
    const text = value === undefined ? 'undefined' : JSON.stringify(value);
    return text.length > 2000 ? text.slice(0, 2000) + '… (truncated)' : text;
  } catch { return '[Value too deeply nested to display]'; }
}

export function compareAssertion(actual: unknown, expected: unknown, operator: AssertionOperator): boolean {
  const equal = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  };
  if (operator === 'exists') return actual !== undefined;
  if (operator === 'notExists') return actual === undefined;
  if (operator === 'equals') return equal(actual, expected);
  if (operator === 'notEquals') return !equal(actual, expected);
  if (operator === 'contains') return typeof actual === 'string' ? actual.includes(String(expected)) : Array.isArray(actual) && actual.some(item => equal(item, expected));
  if (operator === 'isType') {
    if (!['string', 'number', 'integer', 'boolean', 'null', 'array', 'object'].includes(String(expected))) throw new Error('Expected type must be string, number, integer, boolean, null, array, or object.');
    if (expected === 'null') return actual === null;
    if (expected === 'array') return Array.isArray(actual);
    if (expected === 'object') return actual !== null && typeof actual === 'object' && !Array.isArray(actual);
    if (expected === 'integer') return typeof actual === 'number' && Number.isInteger(actual);
    return typeof actual === expected;
  }
  if (operator === 'lengthEquals') {
    if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) throw new Error('Expected length must be a non-negative integer.');
    const length = typeof actual === 'string' ? [...actual].length : Array.isArray(actual) ? actual.length : actual && typeof actual === 'object' ? Object.keys(actual).length : undefined;
    return length === expected;
  }
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (operator === 'lessThan') return actual < expected;
  if (operator === 'greaterThan') return actual > expected;
  if (operator === 'lessThanOrEqual') return actual <= expected;
  return actual >= expected;
}
