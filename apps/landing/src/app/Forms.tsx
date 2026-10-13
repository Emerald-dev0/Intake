import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import {
  describeFailure, parseFormFailure, parseFormList,
  type CreateFormResult, type FormFailure, type FormStage, type PublicFormSummary,
} from '../lib/forms';
import { parseConfirmedResponse, parseDraftLoad, parseInterpretResponse, type PublicDraft } from '../lib/drafts';
import type { PublicProvider } from '../lib/connections';
import type { ProviderLoad } from './Connections';
import { FormEditWorkspace } from './FormEditWorkspace';
import { FormLibrary } from './FormLibrary';
import { useCredits } from './hooks/useCredits';
import { createOperationTracker } from '../lib/operation-id';
import { insufficientCreditsMessage, isInsufficientCredits, type PublicOperationCost } from '../lib/credits';
import { CreditCostPreview, OperationCostReceipt } from './components/CreditCostPreview';

type Busy = 'loading' | 'interpreting' | 'revising' | 'creating' | 'cancelling' | null;
export type RecentFormsState = { status: 'loading' | 'error' | 'ready'; forms: PublicFormSummary[] };
type Recent = RecentFormsState;
type Pending = { mode: 'new' | 'revise'; request: string; question: string; answers: string };
/** Conversational thread entries. Interactive content (proposals, results) renders from live state;
    history entries carry just enough snapshot to read as a transcript. */
type ThreadEntry =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'intake'; kind: 'text'; text: string }
  | { id: number; role: 'intake'; kind: 'proposal'; draftId: string; version: number; title: string; questions: number }
  | { id: number; role: 'intake'; kind: 'result'; result: CreateFormResult }
  | { id: number; role: 'intake'; kind: 'failure'; failure: FormFailure; draftId: string | null };
const greetingEntry = (): ThreadEntry => ({ id: 0, role: 'intake', kind: 'text', text: 'Hi, I’m Intake. Describe the form you need — I’ll plan the questions, you review, and nothing reaches Google until you say create.' });
/** pushEntry takes the same shapes minus the auto-assigned id. Omit does not distribute over the
    union, so the input union is spelled out. */
type ThreadEntryInput =
  | { role: 'user'; text: string }
  | { role: 'intake'; kind: 'text'; text: string }
  | { role: 'intake'; kind: 'proposal'; draftId: string; version: number; title: string; questions: number }
  | { role: 'intake'; kind: 'result'; result: CreateFormResult }
  | { role: 'intake'; kind: 'failure'; failure: FormFailure; draftId: string | null };
const STORAGE_KEY = 'intake:current-form-draft'; // only an opaque id, never the specification or chat text
const EXAMPLE = 'Create a registration form for my final-year project. Ask for full name, email, phone number, department, and whether they need accommodation. If they do, ask what type of accommodation they need.';
const MICROSOFT_REASON = 'Microsoft Forms creation is not available yet; Microsoft does not publish a supported creation API.';
const NETWORK_FAILURE: FormFailure = {
  error: 'Intake could not confirm the result. A Google Form may exist. Check your draft status, Recent forms and Google Forms before starting over. This draft will not be sent again if creation started.',
  code: 'internal_error', requestId: '', outcome: 'unknown', retryable: false,
};
const STAGE_LABEL: Partial<Record<FormStage, string>> = {
  add_questions: 'adding the questions', configure_logic: 'setting up conditional logic', publish: 'publishing',
};
const TYPE_LABEL: Record<string, string> = {
  short_text: 'Short answer', long_text: 'Paragraph', email: 'Email · short answer',
  multiple_choice: 'Multiple choice', dropdown: 'Dropdown', checkboxes: 'Checkboxes',
};

function savedId(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function remember(id: string | null): void {
  try { if (id) sessionStorage.setItem(STORAGE_KEY, id); else sessionStorage.removeItem(STORAGE_KEY); } catch { /* session-only fallback */ }
}
function useAlive() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}

