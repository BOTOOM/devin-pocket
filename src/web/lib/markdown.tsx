import DOMPurify from 'dompurify';
import { Check, Copy } from 'lucide-react';
import { marked } from 'marked';
import { useMemo, useRef, useState } from 'react';
import { t, useT } from '@/i18n';

marked.setOptions({ breaks: true, gfm: true });

export function Markdown({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false }), { ADD_ATTR: ['target'] }),
    [text],
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: link interception only; anchors inside stay keyboard-accessible
    <div
      ref={ref}
      className={`prose ${className ?? ''}`}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a) {
          e.preventDefault();
          window.open(a.href, '_blank', 'noopener');
        }
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

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
