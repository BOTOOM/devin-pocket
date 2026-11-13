import QRCode from 'qrcode';

export interface QrOptions {
  tty?: boolean;
  noColor?: boolean;
  term?: string;
  ascii?: boolean;
}

export function qrMatrix(text: string): boolean[][] {
  const modules = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
  const size = modules.size + 4;
  return Array.from({ length: size }, (_, y) =>
    Array.from(
      { length: size },
      (_, x) => x >= 2 && y >= 2 && x < size - 2 && y < size - 2 && !!modules.get(y - 2, x - 2),
    ),
  );
}

export function renderTerminalQr(text: string, options: QrOptions = {}): string {
  if (!(options.tty ?? process.stdout.isTTY)) return '';
  const matrix = qrMatrix(text);
  const plain =
    options.ascii ||
    (options.noColor ?? process.env.NO_COLOR !== undefined) ||
    (options.term ?? process.env.TERM) === 'dumb';
  if (plain)
    return `${matrix.map((row) => row.map((dark) => (dark ? '██' : '  ')).join('')).join('\n')}\n`;
  const lines: string[] = [];
  for (let y = 0; y < matrix.length; y += 2) {
    lines.push(
      `${(matrix[y] ?? [])
        .map(
          (top, x) =>
            `\x1b[${top ? '38;2;0;0;0' : '38;2;255;255;255'};${matrix[y + 1]?.[x] ? '48;2;0;0;0' : '48;2;255;255;255'}m▀`,
        )
        .join('')}\x1b[0m`,
    );
  }
  return `${lines.join('\n')}\n`;
}