export function useRecentForms() {
  const [state, setState] = useState<Recent>({ status: 'loading', forms: [] });
  const alive = useAlive();
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

function FormLink({ href, primary, children }: { href: string; primary?: boolean; children: string }) {
  return <a className={`btn ${primary ? 'btn-accent' : 'btn-ghost'} btn-sm`} href={href} target="_blank" rel="noreferrer">{children} <span aria-hidden>↗</span></a>;
}

function connectionLine(google: PublicProvider | undefined): string {
  if (!google) return 'Not connected';
  if (google.status === 'connected') return `Connected${google.accountEmail ? ` as ${google.accountEmail}` : ''}`;
  if (google.status === 'expired') return 'Expired';
  if (google.status === 'reauthorization_required') return 'Reconnect required';
  if (!google.configured) return 'Setup required';
  return 'Not connected';
}

async function post(path: string, data: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json().catch(() => null) as unknown };
}

export function Forms({ providers, reloadProviders }: { providers: ProviderLoad; reloadProviders: () => void }) {
  const location = useLocation();
  const locationState = location.state as { initialPrompt?: unknown; mode?: unknown; initialRecordId?: unknown } | null;
  const initialPrompt = locationState?.initialPrompt;
  const [prompt, setPrompt] = useState(typeof initialPrompt === 'string' && initialPrompt.length <= 3000 ? initialPrompt : '');
  const [pending, setPending] = useState<Pending | null>(null);
  const [thread, setThread] = useState<ThreadEntry[]>([greetingEntry()]);
  const threadSeq = useRef(1);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const seededDraftRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<PublicDraft | null>(null);
  const [draftId, setDraftId] = useState(savedId);
  const [busy, setBusy] = useState<Busy>(draftId ? 'loading' : null);
  const busyRef = useRef(false); // guard two click handlers before React renders the disabled state
  const [, setFailure] = useState<FormFailure | null>(null);
  const [, setUnsupported] = useState('');
  const [, setResult] = useState<CreateFormResult | null>(null);
  const [operationCost, setOperationCost] = useState<PublicOperationCost | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'create' | 'edit' | 'library'>(
    locationState?.mode === 'edit' ? 'edit' : locationState?.mode === 'library' ? 'library' : 'create'
  );
  const [selectedEditRecordId, setSelectedEditRecordId] = useState<string | undefined>(
    typeof locationState?.initialRecordId === 'string' ? locationState.initialRecordId : undefined
  );
  const recent = useRecentForms();
  const alive = useAlive();
  const credits = useCredits();
  function pushEntry(entry: ThreadEntryInput) {
    const id = threadSeq.current++;
    setThread(previous => [...previous, { ...entry, id } as ThreadEntry]);
  }
  useEffect(() => {
    try { threadEndRef.current?.scrollIntoView?.({ block: 'end' }); } catch { /* headless or older engines */ }
  }, [thread, busy]);
  // Stable idempotency keys for AI operations: one key per distinct submission.
  const operations = useRef(createOperationTracker()).current;
  const google = providers.providers?.find(provider => provider.id === 'google');
  const costCredits = credits.state.status === 'ready' ? credits.state.credits : null;
  const costGuide = credits.state.status === 'ready' ? credits.state.costGuide : null;

  async function loadDraft(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('loading');
    setOperationCost(null);
    try {
      const response = await fetch(`/api/forms/draft/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      const parsed = parseDraftLoad(response.status, await response.json().catch(() => null));
      if (!alive.current) return;
      if ('draft' in parsed) {
        setDraft(parsed.draft);
        setResult(parsed.draft.result);
        setFailure(null);
        if (seededDraftRef.current !== parsed.draft.id) {
          seededDraftRef.current = parsed.draft.id;
          pushEntry({ role: 'intake', kind: 'text', text: 'Welcome back — here’s where you left off.' });
          pushEntry({ role: 'intake', kind: 'proposal', draftId: parsed.draft.id, version: parsed.draft.version, title: parsed.draft.specification.title, questions: parsed.draft.specification.questions.length });
          if (parsed.draft.result) pushEntry({ role: 'intake', kind: 'result', result: parsed.draft.result });
        }
      } else if (parsed.failure.code === 'draft_not_found') {
        remember(null);
        setDraftId(null);
        setDraft(null);
        setFailure(null);
      } else setFailure(parsed.failure);
    } catch {
      if (alive.current) setFailure({ error: 'Could not load your draft. Nothing was changed. Try checking its status again.', code: 'storage_unavailable', requestId: '', outcome: 'not_created' });
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }
  useEffect(() => { if (draftId) void loadDraft(draftId); }, []);

  async function interpret(mode: 'new' | 'revise', request: string, clarification?: string) {
    if (busyRef.current || (mode === 'revise' && (!draft || draft.status !== 'ready'))) return;
    busyRef.current = true;
    setBusy(mode === 'new' ? 'interpreting' : 'revising');
    setFailure(null);
    setUnsupported('');
    setOperationCost(null);
    const signature = [mode, mode === 'revise' ? `${draft?.id ?? ''}:${draft?.version ?? ''}` : '', request, clarification ?? ''].join('|');
    // One logical operation, one idempotency key: a retry of this exact submission is never charged twice.
    const operationId = operations.id(signature);
    try {
      const { status, body } = await post(mode === 'new' ? '/api/forms/interpret' : '/api/forms/revise',
        mode === 'new' ? { provider: 'google', request, operationId, ...(clarification ? { clarification } : {}) }
          : { draftId: draft!.id, version: draft!.version, request, operationId, ...(clarification ? { clarification } : {}) });
      if (!alive.current) return;
      operations.settle();
      credits.note(body);
      const parsed = parseInterpretResponse(status, body);
      setOperationCost(parsed.status === 'error' ? null : parsed.operationCost ?? null);
      if (parsed.status === 'ready') {
        setDraft(parsed.draft);
        setDraftId(parsed.draft.id);
        remember(parsed.draft.id);
        setResult(null);
        setPending(null);
        pushEntry({ role: 'intake', kind: 'proposal', draftId: parsed.draft.id, version: parsed.draft.version, title: parsed.draft.specification.title, questions: parsed.draft.specification.questions.length });
      } else if (parsed.status === 'needs_clarification') {
        setPending({ mode, request, question: parsed.question, answers: clarification ?? '' });
        pushEntry({ role: 'intake', kind: 'text', text: parsed.question });
      } else if (parsed.status === 'unsupported') {
        setPending(null);
        setUnsupported(parsed.explanation);
        pushEntry({ role: 'intake', kind: 'text', text: parsed.explanation });
      } else {
        const outOfCredits = isInsufficientCredits(parsed.failure.code);
        const failure = outOfCredits ? { ...parsed.failure, error: insufficientCreditsMessage(credits.state.credits) } : parsed.failure;
        setFailure(failure);
        pushEntry({ role: 'intake', kind: 'failure', failure, draftId: draft?.id ?? draftId });
        if (outOfCredits) credits.reload();
      }
    } catch {
      // The key is deliberately kept: if the server did process this submission, the retry cannot charge twice.
      if (alive.current) setFailure({ error: 'Intake could not confirm the interpretation result. No Google Form was created by this step. If you were revising, check the draft status before trying again.', code: 'model_unavailable', requestId: '', outcome: 'not_created', retryable: true });
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  function submitDescription(text: string) {
    pushEntry({ role: 'user', text });
    setPrompt('');
    void interpret('new', text);
  }
  function submitRevision(text: string) {
    pushEntry({ role: 'user', text });
    setPrompt('');
    void interpret('revise', text);
  }
  function submitAnswer(text: string) {
    if (!pending) return;
    const combined = pending.answers ? `${pending.answers}\nFurther clarification: ${text}` : text;
    if (combined.length > 1000) {
      const failure = { error: 'The clarification is too long. Shorten your answer to continue.', code: 'invalid_request', requestId: '', outcome: 'not_created' } as FormFailure;
      setFailure(failure);
      pushEntry({ role: 'intake', kind: 'failure', failure, draftId: draft?.id ?? draftId });
      return;
    }
    pushEntry({ role: 'user', text });
    setPrompt('');
    void interpret(pending.mode, pending.request, combined);
  }
  /** One composer routes by conversation state: answer a question, revise a draft, or start fresh. */
  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy !== null) return;
    if (pending) submitAnswer(text);
    else if (finished) {
      // A completed form stays in history; the new request starts a clean thread.
      reset();
      submitDescription(text);
    }
    else if (draft && draft.status === 'ready') submitRevision(text);
    else submitDescription(text);
  }

  async function confirm() {
    if (busyRef.current || !draft || draft.status !== 'ready') return;
    busyRef.current = true;
    setBusy('creating');
    setFailure(null);
    setResult(null);
    try {
      const { status, body } = await post('/api/forms/confirm', { draftId: draft.id, version: draft.version, confirm: true });
      if (!alive.current) return;
      const parsed = parseConfirmedResponse(status, body);
      setResult(parsed.result);
      pushEntry({ role: 'intake', kind: 'result', result: parsed.result });
      if (parsed.draft) setDraft(parsed.draft);
      else if (parsed.result.ok || !['not_created'].includes(parsed.result.failure.outcome ?? 'unknown')) {
        // No readable status: fail closed until a GET confirms the draft is still ready.
        setDraft(previous => previous && { ...previous, status: 'creating' });
      }
      if (parsed.result.ok || (!parsed.result.ok && parsed.result.failure.outcome !== 'not_created')) void recent.load();
      if (!parsed.result.ok && (parsed.result.failure.code === 'provider_not_connected' || parsed.result.failure.code === 'provider_reauthorization_required')) void reloadProviders();
    } catch {
      if (alive.current) {
        setResult({ ok: false, failure: NETWORK_FAILURE });
        setDraft(previous => previous && { ...previous, status: 'creating' });
        void recent.load();
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function cancel() {
    if (busyRef.current || !draft || draft.status !== 'ready') return;
    busyRef.current = true;
    setBusy('cancelling');
    try {
      const response = await fetch(`/api/forms/draft/${encodeURIComponent(draft.id)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!alive.current) return;
      if (!response.ok) {
        const rejected = parseFormFailure(response.status, await response.json().catch(() => null));
        setFailure(rejected);
        if (rejected.outcome !== 'not_created') setDraft(previous => previous && { ...previous, status: 'creating' });
        return;
      }
      reset();
      pushEntry({ role: 'intake', kind: 'text', text: 'Draft discarded. Describe your next form whenever you’re ready.' });
    } catch {
      if (alive.current) {
        setFailure({ error: 'Could not confirm that the draft was discarded. Check its status before continuing.', code: 'storage_unavailable', requestId: '', outcome: 'unknown' });
        setDraft(previous => previous && { ...previous, status: 'creating' });
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  function reset() {
    remember(null);
    setDraftId(null);
    setDraft(null);
    setResult(null);
    setOperationCost(null);
    setFailure(null);
    setUnsupported('');
    setPending(null);
    setPrompt('');
    seededDraftRef.current = null;
    setThread([greetingEntry()]);
  }

  const notice = google && google.status !== 'connected'
    ? !google.configured && google.status === 'not_connected'
      ? `Google OAuth is not configured on this server. An operator must set ${google.setupEnv.join(' and ')} before you can connect.`
      : google.status === 'not_connected'
        ? 'Connect Google separately from your Intake sign-in before you create a form.'
        : 'Your Google authorization needs renewing before you can create a form.'
    : null;
  const googleLine = !providers.providers
    ? providers.status === 'error' ? 'Connection status could not be loaded. Intake will verify it when you create.' : 'Checking connection…'
    : connectionLine(google);
  const blocked = draft?.status === 'creating' || draft?.status === 'blocked';
  const finished = draft?.status === 'created';
  const typingText = busy === 'interpreting'
    ? 'Intake is planning the questions. No form is being created yet.'
    : busy === 'revising'
      ? 'Updating the draft only. Google has not been contacted.'
      : busy === 'creating'
        ? 'Google is building your form. This can take several seconds. Keep this page open.'
        : null;
  const composerPlaceholder = pending
    ? 'Answer Intake’s question…'
    : draft && draft.status === 'ready'
      ? 'What would you change? — e.g. make email optional, then move phone number below it.'
      : 'Describe the form you need…';
  const composerAction = pending ? 'Continue →' : draft && draft.status === 'ready' ? 'Send change →' : 'Send →';
  const composerLabel = pending ? 'Answer Intake’s question' : draft && draft.status === 'ready' ? 'Request a change to the draft' : 'Describe the form you need';
  const composerHint = pending
    ? 'Your answer goes back with the original request.'
    : draft && draft.status === 'ready'
      ? 'Anything you send now revises this draft. Nothing reaches Google until you create.'
      : 'A clear first draft is enough. You can make changes before anything is created.';
  function renderEntry(entry: ThreadEntry) {
    if (entry.role === 'user') return <div key={entry.id} className="msg msg-user">{entry.text}</div>;
    if (entry.kind === 'text') return <div key={entry.id} className="msg msg-intake">{entry.text}</div>;
    if (entry.kind === 'failure') {
      return <div key={entry.id} className="msg msg-intake msg-wide"><FailureNotice failure={entry.failure} onReload={entry.draftId ? () => void loadDraft(entry.draftId as string) : undefined} /></div>;
    }
    if (entry.kind === 'result') {
      return <div key={entry.id} className="msg msg-intake msg-wide"><Outcome result={entry.result} /></div>;
    }
    const live = draft?.id === entry.draftId && draft?.version === entry.version && draft?.status === 'ready';
    if (!live || !draft) {
      return <div key={entry.id} className="msg msg-intake">Proposed “{entry.title}” — {entry.questions} {entry.questions === 1 ? 'question' : 'questions'} (superseded).</div>;
    }
    return <div key={entry.id} className="msg msg-intake msg-wide">
      <Review draft={draft} operationCost={operationCost} />
      <div className="draft-review-actions">
        <button type="button" className="btn btn-accent" onClick={() => void confirm()} disabled={busy !== null}>{busy === 'creating' ? 'Creating your form…' : 'Create form →'}</button>
        <button type="button" className="draft-cancel" onClick={() => void cancel()} disabled={busy !== null}>{busy === 'cancelling' ? 'Discarding…' : 'Cancel'}</button>
      </div>
      <p className="forms-help">Nothing has been sent to Google yet. Creating requires your confirmation, and this draft can only be submitted once.</p>
    </div>;
  }
  const workspaceSwitch = <nav className="forms-mode-switch" aria-label="Form workflow">
    <button type="button" className={workspaceMode === 'create' ? 'selected' : ''} aria-current={workspaceMode === 'create' ? 'page' : undefined} onClick={() => setWorkspaceMode('create')}>Create a new form</button>
    <button type="button" className={workspaceMode === 'edit' ? 'selected' : ''} aria-current={workspaceMode === 'edit' ? 'page' : undefined} onClick={() => setWorkspaceMode('edit')}>Edit an existing form</button>
    <button type="button" className={workspaceMode === 'library' ? 'selected' : ''} aria-current={workspaceMode === 'library' ? 'page' : undefined} onClick={() => setWorkspaceMode('library')}>Form library</button>
  </nav>;
  if (workspaceMode === 'library') return <>
    {workspaceSwitch}
    <FormLibrary
      providers={providers}
      reloadProviders={reloadProviders}
      initialForms={recent.state.forms}
      onSelectMode={(mode, formRecordId) => {
        if (formRecordId) setSelectedEditRecordId(formRecordId);
        setWorkspaceMode(mode);
      }}
    />
  </>;
  if (workspaceMode === 'edit') return <>
    {workspaceSwitch}
    <FormEditWorkspace
      providers={providers}
      reloadProviders={reloadProviders}
      forms={recent.state.forms}
      formsStatus={recent.state.status}
      reloadForms={recent.load}
      initialRecordId={selectedEditRecordId}
    />
  </>;

  return <>
    {workspaceSwitch}
    <div className="page-heading draft-heading">
      <div className="eyebrow">04 / CREATE A FORM</div>
      <h1>Describe it.<br /><em>Make it real.</em></h1>
      <div className="heading-description">Tell Intake what you need to collect. Review what it understood, then choose when to create a real Google Form in your account.</div>
    </div>

    <section className="draft-provider" aria-label="Form provider"><span className="provider-symbol" aria-hidden>G</span><div><strong>Google Forms</strong><small>{googleLine}</small></div><span className="draft-provider-note">FORMS LIVE IN YOUR GOOGLE ACCOUNT</span></section>
    {notice && <div className="form-banner warn draft-notice" role="status"><p>{notice}</p><a href="/app/connections" className="btn btn-ghost btn-sm">View connections →</a></div>}
    {!draft && !draftId && <CreditCostPreview mode="create" guide={costGuide} credits={costCredits} />}
    {draft?.status === 'ready' && <CreditCostPreview mode="revise" guide={costGuide} credits={costCredits} />}

    {busy === 'loading' && <div className="forms-panel draft-loading" role="status"><span className="spin" /> Checking your draft…</div>}
    {draftId && !draft && busy !== 'loading' && <div className="form-banner warn" role="alert"><p>We couldn’t open your saved draft yet.</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadDraft(draftId)}>Check draft status</button></div>}

    <section className="thread" aria-label="Conversation with Intake">
      {thread.map(entry => renderEntry(entry))}
      {typingText && <div className="msg msg-intake msg-typing" role="status"><span className="spin sm" aria-hidden /> {typingText}</div>}
      <div ref={threadEndRef} />
    </section>
    <OperationCostReceipt receipt={operationCost} />
    <form className="thread-composer" onSubmit={submitComposer} aria-busy={busy !== null}>
      <label className="sr-only" htmlFor="form-request">{composerLabel}</label>
      <textarea id="form-request" className="draft-input" placeholder={composerPlaceholder} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={3000} required disabled={busy !== null} />
      <div className="draft-input-foot"><span>{composerHint}</span><span>{prompt.length} / 3000</span></div>
      <div className="forms-actions">
        <button className="btn btn-accent" type="submit" disabled={busy !== null || !prompt.trim()}>{busy !== null ? 'Working…' : composerAction}</button>
        {pending && <button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => setPending(null)}>Dismiss question</button>}
      </div>
    </form>
    {!draft && thread.length <= 1 && <div className="draft-example"><span>NEED A STARTING POINT?</span><button type="button" onClick={() => setPrompt(EXAMPLE)} disabled={busy !== null}>Use a registration example ↗</button></div>}
    {finished && <button className="btn btn-ghost draft-start-again" type="button" onClick={reset}>Start another form →</button>}

    {blocked && draft && <div className="form-banner warn draft-feedback" role="alert"><strong>Do not create this draft again.</strong><p>{draft.status === 'creating' ? 'Creation was started, but Intake has not confirmed its outcome. It may still be running. Check Recent forms and Google Forms before starting a new draft.' : 'The creation attempt had a partial or uncertain outcome. Check the result and Google Forms; Intake will not submit this draft again.'}</p><div className="draft-recovery-actions"><button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => void loadDraft(draft.id)}>Check draft status</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={reset}>Start a different form after checking Google →</button></div></div>}

    <section className="forms-recent" aria-labelledby="recent-forms-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 id="recent-forms-title" className="forms-legend" style={{ margin: 0 }}>RECENT FORMS</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWorkspaceMode('library')}>Open Form Library →</button>
      </div>
      {recent.state.status === 'loading' && <p className="fine-print" role="status">Loading your forms…</p>}
      {recent.state.status === 'error' && <div className="form-banner bad" role="alert"><p>Intake couldn’t load your recent forms. This does not mean they are gone.</p><button className="btn btn-ghost btn-sm" type="button" onClick={() => void recent.load()}>Try again</button></div>}
      {recent.state.status === 'ready' && recent.state.forms.length === 0 && <p className="fine-print">Forms you create here will be listed.</p>}
      {recent.state.forms.length > 0 && <ul className="provider-list forms-list">{recent.state.forms.map(form => <RecentRow key={form.id} form={form} />)}</ul>}
    </section>
    <p className="draft-boundary">Google Forms is the only creation target today. {MICROSOFT_REASON} Intake never hosts responses.</p>
  </>;
}

function Review({ draft, operationCost }: { draft: PublicDraft; operationCost: PublicOperationCost | null }) {
  const { specification: spec } = draft;
  const controllers = new Map(spec.questions.map(question => [question.id, question.title]));
  return <section className="draft-review" aria-labelledby="review-title"><div className="draft-review-head"><div><span className="forms-legend">02 / WHAT INTAKE UNDERSTOOD</span><h2 id="review-title">{spec.title}</h2>{spec.description && <p className="draft-description">{spec.description}</p>}</div><span className="status-pill ok">{draft.status === 'ready' ? 'DRAFT · NOT CREATED' : draft.status === 'created' ? 'CREATED' : 'CREATION ATTEMPTED'}</span></div>
    <div className="draft-review-meta"><span>{spec.questions.length} {spec.questions.length === 1 ? 'QUESTION' : 'QUESTIONS'}</span><span>GOOGLE FORMS</span>{spec.questions.some(question => question.visibility) && <span>SECTION ROUTING</span>}</div>
    <OperationCostReceipt receipt={operationCost} />
    <ol className="draft-items">{spec.questions.map((question, index) => {
      const condition = question.visibility?.when;
      const previous = spec.questions[index - 1]?.visibility?.when;
      const beginsSection = condition && (condition.question !== previous?.question || condition.equals !== previous?.equals);
      const resumes = !condition && !!previous;
      return <li key={question.id}>{(beginsSection || resumes) && <div className="draft-section-marker">{beginsSection ? `ROUTING SECTION · SHOW IF “${controllers.get(condition.question) ?? condition.question}” = “${condition.equals}”` : 'NEXT SECTION · EVERYONE ELSE CONTINUES'}</div>}
        <div className="draft-item"><span className="draft-number">{String(index + 1).padStart(2, '0')}</span><div className="draft-item-body"><div className="draft-item-title"><h3>{question.title}</h3><span className={question.required ? 'draft-required' : 'draft-optional'}>{question.required ? 'Required' : 'Optional'}</span></div><p className="draft-kind">{TYPE_LABEL[question.type]}</p>{question.description && <p className="draft-description">{question.description}</p>}{question.options && <ul className="draft-options">{question.options.map(option => <li key={option}>{option}</li>)}</ul>}{condition && <p className="draft-condition">Shown when “{controllers.get(condition.question) ?? condition.question}” is “{condition.equals}” · Google routes respondents by section</p>}</div></div>
      </li>;
    })}</ol>
    {(draft.assumptions.length > 0 || draft.warnings.length > 0) && <aside className="draft-notes"><span className="forms-legend">BEFORE YOU CREATE</span>{draft.assumptions.length > 0 && <div><strong>Assumptions</strong><ul>{draft.assumptions.map((note, index) => <li key={`${index}:${note}`}>{note}</li>)}</ul></div>}{draft.warnings.length > 0 && <div><strong>Google Forms limitations</strong><ul>{draft.warnings.map(note => <li key={`${note.code}:${note.questionId ?? ''}`}>{note.message}</li>)}</ul></div>}</aside>}
  </section>;
}

function FailureNotice({ failure, onReload }: { failure: FormFailure; onReload?: () => void }) {
  const view = describeFailure(failure);
  return <div className={`form-banner ${view.tone === 'bad' ? 'bad' : 'warn'} draft-feedback`} role="alert"><strong>{view.heading}</strong><p>{failure.error}</p>{failure.issues && <ul className="forms-issues">{failure.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}{issue.hint && <em>{issue.hint}</em>}</li>)}</ul>}{view.action && <a className="btn btn-ghost btn-sm" href="/app/connections">View connections →</a>}{onReload && <button type="button" className="btn btn-ghost btn-sm" onClick={onReload}>Check draft status</button>}{failure.requestId && <p className="forms-trace">Request {failure.requestId}</p>}</div>;
}

