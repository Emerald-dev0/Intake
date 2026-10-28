import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAdminQuery } from './useAdminQuery';
import { AdminApiError, adminApi, adminPost } from './api';
import type { MailDraft, MailPreview, MailRecipientList, MailSender, MailSendLog, MailSendResult, MailSegment } from './types';

/**
 * Compose a note and send it to selected accounts, one message at a time.
 *
 * The screen is deliberately shaped like a send, not a broadcast: choose people, read the exact
 * message they will receive, then confirm the number. The composer never sends anything the server
 * has not just previewed, because the send request carries the preview id it was rendered from.
 */

const EMPTY_DRAFT: MailDraft = { sender: 'system', subject: '', heading: '', body: '', buttonLabel: '', buttonUrl: '' };

const SENDERS: Array<{ value: MailSender; label: string; hint: string }> = [
  { value: 'system', label: 'Intake', hint: 'The product address. Right for account, billing and security notes.' },
  { value: 'team', label: 'The Intake Team', hint: 'An announcement from the team. Replies go to a monitored inbox.' },
  { value: 'personal', label: 'Daniel', hint: 'A personal letter. Replies land with Daniel, and he answers them.' },
];
const SUBJECT_MAX = 140;
const HEADING_MAX = 140;
const BODY_MAX = 6000;
const BUTTON_MAX = 40;
const DEFAULT_CAP = 100;
const PAGE_SIZE = 25;

const SEGMENTS: Array<{ value: '' | MailSegment; label: string }> = [
  { value: '', label: 'Everyone' },
  { value: 'verified', label: 'Verified only' },
  { value: 'unverified', label: 'Unverified only' },
];

const STARTER = 'Hi {{name}},\n\n';

function shortDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

