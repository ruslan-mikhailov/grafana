import {
  getProtectedAttributeDisplayEpoch,
  getProtectedAttributeKeyId,
  requestProtectedAttributeKey,
  getProtectedAttributeDisplayValue,
  subscribeProtectedAttributeDisplay,
} from './protectedAttributeDisplay';

const registrySymbol = Symbol.for('grafana.tempo.protected-attribute-display.v1');
const eventName = 'grafana.tempo.protected-attribute-display-change';
const envelope = 'enc:v1:630dcd2966c4336691125448bbb25b4f:7aUwjY5fPtHvu_dUnzcxBJc6XQ';

let originalRegistry: unknown;
beforeEach(() => {
  originalRegistry = Reflect.get(globalThis, registrySymbol);
  Reflect.deleteProperty(globalThis, registrySymbol);
});
afterEach(() => {
  if (originalRegistry === undefined) {
    Reflect.deleteProperty(globalThis, registrySymbol);
  } else {
    Reflect.set(globalThis, registrySymbol, originalRegistry);
  }
});

test('resolves only canonical envelopes on stored protected fields', () => {
  const resolve = jest.fn(() => 'abc');
  Reflect.set(globalThis, registrySymbol, { epoch: 1, resolve });

  expect(getProtectedAttributeDisplayValue('enc.password', envelope)).toBe('abc');
  expect(getProtectedAttributeDisplayValue('enc.password', `${envelope.slice(0, -1)}R`)).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('enc.password', 'enc:v1:630dcd2966c4336691125448bbb25b4f:AAAA')).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('password', envelope)).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('enc.', envelope)).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('enc.password', envelope.replace(':v1:', ':v2:'))).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('enc.password', envelope.replace('630d', '630D'))).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('enc.password', `${envelope}=`)).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('enc.password', `${envelope}\n`)).toBeUndefined();
  expect(getProtectedAttributeDisplayValue('enc.password', 42)).toBeUndefined();
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith('enc.password', envelope);
});
test('requests one eligible key UI with only the canonical envelope key ID', () => {
  const requestKey = jest.fn(() => true);
  Reflect.set(globalThis, registrySymbol, { epoch: 1, resolve: () => undefined, requestKey });
  const kid = getProtectedAttributeKeyId('enc.password', envelope);
  expect(kid).toBe('630dcd2966c4336691125448bbb25b4f');
  expect(requestProtectedAttributeKey(kid!)).toBe(true);
  expect(requestKey).toHaveBeenCalledTimes(1);
  expect(requestKey).toHaveBeenCalledWith(kid);
  expect(getProtectedAttributeKeyId('plain', envelope)).toBeUndefined();
  expect(getProtectedAttributeKeyId('enc.password', `${envelope}=`)).toBeUndefined();
  expect(requestProtectedAttributeKey(envelope)).toBe(false);
  expect(requestKey).toHaveBeenCalledTimes(1);
  Reflect.set(globalThis, registrySymbol, { epoch: 2, resolve: () => undefined });
  expect(requestProtectedAttributeKey(kid!)).toBe(false);
});

test('reports registry epochs and notifies subscribers when the key changes', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeProtectedAttributeDisplay(listener);
  try {
    expect(getProtectedAttributeDisplayEpoch()).toBe(0);
    expect(getProtectedAttributeDisplayValue('enc.password', envelope)).toBeUndefined();
    Reflect.set(globalThis, registrySymbol, { epoch: 1, resolve: () => 'abc' });
    window.dispatchEvent(new Event(eventName));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getProtectedAttributeDisplayEpoch()).toBe(1);
    Reflect.set(globalThis, registrySymbol, { epoch: 2, resolve: () => undefined });
    window.dispatchEvent(new Event(eventName));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getProtectedAttributeDisplayEpoch()).toBe(2);
    expect(getProtectedAttributeDisplayValue('enc.password', envelope)).toBeUndefined();
  } finally {
    unsubscribe();
  }
  window.dispatchEvent(new Event(eventName));
  expect(listener).toHaveBeenCalledTimes(2);
});