function Outcome({ result }: { result: CreateFormResult }) {
  if (result.ok) {
    const { form, warnings, requestId } = result;
    return <div className="form-banner ok forms-result draft-result" role="status"><span className="forms-legend">03 / READY TO SHARE</span><strong>Form created.</strong><p>{form.title} {form.published ? 'is published in your Google account and accepting responses.' : 'was created in your Google account but is not accepting responses.'}</p><div className="forms-links">{form.responderUrl && <FormLink href={form.responderUrl} primary>Open form</FormLink>}{form.editUrl && <FormLink href={form.editUrl}>Edit form</FormLink>}</div>{!form.responderUrl && <p className="provider-note">Google did not return a respondent link that Intake could verify. Use Edit form to find it in Google Forms.</p>}{form.id === null && <p className="provider-note">Intake could not save a record of this form, so it will not appear under Recent forms. The links above still work.</p>}{warnings.length > 0 && <ul className="forms-issues" aria-label="Things to know">{warnings.map(warning => <li key={`${warning.code}:${warning.questionId ?? ''}`}>{warning.message}</li>)}</ul>}{requestId && <p className="forms-trace">Request {requestId}</p>}</div>;
  }
  const { failure } = result;
  const view = describeFailure(failure);
  return <div className={`form-banner ${view.tone === 'bad' ? 'bad' : 'warn'} forms-result`} role="alert"><strong>{view.heading}</strong><p>{failure.error}</p>{failure.issues && <ul className="forms-issues" aria-label="What to fix">{failure.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}{issue.hint && <em>{issue.hint}</em>}</li>)}</ul>}{failure.partialForm?.editUrl && <div className="forms-links"><FormLink href={failure.partialForm.editUrl}>Open partly built form</FormLink></div>}{view.action && <a className="btn btn-ghost btn-sm" href="/app/connections">View connections →</a>}{failure.requestId && <p className="forms-trace">Request {failure.requestId}</p>}</div>;
}

function RecentRow({ form }: { form: PublicFormSummary }) {
  const incomplete = form.status === 'incomplete';
  return <li className="provider-row forms-row"><span className="provider-symbol" aria-hidden>G</span><div className="provider-main"><div className="provider-title"><h3>{form.title}</h3><span className={`status-pill ${incomplete ? 'warn' : 'ok'}`}>{incomplete ? 'Incomplete' : 'Published'}</span></div><p className="provider-note">Google Forms · {formatWhen(form.createdAt)}</p>{incomplete && <p className="provider-note">Stopped while {(form.failureStage && STAGE_LABEL[form.failureStage]) || 'building'}. It is not published and does not accept responses.</p>}</div><div className="provider-actions">{form.responderUrl && <FormLink href={form.responderUrl} primary>Open form</FormLink>}{form.editUrl && <FormLink href={form.editUrl}>Edit form</FormLink>}</div></li>;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
