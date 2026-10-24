import { useEffect, useRef, useState } from 'react';
import { parseFormList, type PublicFormSummary } from '../../lib/forms';

export type RecentFormsState = { status: 'loading' | 'error' | 'ready'; forms: PublicFormSummary[] };

/** The last handful of forms Intake has a record of, newest first. */
export function useRecentForms() {
  const [state, setState] = useState<RecentFormsState>({ status: 'loading', forms: [] });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    try {
      const response = await fetch('/api/forms', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('unavailable');
      const forms = parseFormList(await response.json());
      if (!forms) throw new Error('invalid');
      if (alive.current) setState({ status: 'ready', forms });
    } catch {
      if (alive.current) setState(previous => ({ status: 'error', forms: previous.forms }));
    }
  }
  useEffect(() => { void load(); }, []);
  return { state, load };
}
