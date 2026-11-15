export function generateId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  return Array.from(crypto.getRandomValues(new Uint8Array(9)), byte => alphabet[byte % alphabet.length]).join('');
}