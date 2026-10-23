// This code runs inside QuickJS. No host functions, Node globals, or module loader are provided.
export const SCRIPT_API = String.raw`
const stringify = JSON.stringify.bind(JSON);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = value => typeof value === 'string' ? value : stringify(value) ?? '';
const tests = [], logs = [], changes = [];
const globals = Object.assign(Object.create(null), input.globals);
const collection = Object.assign(Object.create(null), input.collection);
const data = Object.assign(Object.create(null), input.data);
const dataVariables = Object.fromEntries(Object.entries(data).map(([name,value]) => [name.trim(),text(value)]));
const variableLimit = value => { if (text(value).length > 65536) throw Error('Variable values are limited to 64 KB.'); return text(value); };
const store = (values, scope) => ({
  get: name => own(values, name) ? values[name] : undefined,
  has: name => own(values, name),
  set(name, value) {
    name = String(name).trim();
    if (!name || name.length > 255 || changes.length >= 100) throw Error('Use named variables (up to 255 characters), with up to 100 changes per script.');
    if (scope === 'collection' && !input.hasCollection) throw Error('This request has no collection variable scope.');
    value = variableLimit(value); values[name] = value; changes.push({scope,name,value});
  },
  unset(name) { name = String(name).trim(); if (!name || name.length > 255 || changes.length >= 100) throw Error('Invalid variable name or change limit exceeded.'); delete values[name]; changes.push({scope,name}); },
  toObject: () => Object.assign({}, values)
});
const equal = (a,b) => {
  if (Object.is(a,b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b,key) && equal(a[key],b[key]));
};
const assert = (condition, message = 'Assertion failed.') => { if (!condition) throw Error(String(message)); };
const expect = actual => ({
  toBe: expected => assert(Object.is(actual, expected), 'Expected ' + text(expected) + ', received ' + text(actual)),
  toEqual: expected => assert(equal(actual, expected), 'Values are not deeply equal.'),
  toContain: expected => assert(typeof actual === 'string' ? actual.includes(String(expected)) : Array.isArray(actual) && actual.some(value => equal(value,expected)), 'Value does not contain the expected item.'),
  toBeTruthy: () => assert(Boolean(actual), 'Expected a truthy value.'),
  toBeDefined: () => assert(actual !== undefined, 'Expected a defined value.'),
  toBeLessThan: expected => assert(typeof actual === 'number' && actual < expected, 'Expected a smaller number.'),
  toBeGreaterThan: expected => assert(typeof actual === 'number' && actual > expected, 'Expected a larger number.')
});
const globalStore = store(globals,'global'), collectionStore = store(collection,'collection');
const rq = {
  globals: globalStore, collectionVariables: collectionStore,
  variables: {
    get: name => own(dataVariables,name) ? dataVariables[name] : own(collection,name) ? collection[name] : globalStore.get(name),
    has: name => own(dataVariables,name) || own(collection,name) || own(globals,name),
    set: (name,value) => (input.hasCollection ? collectionStore : globalStore).set(name,value),
    unset: name => (input.hasCollection ? collectionStore : globalStore).unset(name)
  },
  data: { get: name => own(data,name) ? data[name] : undefined, toObject: () => JSON.parse(stringify(data)) },
  iteration: input.iteration,
  request: input.request,
  assert, expect,
  test(name, callback) {
    if (tests.length >= 100) throw Error('Scripts support up to 100 tests.');
    name = String(name).slice(0,500);
    try { const returned = callback(); if (returned && typeof returned.then === 'function') throw Error('Test callbacks must be synchronous.'); tests.push({name,passed:true,kind:'script',phase:input.phase}); }
    catch (error) { tests.push({name,passed:false,kind:'script',phase:input.phase,error:String(error && error.message || error).slice(0,2000)}); }
  }
};
rq.request.setHeader = (name,value) => {
  name = String(name); value = String(value);
  rq.request.headers = rq.request.headers.filter(row => row.name.toLowerCase() !== name.toLowerCase());
  rq.request.headers.push({id:'script-header-' + rq.request.headers.length,enabled:true,name,value});
};
rq.request.removeHeader = name => { rq.request.headers = rq.request.headers.filter(row => row.name.toLowerCase() !== String(name).toLowerCase()); };
if (input.response) {
  rq.response = Object.assign({}, input.response, {
    text: () => input.response.body,
    json: () => { if (input.response.encoding !== 'utf8') throw Error('Binary response is not JSON.'); return JSON.parse(input.response.body); },
    header: name => input.response.headers.find(header => header.name.toLowerCase() === String(name).toLowerCase())?.value
  });
}
const console = Object.fromEntries(['log','warn','error'].map(level => [level, (...values) => {
  if (logs.length < 100) logs.push({level,message:values.map(value => { try{return text(value);}catch{return '[unserializable]';} }).join(' ').slice(0,2000),phase:input.phase});
}]));
let error;
try {
  const result = new Function('rq','console','"use strict";\n' + input.script)(rq, console);
  if (result && typeof result.then === 'function') throw Error('Scripts must be synchronous.');
} catch (reason) { error = String(reason && reason.message || reason).slice(0,2000); }
return stringify({request:rq.request,changes:error ? [] : changes,tests,logs,error});
`;
