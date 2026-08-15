export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Null is unknown, not a mismatch: some browsers hide the original VAPID key. */
export function subscriptionUsesCurrentVapidKey(key: ArrayBuffer | null, publicKey: string): boolean {
  if (!key) return true;
  const existing = new Uint8Array(key);
  const expected = applicationServerKey(publicKey);
  return existing.byteLength === expected.byteLength && existing.every((value, index) => value === expected[index]);
}