export default function AdminMailPage() {
  const [draft, setDraft] = useState<MailDraft>(EMPTY_DRAFT);
  const [segment, setSegment] = useState<'' | MailSegment>('');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, { id: string; name: string; email: string }>>({});
  const [preview, setPreview] = useState<MailPreview | null>(null);
  const [previewSignature, setPreviewSignature] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'send' | 'select' | null>(null);
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MailSendResult | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const recipientsPath = `/api/admin/mail/recipients?page=${page}&limit=${PAGE_SIZE}${query ? `&q=${encodeURIComponent(query)}` : ''}${segment ? `&segment=${segment}` : ''}`;
  const { state: listState, refresh: refreshList } = useAdminQuery<MailRecipientList>(recipientsPath);
  const { state: historyState, refresh: refreshHistory } = useAdminQuery<MailSendLog>('/api/admin/mail/sends');

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const cap = listState.status === 'ready' ? listState.data.cap : DEFAULT_CAP;
  const overCap = selectedIds.length > cap;

  // A preview is only valid for the exact draft and recipient set it was rendered from. Anything
  // else makes the admin look again, which is the point of the preview.
  const signature = useMemo(
    () => JSON.stringify({ draft, ids: [...selectedIds].sort() }),
    [draft, selectedIds],
  );
  const fresh = preview !== null && previewSignature === signature;

  function edit(field: keyof MailDraft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(current => ({ ...current, [field]: event.target.value }));
      setFieldErrors(current => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
      setProblem(null);
      setResult(null);
    };
  }

  function toggle(recipient: { id: string; name: string; email: string }) {
    setSelected(current => {
      const next = { ...current };
      if (next[recipient.id]) delete next[recipient.id];
      else next[recipient.id] = recipient;
      return next;
    });
    setAcknowledged(false);
    setResult(null);
  }

  function selectPage() {
    if (listState.status !== 'ready') return;
    setSelected(current => {
      const next = { ...current };
      for (const item of listState.data.items) next[item.id] = { id: item.id, name: item.name, email: item.email };
      return next;
    });
    setAcknowledged(false);
    setResult(null);
  }

  // One click for "everyone verified", bounded by the same server cap: the server decides the page
  // size and the cap, and the selection is still a list of concrete ids.
  async function selectMatching() {
    setBusy('select');
    setProblem(null);
    try {
      const params = `page=1&limit=100${query ? `&q=${encodeURIComponent(query)}` : ''}${segment ? `&segment=${segment}` : ''}`;
      const data = await adminApi<MailRecipientList>(`/api/admin/mail/recipients?${params}`);
      setSelected(current => {
        const next = { ...current };
        for (const item of data.items.slice(0, data.cap)) next[item.id] = { id: item.id, name: item.name, email: item.email };
        return next;
      });
      setAcknowledged(false);
      setResult(null);
    } catch (error) {
      setProblem(describe(error, false));
    } finally {
      setBusy(null);
    }
  }

  function clearSelection() {
    setSelected({});
    setAcknowledged(false);
    setPreview(null);
    setResult(null);
    setProblem(null);
  }

  function insertToken(token: string) {
    const node = bodyRef.current;
    const snippet = `{{${token}}}`;
    if (!node) {
      setDraft(current => ({ ...current, body: `${current.body}${snippet}` }));
      return;
    }
    const start = node.selectionStart ?? draft.body.length;
    const end = node.selectionEnd ?? start;
    const body = `${draft.body.slice(0, start)}${snippet}${draft.body.slice(end)}`;
    setDraft(current => ({ ...current, body }));
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  // A refusal the server made *before* sending, and an unconfirmed send, are different claims. The
  // first is "nothing left the building"; the second means "check the Email page before retrying".
  const PRE_SEND_REFUSALS = new Set([
    'invalid_draft', 'invalid_selection', 'invalid_preview', 'recipient_cap', 'no_recipients',
    'recipient_count_changed',
  ]);

  function describe(error: unknown, sending: boolean): { title: string; message: string } {
    if (error instanceof AdminApiError) {
      if (error.status === 403) return { title: 'Not permitted', message: 'This session is no longer an allowlisted administrator.' };
      if (error.status === 401) return { title: 'Session expired', message: 'Sign in again to send mail.' };
      if (error.status === 429) return { title: 'Rate limit reached', message: 'Six sends a minute is the ceiling. Wait briefly, then send the rest.' };
      const refused = !sending || (error.code !== null && PRE_SEND_REFUSALS.has(error.code));
      return {
        title: refused ? 'Nothing was sent' : 'The send could not be confirmed',
        message: refused
          ? error.message
          : `${error.message} Some messages may have gone out — check the Email page before retrying.`,
      };
    }
    return sending
      ? { title: 'The send could not be confirmed', message: 'The admin service could not be reached. Check the Email page before retrying.' }
      : { title: 'Nothing was sent', message: 'The admin service could not be reached, so no message was composed.' };
  }

  async function runPreview() {
    if (selectedIds.length === 0) return;
    setBusy('preview');
    setProblem(null);
    setFieldErrors({});
    try {
      const response = await adminPost<MailPreview>('/api/admin/mail/preview', {
        draft,
        selection: { kind: 'ids', ids: selectedIds },
      });
      setPreview(response);
      setPreviewSignature(signature);
      setAcknowledged(false);
    } catch (error) {
      setPreview(null);
      if (error instanceof AdminApiError) setFieldErrors(error.fieldErrors);
      setProblem(describe(error, false));
    } finally {
      setBusy(null);
    }
  }

  async function runSend() {
    if (!fresh || !acknowledged || overCap) return;
    setBusy('send');
    setProblem(null);
    try {
      const response = await adminPost<MailSendResult>('/api/admin/mail/send', {
        draft,
        selection: { kind: 'ids', ids: selectedIds },
        previewId: preview.previewId,
        confirmedRecipients: preview.recipients.total,
      });
      setResult(response);
      setPreview(null);
      setPreviewSignature('');
      setAcknowledged(false);
      setSelected({});
      refreshHistory();
      refreshList();
    } catch (error) {
      // A changed recipient count is not a failure to hide: the admin has to look again.
      setProblem(describe(error, true));
      setPreview(null);
      setAcknowledged(false);
    } finally {
      setBusy(null);
    }
  }

  const items = listState.status === 'ready' ? listState.data.items : [];
  const total = listState.status === 'ready' ? listState.data.total : 0;
  const pages = listState.status === 'ready' ? Math.max(1, listState.data.totalPages) : 1;

  return <>
    <div className="admin-page-heading">
      <div>
        <span className="admin-overline">DIRECT MAIL</span>
        <h1>Write to your users</h1>
        <p>
          Pick specific accounts, read exactly what they will receive, then send. Each person gets their
          own copy with their own name in it, on its own delivery record — this is not a mailing list,
          and nothing goes out until you confirm the number of recipients.
        </p>
      </div>
      <div className="admin-heading-action">
        <span className={`admin-pill ${selectedIds.length ? 'ok' : 'muted'}`}>{selectedIds.length} selected</span>
      </div>
    </div>

    {problem && <div className="admin-state-card error" role="alert"><strong>{problem.title}</strong><p>{problem.message}</p></div>}

    {result && <section className="admin-state-card ok admin-mail-result" role="status">
      <strong>{result.sent} of {result.total} messages accepted</strong>
      <p>
        Each accepted message is its own delivery record on the Email page. Accepted means the provider
        queued it; delivery is confirmed separately.
        {result.skipped > 0 && ` ${result.skipped} skipped (suppressed or not configured).`}
        {result.failed > 0 && ` ${result.failed} failed.`}
      </p>
      <details className="admin-mail-perrecipient">
        <summary>Per-recipient outcome</summary>
        <div className="admin-table-scroll"><table className="admin-table">
          <thead><tr><th>Account</th><th>Address</th><th>Outcome</th><th>Error</th></tr></thead>
          <tbody>
            {result.results.map(row => <tr key={row.userId}>
              <td>{row.name || '—'}</td>
              <td>{row.email}</td>
              <td><span className={`admin-pill ${row.status === 'sent' ? 'ok' : row.status === 'failed' ? 'bad' : 'muted'}`}>{row.status}</span></td>
              <td>{row.errorCode ?? '—'}</td>
            </tr>)}
          </tbody>
        </table></div>
      </details>
    </section>}

    <div className="admin-mail-grid">
      <section className="admin-panel" aria-label="Compose message">
        <header className="admin-panel-header">
          <div><span className="admin-overline">THE MESSAGE</span><h2>Compose</h2><p>What you write is the whole email — no greeting is added for you. Two placeholders are understood: <code>{'{{name}}'}</code> and <code>{'{{email}}'}</code>.</p></div>
        </header>

        <div className="admin-field">
          <span>Send as</span>
          <div className="admin-mail-senders" role="radiogroup" aria-label="Send as">
            {SENDERS.map(option => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={draft.sender === option.value}
                className={`admin-mail-sender ${draft.sender === option.value ? 'selected' : ''}`}
                onClick={() => { setDraft(current => ({ ...current, sender: option.value })); setPreview(null); }}
                title={option.hint}
              >
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
          <small>Reply-to always points at a person who reads it. The address comes from the server's configured identities, and the display name comes from the matching sender identity in the mail provider's dashboard — Intake cannot set it per message.</small>
        </div>

        <div className="admin-field">
          <span>Subject · {draft.subject.length}/{SUBJECT_MAX}</span>
          <input
            value={draft.subject}
            onChange={edit('subject')}
            maxLength={SUBJECT_MAX}
            placeholder="A small change to your Intake account"
            aria-invalid={Boolean(fieldErrors.subject)}
          />
        </div>
        {fieldErrors.subject && <p className="admin-mail-error">{fieldErrors.subject}</p>}

        <div className="admin-field">
          <span>Heading in the email (optional) · {draft.heading.length}/{HEADING_MAX}</span>
          <input
            value={draft.heading}
            onChange={edit('heading')}
            maxLength={HEADING_MAX}
            placeholder="Defaults to the subject"
            aria-invalid={Boolean(fieldErrors.heading)}
          />
        </div>

        <div className="admin-field admin-mail-body">
          <span>Message · {draft.body.length}/{BODY_MAX}</span>
          <textarea
            ref={bodyRef}
            value={draft.body}
            onChange={edit('body')}
            rows={12}
            maxLength={BODY_MAX}
            placeholder={`${STARTER}A blank line starts a new paragraph.`}
            aria-invalid={Boolean(fieldErrors.body)}
          />
        </div>
        <div className="admin-mail-tokens">
          <button type="button" className="admin-button" onClick={() => insertToken('name')}>Insert {'{{name}}'}</button>
          <button type="button" className="admin-button" onClick={() => insertToken('email')}>Insert {'{{email}}'}</button>
          <small>Inserted at the cursor. Unknown placeholders are refused rather than sent literally. Blank lines become paragraphs.</small>
        </div>
        {fieldErrors.body && <p className="admin-mail-error">{fieldErrors.body}</p>}

        <div className="admin-mail-button-row">
          <div className="admin-field">
            <span>Button label (optional) · {draft.buttonLabel.length}/{BUTTON_MAX}</span>
            <input
              value={draft.buttonLabel}
              onChange={edit('buttonLabel')}
              maxLength={BUTTON_MAX}
              placeholder="Open the dashboard"
              aria-invalid={Boolean(fieldErrors.buttonLabel)}
            />
          </div>
          <div className="admin-field">
            <span>Button link · https:// or /path</span>
            <input
              value={draft.buttonUrl}
              onChange={edit('buttonUrl')}
              placeholder="/app"
              aria-invalid={Boolean(fieldErrors.buttonUrl)}
            />
          </div>
        </div>
        {(fieldErrors.buttonLabel || fieldErrors.buttonUrl) && <p className="admin-mail-error">{fieldErrors.buttonLabel ?? fieldErrors.buttonUrl}</p>}

        <div className="admin-form-actions">
          <button type="button" className="admin-button primary" onClick={() => void runPreview()} disabled={busy !== null || selectedIds.length === 0 || overCap}>
            {busy === 'preview' ? 'Rendering…' : 'Preview the email'}
          </button>
          <small>{selectedIds.length === 0 ? 'Select at least one account first.' : 'Nothing is sent by previewing.'}</small>
        </div>
      </section>

      <section className="admin-panel admin-mail-picker" aria-label="Choose recipients">
        <header className="admin-panel-header">
          <div><span className="admin-overline">RECIPIENTS</span><h2>Choose who gets it</h2><p>One cap per send: {cap} people. Select across pages, or take the first {cap} that match — the selection is always concrete accounts, never a saved segment.</p></div>
          <div><span className={`admin-pill ${overCap ? 'bad' : selectedIds.length ? 'ok' : 'muted'}`}>{selectedIds.length} / {cap}</span></div>
        </header>

        <div className="admin-filter-row">
          <div className="admin-field">
            <span>Segment</span>
            <select value={segment} onChange={event => { setSegment(event.target.value as '' | MailSegment); setPage(1); }}>
              {SEGMENTS.map(option => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <form className="admin-field search-field" onSubmit={event => { event.preventDefault(); setQuery(queryInput.trim()); setPage(1); }}>
            <span>Search name, address or id</span>
            <input value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="ada@example.com" />
          </form>
          <button type="button" className="admin-button" onClick={selectPage} disabled={items.length === 0}>Select page</button>
          <button type="button" className="admin-button" onClick={() => void selectMatching()} disabled={busy !== null || total === 0}>
            {busy === 'select' ? 'Selecting…' : `Select first ${cap} matching`}
          </button>
          <button type="button" className="admin-button" onClick={clearSelection} disabled={selectedIds.length === 0}>Clear</button>
        </div>

        {overCap && <p className="admin-mail-error">That is {selectedIds.length} people. One send is limited to {cap}, so narrow the selection.</p>}

        {listState.status === 'loading' && <div className="admin-loading" role="status"><i className="admin-spinner" />Loading accounts…</div>}
        {listState.status === 'error' && <div className="admin-state-card error" role="alert"><strong>Accounts unavailable</strong><p>{listState.message}</p><button type="button" className="admin-button" onClick={refreshList}>Retry</button></div>}
        {listState.status === 'ready' && (items.length === 0
          ? <div className="admin-empty"><strong>No accounts match.</strong><p>Change the segment or clear the search.</p></div>
          : <ul className="admin-mail-people">
            {items.map(item => {
              const checked = Boolean(selected[item.id]);
              return <li key={item.id} className={checked ? 'is-selected' : ''}>
                <label>
                  <input type="checkbox" checked={checked} onChange={() => toggle({ id: item.id, name: item.name, email: item.email })} />
                  <span className="admin-mail-person">
                    <strong>{item.name || 'No name on file'}</strong>
                    <small>{item.email}</small>
                  </span>
                  <span className={`admin-pill ${item.verified ? 'ok' : 'muted'}`}>{item.verified ? 'verified' : 'unverified'}</span>
                  <small className="admin-mail-joined">{shortDate(item.createdAt)}</small>
                </label>
              </li>;
            })}
          </ul>)}

        {listState.status === 'ready' && <div className="admin-pagination">
          <span>{total} matching account{total === 1 ? '' : 's'} · page {page} of {pages}</span>
          <div>
            <button type="button" className="admin-button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button>
            <button type="button" className="admin-button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button>
          </div>
        </div>}
      </section>
    </div>

    <section className="admin-panel admin-mail-preview-panel" aria-label="Email preview">
      <header className="admin-panel-header">
        <div>
          <span className="admin-overline">WHAT THEY WILL RECEIVE</span>
          <h2>{preview ? preview.subject : 'Nothing previewed yet'}</h2>
          <p>
            Rendered by the server from the same template the send uses.
            {preview && ` Sample rendered with ${preview.sample.name === 'there' ? 'the default greeting' : preview.sample.name + '’s'} details (${preview.sample.email}).`}
          </p>
        </div>
        <div>
          {preview && <span className={`admin-pill ${preview.recipients.overCap ? 'bad' : 'ok'}`}>
            {preview.recipients.total} recipient{preview.recipients.total === 1 ? '' : 's'}
          </span>}
        </div>
      </header>

      {!preview && <div className="admin-empty"><strong>Preview before sending.</strong><p>The send button only unlocks for a preview you have actually read.</p></div>}

      {preview && <>
        {!preview.ready && <p className="admin-mail-error">
          The send log table is missing, so sending is disabled rather than shipping unrecorded mail.
          Apply <code>db/migrations/020_admin_mail.sql</code> and reload.
        </p>}
        {preview.recipients.overCap && <p className="admin-mail-error">
          {preview.recipients.total} people match, and one send is limited to {preview.recipients.cap}. Narrow the selection and send in batches.
        </p>}
        <iframe className="admin-mail-preview" title="Email preview" sandbox="" srcDoc={preview.html} />
        <details className="admin-mail-plaintext">
          <summary>Plain-text version</summary>
          <pre>{preview.text}</pre>
        </details>
        <label className="admin-mail-ack">
          <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={!fresh || preview.recipients.overCap || !preview.ready} />
          <span>
            I have read this preview and want to send {preview.recipients.total} separate message{preview.recipients.total === 1 ? '' : 's'},
            one to each selected account.
          </span>
        </label>
        <div className="admin-form-actions">
          <button type="button" className="admin-button primary" disabled={!fresh || !acknowledged || preview.recipients.overCap || !preview.ready || busy !== null} onClick={() => void runSend()}>
            {busy === 'send' ? 'Sending…' : `Send ${preview.recipients.total} message${preview.recipients.total === 1 ? '' : 's'}`}
          </button>
          <small>Each recipient gets their own delivery row and their own provider idempotency key.</small>
        </div>
      </>}
      {preview && !fresh && <p className="admin-mail-error">The message or the selection changed since this preview. Preview again before sending.</p>}
    </section>

    <section className="admin-panel" aria-label="Recent sends">
      <header className="admin-panel-header">
        <div><span className="admin-overline">SEND LOG</span><h2>Recent composed mail</h2><p>Counts only — message bodies are never archived in the dashboard database. Per-recipient records live on the Email page.</p></div>
        <div><button type="button" className="admin-button" onClick={refreshHistory}>Refresh</button></div>
      </header>
      {historyState.status === 'loading' && <div className="admin-loading" role="status"><i className="admin-spinner" />Loading send history…</div>}
      {historyState.status === 'error' && <div className="admin-state-card error" role="alert"><strong>Send history unavailable</strong><p>{historyState.message}</p></div>}
      {historyState.status === 'ready' && !historyState.data.ready
        ? <div className="admin-state-card error" role="alert"><strong>Send log storage is not installed</strong><p>Apply <code>db/migrations/020_admin_mail.sql</code>. Until then this panel cannot tell "no mail sent" apart from "no log", so it says neither.</p></div>
        : historyState.status === 'ready' && (historyState.data.items.length === 0
        ? <div className="admin-empty"><strong>No composed mail yet.</strong><p>The first send will appear here with its counts.</p></div>
        : <div className="admin-table-scroll"><table className="admin-table">
          <thead><tr><th>Sent · UTC</th><th>Subject</th><th>Selection</th><th>Recipients</th><th>Accepted</th><th>Skipped</th><th>Failed</th></tr></thead>
          <tbody>
            {historyState.data.items.map(item => <tr key={item.id}>
              <td>{shortDate(item.createdAt)}</td>
              <td>{item.subject}</td>
              <td>{item.selectionLabel}</td>
              <td>{item.recipients}</td>
              <td>{item.sent}</td>
              <td>{item.skipped}</td>
              <td>{item.failed}</td>
            </tr>)}
          </tbody>
        </table></div>)}
    </section>
  </>;
}
