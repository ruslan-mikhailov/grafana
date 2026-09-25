// The Tempo plugin owns this browser-only registry. Grafana reads it only while rendering;
// decrypted text must never enter a DataFrame, field display processor, or link context.
const registrySymbol = Symbol.for('grafana.tempo.protected-attribute-display.v1');
const changeEvent = 'grafana.tempo.protected-attribute-display-change';
const envelopePattern = /^enc:v1:[0-9a-f]{32}:([A-Za-z0-9_-]{22,})$/;

interface ProtectedAttributeDisplayRegistry {
  epoch: number;
  resolve(storedField: string, envelope: string): string | undefined;
}

export function getProtectedAttributeDisplayValue(fieldName: string, raw: unknown): string | undefined {
  if (!fieldName.startsWith('enc.') || fieldName.length === 4 || typeof raw !== 'string') {
    return undefined;
  }
  const match = envelopePattern.exec(raw);
  if (!match || match[0] !== raw) {
    return undefined;
  }
  const payload = match[1];
  // A SIV is at least 16 bytes (22 base64url characters). Reject noncanonical
  // lengths and unused pad bits rather than passing alternate spellings to the key.
  const remainder = payload.length % 4;
  const finalCharacter = payload[payload.length - 1];
  if (
    remainder === 1 ||
    (remainder === 2 && !/[AQgw]/.test(finalCharacter)) ||
    (remainder === 3 && !/[AEIMQUYcgkosw048]/.test(finalCharacter))
  ) {
    return undefined;
  }
  const registry = Reflect.get(globalThis, registrySymbol) as ProtectedAttributeDisplayRegistry | undefined;
  return registry?.resolve(fieldName, raw);
}

export function getProtectedAttributeDisplayEpoch(): number {
  const registry = Reflect.get(globalThis, registrySymbol) as ProtectedAttributeDisplayRegistry | undefined;
  return registry?.epoch ?? 0;
}

export function subscribeProtectedAttributeDisplay(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener(changeEvent, listener);
  return () => window.removeEventListener(changeEvent, listener);
}
