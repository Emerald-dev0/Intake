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

type Busy = 'loading' | 'interpreting' | 'revising' | 'creating' | 'cancelling' | null;
export type RecentFormsState = { status: 'loading' | 'error' | 'ready'; forms: PublicFormSummary[] };
type Recent = RecentFormsState;
type Pending = { mode: 'new' | 'revise'; request: string; question: string; answers: string };
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
  const [revision, setRevision] = useState('');
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [answer, setAnswer] = useState('');
  const [draft, setDraft] = useState<PublicDraft | null>(null);
  const [draftId, setDraftId] = useState(savedId);
  const [busy, setBusy] = useState<Busy>(draftId ? 'loading' : null);
  const busyRef = useRef(false); // guard two click handlers before React renders the disabled state
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const [unsupported, setUnsupported] = useState('');
  const [result, setResult] = useState<CreateFormResult | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'create' | 'edit' | 'library'>(
    locationState?.mode === 'edit' ? 'edit' : locationState?.mode === 'library' ? 'library' : 'create'
  );
  const [selectedEditRecordId, setSelectedEditRecordId] = useState<string | undefined>(
    typeof locationState?.initialRecordId === 'string' ? locationState.initialRecordId : undefined
  );
  const recent = useRecentForms();
  const alive = useAlive();
  const google = providers.providers?.find(provider => provider.id === 'google');

  async function loadDraft(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('loading');
    try {
      const response = await fetch(`/api/forms/draft/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      const parsed = parseDraftLoad(response.status, await response.json().catch(() => null));
      if (!alive.current) return;
      if ('draft' in parsed) {
        setDraft(parsed.draft);
        setResult(parsed.draft.result);
        setFailure(null);
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
    try {
      const { status, body } = await post(mode === 'new' ? '/api/forms/interpret' : '/api/forms/revise',
        mode === 'new' ? { provider: 'google', request, ...(clarification ? { clarification } : {}) }
          : { draftId: draft!.id, version: draft!.version, request, ...(clarification ? { clarification } : {}) });
      if (!alive.current) return;
      const parsed = parseInterpretResponse(status, body);
      if (parsed.status === 'ready') {
        setDraft(parsed.draft);
        setDraftId(parsed.draft.id);
        remember(parsed.draft.id);
        setResult(null);
        setRevision('');
        setEditing(false);
        setPending(null);
        setAnswer('');
      } else if (parsed.status === 'needs_clarification') {
        setPending({ mode, request, question: parsed.question, answers: clarification ?? '' });
        setAnswer('');
      } else if (parsed.status === 'unsupported') {
        setPending(null);
        setUnsupported(parsed.explanation);
      } else {
        setFailure(parsed.failure);
      }
    } catch {
      if (alive.current) setFailure({ error: 'Intake could not confirm the interpretation result. No Google Form was created by this step. If you were revising, check the draft status before trying again.', code: 'model_unavailable', requestId: '', outcome: 'not_created', retryable: true });
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  function submitDescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.trim()) void interpret('new', prompt.trim());
  }
  function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (revision.trim()) void interpret('revise', revision.trim());
  }
  function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || !answer.trim()) return;
    const combined = pending.answers ? `${pending.answers}\nFurther clarification: ${answer.trim()}` : answer.trim();
    if (combined.length > 1000) {
      setFailure({ error: 'The clarification is too long. Shorten your answer to continue.', code: 'invalid_request', requestId: '', outcome: 'not_created' });
      return;
    }
    void interpret(pending.mode, pending.request, combined);
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
    setFailure(null);
    setUnsupported('');
    setPending(null);
    setAnswer('');
    setPrompt('');
    setRevision('');
    setEditing(false);
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

    <div className="draft-steps" aria-label="Form creation steps"><span className="current">01 / DESCRIBE</span><span className={draft ? 'current' : ''}>02 / REVIEW</span><span className={finished ? 'current' : ''}>03 / USE</span></div>
    <section className="draft-provider" aria-label="Form provider"><span className="provider-symbol" aria-hidden>G</span><div><strong>Google Forms</strong><small>{googleLine}</small></div><span className="draft-provider-note">FORMS LIVE IN YOUR GOOGLE ACCOUNT</span></section>
    {notice && <div className="form-banner warn draft-notice" role="status"><p>{notice}</p><a href="/app/connections" className="btn btn-ghost btn-sm">View connections →</a></div>}

    {busy === 'loading' && <div className="forms-panel draft-loading" role="status"><span className="spin" /> Checking your draft…</div>}
    {draftId && !draft && busy !== 'loading' && <div className="form-banner warn" role="alert"><p>We couldn’t open your saved draft yet.</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadDraft(draftId)}>Check draft status</button></div>}

    {!draft && !draftId && <section className="forms-panel draft-describe" aria-labelledby="describe-title">
      <div className="draft-panel-top"><span className="forms-legend">01 / THE IDEA</span><span>YOU DESCRIBE · INTAKE STRUCTURES</span></div>
      <h2 id="describe-title">What should your form ask?</h2>
      <p>Write naturally. Include any questions, answer choices, and who should see a follow-up.</p>
      <form onSubmit={submitDescription} aria-busy={busy === 'interpreting'}>
        <label className="sr-only" htmlFor="form-request">Describe the form you need</label>
        <textarea id="form-request" className="draft-input" placeholder={EXAMPLE} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={3000} required disabled={busy !== null} aria-describedby="describe-help" />
        <div className="draft-input-foot"><span id="describe-help">A clear first draft is enough. You can make changes before anything is created.</span><span>{prompt.length} / 3000</span></div>
        <div className="forms-actions"><button className="btn btn-accent" type="submit" disabled={busy !== null || !prompt.trim()}>{busy === 'interpreting' ? 'Understanding your request…' : 'Understand my form →'}</button>{busy === 'interpreting' && <span className="forms-progress" role="status"><span className="spin sm" /> Intake is planning the questions. No form is being created yet.</span>}</div>
      </form>
      <div className="draft-example"><span>NEED A STARTING POINT?</span><button type="button" onClick={() => setPrompt(EXAMPLE)} disabled={busy !== null}>Use a registration example ↗</button></div>
    </section>}

    {pending && <section className="draft-question form-banner warn" aria-labelledby="clarification-title">
      <span className="forms-legend">ONE QUICK QUESTION</span><h2 id="clarification-title">{pending.question}</h2>
      <form onSubmit={submitAnswer}><label htmlFor="clarification-answer">Your answer</label><textarea id="clarification-answer" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={1000} required disabled={busy !== null} placeholder="Add the missing detail…" />
        <div className="forms-actions"><button className="btn btn-accent btn-sm" type="submit" disabled={busy !== null || !answer.trim()}>{busy === 'interpreting' || busy === 'revising' ? 'Understanding…' : 'Continue →'}</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => { setPending(null); setAnswer(''); }}>Back to {draft ? 'review' : 'description'}</button></div>
      </form>
    </section>}
    {unsupported && <div className="form-banner warn draft-feedback" role="alert"><strong>That isn’t available in Google Forms through Intake.</strong><p>{unsupported}</p><p>Rephrase the request using supported questions and section routing, or keep the current draft.</p></div>}
    {failure && <FailureNotice failure={failure} onReload={draftId ? () => void loadDraft(draftId) : undefined} />}

    {draft && <>
      <Review draft={draft} />
      {draft.status === 'ready' && <section className="draft-controls" aria-label="Review actions">
        {!pending && <div className="draft-review-actions"><button type="button" className="btn btn-accent" onClick={() => void confirm()} disabled={busy !== null}>{busy === 'creating' ? 'Creating your form…' : 'Create form →'}</button><button type="button" className="btn btn-ghost" onClick={() => setEditing(value => !value)} disabled={busy !== null}>Edit with Intake</button><button type="button" className="draft-cancel" onClick={() => void cancel()} disabled={busy !== null}>{busy === 'cancelling' ? 'Discarding…' : 'Cancel'}</button></div>}
        {busy === 'creating' && <p className="forms-progress" role="status"><span className="spin sm" /> Google is building your form. This can take several seconds. Keep this page open.</p>}
        <p className="forms-help">Nothing has been sent to Google yet. Creating requires your confirmation, and this draft can only be submitted once.</p>
        {editing && !pending && <form className="draft-revision" onSubmit={submitRevision} aria-busy={busy === 'revising'}><label htmlFor="revision-request">What would you change?</label><textarea id="revision-request" value={revision} onChange={event => setRevision(event.target.value)} disabled={busy !== null} maxLength={3000} required placeholder="e.g. Make email optional, then move phone number below it." /><div className="forms-actions"><button className="btn btn-accent btn-sm" type="submit" disabled={busy !== null || !revision.trim()}>{busy === 'revising' ? 'Applying your change…' : 'Apply change →'}</button>{busy === 'revising' && <span className="forms-progress" role="status">Updating the draft only. Google has not been contacted.</span>}</div></form>}
      </section>}
      {blocked && <div className="form-banner warn draft-feedback" role="alert"><strong>Do not create this draft again.</strong><p>{draft.status === 'creating' ? 'Creation was started, but Intake has not confirmed its outcome. It may still be running. Check Recent forms and Google Forms before starting a new draft.' : 'The creation attempt had a partial or uncertain outcome. Check the result and Google Forms; Intake will not submit this draft again.'}</p><div className="draft-recovery-actions"><button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => void loadDraft(draft.id)}>Check draft status</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={reset}>Start a different form after checking Google →</button></div></div>}
      {result && <Outcome result={result} />}
      {finished && <button className="btn btn-ghost draft-start-again" type="button" onClick={reset}>Start another form →</button>}
    </>}

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

function Review({ draft }: { draft: PublicDraft }) {
  const { specification: spec } = draft;
  const controllers = new Map(spec.questions.map(question => [question.id, question.title]));
  return <section className="draft-review" aria-labelledby="review-title"><div className="draft-review-head"><div><span className="forms-legend">02 / WHAT INTAKE UNDERSTOOD</span><h2 id="review-title">{spec.title}</h2>{spec.description && <p className="draft-description">{spec.description}</p>}</div><span className="status-pill ok">{draft.status === 'ready' ? 'DRAFT · NOT CREATED' : draft.status === 'created' ? 'CREATED' : 'CREATION ATTEMPTED'}</span></div>
    <div className="draft-review-meta"><span>{spec.questions.length} {spec.questions.length === 1 ? 'QUESTION' : 'QUESTIONS'}</span><span>GOOGLE FORMS</span>{spec.questions.some(question => question.visibility) && <span>SECTION ROUTING</span>}</div>
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
  return <div className={`form-banner ${view.tone === 'bad' ? 'bad' : 'warn'} forms-result`} role="alert"><strong>{view.heading}</strong><p>{failure.error}</p>{failure.detail && <p className="provider-note">Google said: {failure.detail}</p>}{failure.issues && <ul className="forms-issues" aria-label="What to fix">{failure.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}{issue.hint && <em>{issue.hint}</em>}</li>)}</ul>}{failure.partialForm?.editUrl && <div className="forms-links"><FormLink href={failure.partialForm.editUrl}>Open partly built form</FormLink></div>}{view.action && <a className="btn btn-ghost btn-sm" href="/app/connections">View connections →</a>}{failure.requestId && <p className="forms-trace">Request {failure.requestId}</p>}</div>;
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
