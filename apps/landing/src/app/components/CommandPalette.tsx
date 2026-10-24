import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseFormList, parseLibraryFormList, type PublicLibraryForm } from '../../lib/forms';
import { formProviderLabel } from '../../lib/connections';
import { ProviderMark } from './ProviderBadge';

/**
 * ⌘K, and the fastest way to any form.
 *
 * Three rules shaped this:
 *
 * 1. **The server decides what is searchable.** Results come from `/api/forms/library?query=…`,
 *    which is already scoped to the signed-in user. The browser never filters a list it was not
 *    given, so the palette can never surface someone else's form.
 * 2. **It is a listbox, not a text box with a list under it.** Arrow keys move, Enter opens, Escape
 *    closes, focus returns to whatever opened it. Every result is reachable with no mouse.
 * 3. **Empty means recent, not blank.** A person who opens the palette without a query still gets
 *    their last few forms plus every destination, which is the actual job.
 */

export interface PaletteDestination {
  label: string;
  hint: string;
  to: string;
  /** Rendered as a keyboard hint on the right. */
  shortcut?: string;
}

interface Item {
  id: string;
  group: 'Forms' | 'Go to';
  label: string;
  hint: string;
  run: () => void;
  provider?: PublicLibraryForm['provider'];
}

const DEBOUNCE_MS = 160;

/**
 * `requestAnimationFrame` is not guaranteed outside a real browser (jsdom, older runtimes). Focus
 * management must still happen, so fall back to a zero-delay task instead of throwing.
 */
function nextFrame(run: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(run);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(run, 0);
  return () => clearTimeout(handle);
}

export function CommandPalette({
  open,
  onClose,
  destinations,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  destinations: PaletteDestination[];
  /** The element that opened the palette. Focus goes back here when it closes. */
  returnFocusTo: HTMLElement | null;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [forms, setForms] = useState<PublicLibraryForm[] | null>(null);
  const [formsState, setFormsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    onClose();
    // Restoring focus is part of closing, not an afterthought: a keyboard user must not be dropped
    // at the top of the document after using the palette.
    nextFrame(() => returnFocusTo?.focus?.());
  }, [onClose, returnFocusTo]);

  // Reset on every open, so a previous query never leaks into a new visit.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setForms(null);
    setFormsState('idle');
    return nextFrame(() => inputRef.current?.focus());
  }, [open]);

  // Load recent forms when opened with no query; search when there is one.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setFormsState('loading');
      void (async () => {
        try {
          const url = term ? `/api/forms/library?query=${encodeURIComponent(term)}` : '/api/forms/library';
          const response = await fetch(url, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          });
          if (response.status === 401) {
            window.location.replace('/auth/sign-in?reason=session_expired');
            return;
          }
          const body = await response.json().catch(() => null);
          const parsed = parseLibraryFormList(body) ?? parseFormList(body)?.map(form => ({
            ...form, description: null, source: 'created' as const, lastSyncedAt: null, archivedAt: null, updatedAt: form.createdAt,
          }));
          if (!parsed) throw new Error('unreadable');
          setForms(parsed);
          setFormsState('ready');
        } catch (error) {
          if (controller.signal.aborted) return;
          setForms([]);
          setFormsState('error');
          void error;
        }
      })();
    }, term ? DEBOUNCE_MS : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, query]);

  const items = useMemo<Item[]>(() => {
    const term = query.trim().toLowerCase();
    const formItems: Item[] = (forms ?? []).slice(0, 8).map(form => ({
      id: `form:${form.id}`,
      group: 'Forms',
      label: form.title,
      hint: `${formProviderLabel(form.provider)}${form.archivedAt ? ' · archived' : form.status === 'incomplete' ? ' · incomplete' : ''}`,
      provider: form.provider,
      run: () => navigate('/app/library', { state: { focusFormId: form.id } }),
    }));
    const destinationItems: Item[] = destinations
      .filter(destination => !term || `${destination.label} ${destination.hint}`.toLowerCase().includes(term))
      .map(destination => ({
        id: `go:${destination.to}`,
        group: 'Go to' as const,
        label: destination.label,
        hint: destination.shortcut ?? destination.hint,
        run: () => navigate(destination.to),
      }));
    return [...formItems, ...destinationItems];
  }, [destinations, forms, navigate, query]);

  useEffect(() => {
    if (active > items.length - 1) setActive(items.length ? 0 : 0);
  }, [active, items.length]);

  function move(delta: number) {
    if (!items.length) return;
    setActive(current => (current + delta + items.length) % items.length);
  }

  function choose(item: Item | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return; }
    if (event.key === 'Home') { event.preventDefault(); setActive(0); return; }
    if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, items.length - 1)); return; }
    if (event.key === 'Enter') { event.preventDefault(); choose(items[active]); return; }
    if (event.key === 'Tab') {
      // A palette is one control: Tab stays inside it rather than wandering into the page behind.
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    }
  }

  if (!open) return null;

  const activeItem = items[active];
  const groups: Array<{ name: Item['group']; items: Array<{ item: Item; index: number }> }> = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  });

  return (
    <div
      className="palette"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
      onKeyDown={onKeyDown}
    >
      <div className="palette__dialog" role="dialog" aria-modal="true" aria-label="Search forms and pages" ref={dialogRef}>
        <div className="palette__field">
          <span className="palette__icon" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
            aria-label="Search forms or jump to a page"
            placeholder="Search your forms, or jump to a page…"
            value={query}
            onChange={event => { setQuery(event.target.value); setActive(0); }}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="palette__esc">esc</kbd>
        </div>

        <div className="palette__results" id={listId} role="listbox" aria-label="Results">
          {formsState === 'loading' && <p className="palette__status" role="status">Searching your forms…</p>}
          {formsState === 'error' && (
            <p className="palette__status is-error" role="status">
              Your forms could not be searched just now. Pages still work.
            </p>
          )}
          {groups.map(group => (
            <div key={group.name} className="palette__group" role="group" aria-label={group.name}>
              <span className="palette__group-label">{group.name}</span>
              {group.items.map(({ item, index }) => (
                <div
                  key={item.id}
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  className={`palette__item${index === active ? ' is-active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  {item.provider && <ProviderMark provider={item.provider} />}
                  <span className="palette__label">{item.label}</span>
                  <span className="palette__hint">{item.hint}</span>
                </div>
              ))}
            </div>
          ))}
          {formsState !== 'loading' && items.length === 0 && (
            <p className="palette__status" role="status">Nothing matches “{query.trim()}”.</p>
          )}
        </div>

        <div className="palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          <span className="palette__foot-note">Only your own forms are searched.</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Binds the palette to ⌘K / Ctrl-K across the whole workspace, and to the visible search button in
 * the top bar. Kept separate from the palette component so the shortcut can be tested without the
 * network.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const isShortcut = (event.metaKey || event.ctrlKey) && key === 'k';
      if (!isShortcut) return;
      // Never steal the shortcut from a text field where the platform means something else.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.getAttribute('role') !== 'combobox') return;
      event.preventDefault();
      setOpener(document.activeElement as HTMLElement | null);
      setOpen(current => !current);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openWith = useCallback((element: HTMLElement | null) => {
    setOpener(element ?? (document.activeElement as HTMLElement | null));
    setOpen(true);
  }, []);

  return { open, setOpen, opener, openWith };
}
