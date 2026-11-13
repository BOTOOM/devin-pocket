export function formatPairingCode(value: string): string {
  const letters = value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}
