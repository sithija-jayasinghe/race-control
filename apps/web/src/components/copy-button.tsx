import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Copies `text`, then says "Copied" for two seconds. `label` names what's copied for screen readers. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the text is selectable in the box next to this button.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label && !copied ? `Copy ${label}` : undefined}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-glass-line px-3 text-sm hover:bg-white/5"
    >
      {copied ? (
        <Check className="size-4 text-flag-green" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
