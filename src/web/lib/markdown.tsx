import DOMPurify from 'dompurify';
import { Check, Copy } from 'lucide-react';
import { marked } from 'marked';
import { memo, useRef, useState } from 'react';
import { t, useT } from '@/i18n';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c,
  );
}

marked.use({
  breaks: true,
  gfm: true,
  extensions: [
    {
      name: 'fileReference',
      level: 'inline',
      start: (src) => src.indexOf('<ref_'),
      tokenizer(src) {
        const match =
          /^<ref_(?:file|snippet)\s+file="([^"]+)"(?:\s+lines="(\d+(?:-\d+)?)")?\s*\/>/.exec(src);
        if (match) return { type: 'fileReference', raw: match[0], path: match[1], lines: match[2] };
      },
      renderer(token) {
        const path = typeof token.path === 'string' ? token.path : '';
        const lines = typeof token.lines === 'string' ? `:${token.lines}` : '';
        return `<code class="file-reference">${escapeHtml(path + lines)}</code>`;
      },
    },
  ],
  renderer: {
    code({ text, lang }) {
      const language = lang?.split(/\s+/)[0] ?? '';
      return `<div class="code-block"><div class="code-block-header"><span>${escapeHtml(language)}</span><button type="button" data-copy-code>${escapeHtml(t('common.copy'))}</button></div><pre><code>${escapeHtml(text.replace(/\n$/, ''))}</code></pre></div>`;
    },
  },
});

export const Markdown = memo(function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: link interception only; anchors inside stay keyboard-accessible
    <div
      ref={ref}
      className={`prose ${className ?? ''}`}
      onClick={(e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLButtonElement>('button[data-copy-code]');
        if (button) {
          const code = button.parentElement?.nextElementSibling?.querySelector('code');
          if (code) {
            void navigator.clipboard
              .writeText(code.textContent ?? '')
              .then(() => {
                button.textContent = t('common.copied');
                setTimeout(() => {
                  if (button.isConnected) button.textContent = t('common.copy');
                }, 1200);
              })
              .catch(() => {});
          }
          return;
        }
        const a = target.closest('a');
        if (a && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          window.open(a.href, '_blank', 'noopener');
        }
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export function CopyButton({ text, className }: { text: string; className?: string }) {
  useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={t('common.copy')}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground ${className ?? ''}`}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </button>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b px-3 py-1">
        <span className="text-xs text-muted-foreground">{lang ?? ''}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
