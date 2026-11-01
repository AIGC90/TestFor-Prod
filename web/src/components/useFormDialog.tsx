import { type ReactNode, useCallback, useRef, useState } from 'react';
import { EntityForm, type Field } from './EntityPage';

interface Ask {
  title: string;
  fields: Field[];
  initial?: Record<string, unknown>;
}

/**
 * Promise-based form dialog: `const values = await ask({ title, fields })` resolves with
 * the submitted values, or null when cancelled. Render `dialog` once in the page.
 */
export function useFormDialog(): [ReactNode, (opts: Ask) => Promise<Record<string, unknown> | null>] {
  const [open, setOpen] = useState<Ask | null>(null);
  const resolver = useRef<((v: Record<string, unknown> | null) => void) | null>(null);
  const ask = useCallback((opts: Ask) => {
    setOpen(opts);
    return new Promise<Record<string, unknown> | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const close = (v: Record<string, unknown> | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpen(null);
  };
  const dialog = open ? (
    <EntityForm title={open.title} fields={open.fields} initial={open.initial ?? {}} isNew onCancel={() => close(null)} onSubmit={(v) => close(v)} />
  ) : null;
  return [dialog, ask];
}
