import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  editTypeLabel,
  parseFormEditConfirm,
  parseFormEditDraftLoad,
  parseFormEditInspect,
  parseFormEditInterpret,
  type FormEditFailure,
  type FormEditView,
  type PublicFormEditDraft,
} from '../lib/form-edit';
import type { PublicFormSummary } from '../lib/forms';
import type { ProviderLoad } from './Connections';
import { useCredits } from './hooks/useCredits';
import { createOperationTracker } from '../lib/operation-id';
import { insufficientCreditsMessage, isInsufficientCredits, type PublicOperationCost } from '../lib/credits';
import { CreditCostPreview, OperationCostReceipt } from './components/CreditCostPreview';
import { LogoMark } from '../components/LogoMark';

// Kept provider-independent at the UI boundary; the server resolves all targets against the signed-in user.
type Target = { kind: 'record'; formRecordId: string } | { kind: 'url'; formUrl: string };
type Source = 'recent' | 'url';
type Busy = 'loading' | 'inspecting' | 'interpreting' | 'revising' | 'confirming' | 'cancelling' | null;
type Pending = { mode: 'new'; target: Target; request: string; clarification: string; question: string }
  | { mode: 'revise'; draftId: string; version: number; request: string; clarification: string; question: string };

const EDIT_DRAFT_KEY = 'intake:current-form-edit-draft'; // opaque id only; instructions and form content stay on the server
const MAX_REQUEST = 3000;
const MAX_CLARIFICATION = 1000;

function savedEditId(): string | null {
  try { return sessionStorage.getItem(EDIT_DRAFT_KEY); } catch { return null; }
}
function rememberEditId(id: string | null): void {
  try { if (id) sessionStorage.setItem(EDIT_DRAFT_KEY, id); else sessionStorage.removeItem(EDIT_DRAFT_KEY); } catch { /* session-only fallback */ }
}
function textFailure(message: string, code: FormEditFailure['code'] = 'internal_error', outcome: FormEditFailure['outcome'] = 'unknown'): FormEditFailure {
  return { error: message, code, requestId: '', outcome, retryable: false };
}
function formLink(value: string | null, label: string, primary = false) {
  if (!value) return null;
  return <a className={`btn ${primary ? 'btn-accent' : 'btn-ghost'} btn-sm`} href={value} target="_blank" rel="noreferrer">{label} <span aria-hidden>↗</span></a>;
}
function byCreated(form: PublicFormSummary): string {
  const date = new Date(form.createdAt);
  return Number.isNaN(date.getTime()) ? form.title : `${form.title} · ${date.toLocaleDateString()}`;
}
function shouldReconnect(failure: FormEditFailure): boolean {
  return ['provider_not_connected', 'provider_reauthorization_required', 'provider_not_configured'].includes(failure.code);
}

export function FormEditWorkspace({
  providers, reloadProviders, forms, formsStatus, reloadForms, initialRecordId,
}: {
  providers: ProviderLoad;
  reloadProviders: () => void;
  forms: PublicFormSummary[];
  formsStatus: 'loading' | 'error' | 'ready';
  reloadForms: () => void;
  initialRecordId?: string;
}) {
  const credits = useCredits();
  // One stable idempotency key per distinct edit submission.
  const operations = useRef(createOperationTracker()).current;
  const [source, setSource] = useState<Source>('recent');
  const [selectedRecordId, setSelectedRecordId] = useState(initialRecordId ?? '');
  const [formUrl, setFormUrl] = useState('');
  const [request, setRequest] = useState('');
  const [revision, setRevision] = useState('');
  const [preview, setPreview] = useState<FormEditView | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [draft, setDraft] = useState<PublicFormEditDraft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(savedEditId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [failure, setFailure] = useState<FormEditFailure | null>(null);
  const [unsupported, setUnsupported] = useState('');
  const [operationCost, setOperationCost] = useState<PublicOperationCost | null>(null);
  const [busy, setBusy] = useState<Busy>(draftId ? 'loading' : null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checkedOriginal, setCheckedOriginal] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const google = providers.providers?.find(provider => provider.id === 'google');
  const googleForms = forms.filter(form => form.provider === 'google');
  const costCredits = credits.state.status === 'ready' ? credits.state.credits : null;
  const costGuide = credits.state.status === 'ready' ? credits.state.costGuide : null;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (initialRecordId && googleForms.some(form => form.id === initialRecordId)) {
      setSelectedRecordId(initialRecordId);
      setSource('recent');
    } else if (!selectedRecordId && googleForms.length) {
      setSelectedRecordId(googleForms[0].id);
    }
  }, [googleForms, selectedRecordId, initialRecordId]);

  function selectedTarget(): Target | null {
    if (source === 'recent') return googleForms.some(form => form.id === selectedRecordId) ? { kind: 'record', formRecordId: selectedRecordId } : null;
    return formUrl.trim() ? { kind: 'url', formUrl: formUrl.trim() } : null;
  }
  const target = selectedTarget();
  const currentTargetKey = !target ? '' : target.kind === 'record' ? `record:${target.formRecordId}` : `url:${target.formUrl}`;
  const canUsePreview = !!preview && previewKey === currentTargetKey;

  async function fetchDraft(id: string): Promise<PublicFormEditDraft | null> {
    const response = await fetch(`/api/forms/edit/draft/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
    const parsed = parseFormEditDraftLoad(response.status, await response.json().catch(() => null));
    if ('draft' in parsed) return parsed.draft;
    if (parsed.failure.code === 'edit_draft_not_found') {
      rememberEditId(null);
      if (alive.current) { setDraftId(null); setDraft(null); }
      return null;
    }
    throw Object.assign(new Error(parsed.failure.error), { failure: parsed.failure });
  }

  async function loadSavedDraft(id = draftId) {
    if (!id || busyRef.current) return;
    busyRef.current = true;
    setBusy('loading');
    setOperationCost(null);
    try {
      const saved = await fetchDraft(id);
      if (!alive.current) return;
      if (saved) { setDraft(saved); setDraftId(saved.id); setFailure(null); }
      else setFailure(null);
    } catch (error) {
      if (alive.current) setFailure((error as { failure?: FormEditFailure }).failure ?? textFailure('Intake could not reload the saved proposal. The form was not changed. Try checking its status again.', 'storage_unavailable', 'not_applied'));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }
  useEffect(() => { if (draftId) void loadSavedDraft(draftId); }, []);

  async function inspect() {
    if (!target || busyRef.current) return;
    busyRef.current = true;
    setBusy('inspecting');
    setFailure(null);
    setUnsupported('');
    setPreview(null);
    setPreviewKey('');
    try {
      const response = await fetch('/api/forms/edit/inspect', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ target }),
      });
      const parsed = parseFormEditInspect(response.status, await response.json().catch(() => null));
      if (!alive.current) return;
      if ('form' in parsed) { setPreview(parsed.form); setPreviewKey(currentTargetKey); }
      else { setFailure(parsed.failure); if (shouldReconnect(parsed.failure)) reloadProviders(); }
    } catch {
      if (alive.current) setFailure(textFailure('Intake could not retrieve the current Google Form. No changes were made. Check the URL and connection, then try again.', 'provider_unavailable', 'not_applied'));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function interpret(mode: 'new' | 'revise', instruction: string, clarification = '', fixedTarget?: Target, fixedDraft?: { id: string; version: number }) {
    if (busyRef.current) return;
    if (mode === 'new' && !fixedTarget && (!target || !canUsePreview)) return;
    if (mode === 'revise' && !fixedDraft && (!draft || draft.status !== 'ready')) return;
    busyRef.current = true;
    setBusy(mode === 'new' ? 'interpreting' : 'revising');
    setFailure(null);
    setUnsupported('');
    setOperationCost(null);
    try {
      const targetKeyPart = mode === 'new' ? JSON.stringify(fixedTarget ?? target) : `${fixedDraft?.id ?? draft!.id}:${fixedDraft?.version ?? draft!.version}`;
      const signature = [mode, targetKeyPart, instruction, clarification ?? ''].join('|');
      const operationId = operations.id(signature);
      const body = mode === 'new'
        ? { target: fixedTarget ?? target, request: instruction, operationId, ...(clarification ? { clarification } : {}) }
        : { draftId: fixedDraft?.id ?? draft!.id, version: fixedDraft?.version ?? draft!.version, request: instruction, operationId, ...(clarification ? { clarification } : {}) };
      const response = await fetch(mode === 'new' ? '/api/forms/edit/interpret' : '/api/forms/edit/revise', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      operations.settle();
      credits.note(payload);
      const parsed = parseFormEditInterpret(response.status, payload);
      if (!alive.current) return;
      setOperationCost(parsed.status === 'error' ? null : parsed.operationCost ?? null);
      if (parsed.status === 'ready') {
        setDraft(parsed.draft);
        setDraftId(parsed.draft.id);
        rememberEditId(parsed.draft.id);
        setPending(null);
        setClarificationAnswer('');
        setRevision('');
        setAcknowledged(false);
        setCheckedOriginal(false);
      } else if (parsed.status === 'needs_clarification') {
        setPending(mode === 'new'
          ? { mode, target: fixedTarget ?? target!, request: instruction, clarification, question: parsed.question }
          : { mode, draftId: fixedDraft?.id ?? draft!.id, version: fixedDraft?.version ?? draft!.version, request: instruction, clarification, question: parsed.question });
        setClarificationAnswer('');
      } else if (parsed.status === 'unsupported') {
        setPending(null);
        setUnsupported(parsed.explanation);
      } else {
        const outOfCredits = isInsufficientCredits(parsed.failure.code);
        setFailure(outOfCredits ? { ...parsed.failure, error: insufficientCreditsMessage(credits.state.credits) } : parsed.failure);
        if (outOfCredits) credits.reload();
        if (shouldReconnect(parsed.failure)) reloadProviders();
      }
    } catch {
      // The operation key is kept, so a retry after a lost response cannot charge twice.
      if (alive.current) setFailure(textFailure('Intake could not confirm the edit interpretation. The Google Form has not been changed by interpretation. Check the proposal status before submitting another request.', 'model_unavailable', 'not_applied'));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.trim()) void interpret('new', request.trim());
  }
  function submitRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (revision.trim()) void interpret('revise', revision.trim());
  }
  function submitClarification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || !clarificationAnswer.trim()) return;
    const combined = pending.clarification ? `${pending.clarification}\nFurther clarification: ${clarificationAnswer.trim()}` : clarificationAnswer.trim();
    if (combined.length > MAX_CLARIFICATION) {
      setFailure(textFailure('That clarification is too long. Shorten your answer to continue.', 'invalid_request', 'not_applied'));
      return;
    }
    if (pending.mode === 'new') void interpret('new', pending.request, combined, pending.target);
    else void interpret('revise', pending.request, combined, undefined, { id: pending.draftId, version: pending.version });
  }

  async function confirm() {
    if (busyRef.current || !draft || draft.status !== 'ready' || !acknowledged) return;
    busyRef.current = true;
    setBusy('confirming');
    setFailure(null);
    try {
      const response = await fetch('/api/forms/edit/confirm', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ draftId: draft.id, version: draft.version, confirm: true }),
      });
      const parsed = parseFormEditConfirm(response.status, await response.json().catch(() => null));
      if (!alive.current) return;
      if ('result' in parsed) {
        setDraft(parsed.draft);
        setDraftId(parsed.draft.id);
        setFailure(null);
        setAcknowledged(false);
        void reloadForms();
      } else {
        if (parsed.draft) setDraft(parsed.draft);
        setFailure(parsed.failure);
        setAcknowledged(false);
        if (shouldReconnect(parsed.failure)) reloadProviders();
        if (parsed.failure.outcome !== 'not_applied') void reloadForms();
      }
    } catch {
      if (!alive.current) return;
      setFailure(textFailure('The confirmation response was interrupted. Intake will not automatically retry. Checking the saved proposal status now; if it is still applying, check the original Google Form before continuing.', 'internal_error', 'unknown'));
      // A safe GET recovers the one-shot claim outcome. This is not a provider retry.
      try {
        const latest = await fetchDraft(draft.id);
        if (latest && alive.current) setDraft(latest);
      } catch { /* The durable draft may remain locked; retain the explicit warning above. */ }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function discard() {
    if (busyRef.current || !draft || draft.status !== 'ready') return;
    busyRef.current = true;
    setBusy('cancelling');
    setFailure(null);
    try {
      const response = await fetch(`/api/forms/edit/draft/${encodeURIComponent(draft.id)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!alive.current) return;
      if (response.status === 204) { clearProposal(); return; }
      const payload = await response.json().catch(() => null) as { error?: unknown; code?: unknown; requestId?: unknown } | null;
      setFailure(textFailure(typeof payload?.error === 'string' ? payload.error : 'Intake could not confirm the proposal was discarded. Reload its status before continuing.', typeof payload?.code === 'string' ? payload.code as FormEditFailure['code'] : 'internal_error', 'not_applied'));
    } catch {
      if (alive.current) setFailure(textFailure('Intake could not confirm the proposal was discarded. Reload its status before continuing.', 'storage_unavailable', 'unknown'));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }

  function clearProposal() {
    rememberEditId(null);
    setDraftId(null);
    setDraft(null);
    setPending(null);
    setClarificationAnswer('');
    setFailure(null);
    setUnsupported('');
    setOperationCost(null);
    setAcknowledged(false);
    setCheckedOriginal(false);
    setPreview(null);
    setPreviewKey('');
    setRequest('');
    setRevision('');
  }

  const providerNotice = !google
    ? 'Google connection details could not be loaded. Intake will verify the connection when you inspect the form.'
    : google.status === 'connected'
      ? `Connected${google.accountEmail ? ` as ${google.accountEmail}` : ''}. The selected form must be editable by this Google account.`
      : !google.configured && google.status === 'not_connected'
        ? `Google access is not configured on this Intake server yet. An operator needs ${google.setupEnv.join(' and ')}.`
        : google.status === 'not_connected'
          ? 'Connect Google before inspecting a form. Use the Google account that can edit the original form.'
          : 'Google authorization needs renewing. Reconnect Google before inspecting a form.';

  const editTarget = !draft && !draftId;
  const canReviseNow = !!draft && draft.status === 'ready';
  // A partial or uncertain apply outcome keeps the proposal revivable but not re-submittable.
  const reviseLocked = !!(draft && draft.result && !draft.result.ok && draft.result.failure.outcome !== 'not_applied');

  // One composer, three jobs. The id names the job so the safety tests keep naming the same field,
  // and the person never has to hunt for a second text box.
  const composer: {
    id: string; label: string; value: string; set: (value: string) => void; max: number;
    placeholder: string; action: string; hint: string; disabled: boolean;
  } | null = pending
    ? {
      id: 'edit-clarification-answer', label: 'Your answer', value: clarificationAnswer, set: setClarificationAnswer,
      max: MAX_CLARIFICATION, placeholder: 'Add the missing detail…',
      action: busy === 'interpreting' || busy === 'revising' ? 'Revising the proposal…' : 'Continue →',
      hint: 'One answer is enough. Nothing has been applied.', disabled: false,
    }
    : canReviseNow
      ? {
        id: 'edit-revision', label: 'Revise the proposed changes', value: revision, set: setRevision,
        max: MAX_REQUEST, placeholder: 'e.g. Keep that question required, and also update the title to “Workshop registration”.',
        action: busy === 'revising' ? 'Revising proposal…' : 'Revise proposal →',
        hint: 'Intake reloads the current form and checks it has not changed before revising. Revising never applies the current proposal.',
        disabled: reviseLocked,
      }
      : canUsePreview && !draft
        ? {
          id: 'edit-request', label: 'Describe the changes', value: request, set: setRequest,
          max: MAX_REQUEST, placeholder: 'e.g. Rename “Contact number” to “Phone number” and make it optional.',
          action: busy === 'interpreting' ? 'Preparing proposal…' : 'Prepare edit proposal →',
          hint: 'Refer to a question by its visible title. Intake will ask rather than guess if a target is ambiguous.',
          disabled: false,
        }
        : null;

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) submitClarification(event);
    else if (canReviseNow) submitRevision(event);
    else submitNew(event);
  }

  /** Intake's turn in the thread. Cards sit under the same row, flush, as an artifact. */
  function intakeRow(content: ReactNode, card = false) {
    return <div className={`msg-row msg-row--intake${card ? ' msg-row--wide' : ''}`}>
      <span className="msg-avatar msg-avatar--intake" aria-hidden="true"><LogoMark size={15} /></span>
      <div className={`msg msg-intake${card ? ' msg-wide' : ''}`}>{content}</div>
    </div>;
  }

  const opening = draft
    ? 'Here is the plan for the form you already have. Read the list — nothing has been sent to Google yet.'
    : canUsePreview
      ? `This is ${preview!.title} as it stands. Tell me what should change, in your own words, and I will show you the exact difference first.`
      : draftId
        ? 'Picking up where we left off. I am checking the saved proposal before anything else happens.'
        : 'First, the form itself. Pick one you created here, or paste its Google Forms edit URL — the connected account has to be able to edit it.';

  return <>
    {editTarget && <div className="chat-intro">
      <h1>Keep the form. <em>Change what matters.</em></h1>
      <p>Intake reads the Google Form you already have, proposes the exact changes, and updates that same form only after you confirm. Nothing is replaced and nothing is applied on its own.</p>
    </div>}
    <section className="draft-provider edit-provider" aria-label="Edit provider"><span className="provider-symbol" aria-hidden>G</span><div><strong>Google Forms</strong><small>{providerNotice}</small></div><span className="draft-provider-note">ORIGINAL FORM ID IS PRESERVED</span></section>
    {google && google.status !== 'connected' && <div className="form-banner warn draft-notice" role="status"><p>{providerNotice}</p><a href="/app/connections" className="btn btn-ghost btn-sm">View connections →</a></div>}
    {((canUsePreview && !draft) || draft?.status === 'ready') && <CreditCostPreview mode="edit" guide={costGuide} credits={costCredits} />}

    {busy === 'loading' && <div className="forms-panel draft-loading" role="status"><span className="spin" /> Recovering your saved edit proposal…</div>}
    {draftId && !draft && busy !== 'loading' && <div className="form-banner warn" role="alert"><strong>Saved edit status is not confirmed.</strong><p>{failure?.error ?? 'The proposal could not be loaded. No provider update was repeated.'}</p><div className="forms-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void loadSavedDraft(draftId)}>Check proposal status</button></div></div>}

    <section className="thread" aria-label="Conversation with Intake">
      {intakeRow(opening)}
      {editTarget && !canUsePreview && intakeRow(<section className="forms-panel edit-target-panel" aria-labelledby="edit-select-title">
      <div className="draft-panel-top"><span className="forms-legend">01 / SELECT THE ORIGINAL</span><span>KNOWN GOOGLE FORM · CURRENT PROVIDER STATE</span></div>
      <h2 id="edit-select-title">Which Google Form should Intake edit?</h2>
      <p>Choose a recent form created through Intake, or paste a standard Google Forms edit URL. Drive-wide search is not available under Intake’s current Google Forms permission.</p>
      <div className="edit-source-switch" role="group" aria-label="Form selection method">
        <button type="button" className={source === 'recent' ? 'selected' : ''} aria-pressed={source === 'recent'} disabled={busy !== null} onClick={() => { setSource('recent'); setPreview(null); setPreviewKey(''); setFailure(null); }}>Recent Intake forms</button>
        <button type="button" className={source === 'url' ? 'selected' : ''} aria-pressed={source === 'url'} disabled={busy !== null} onClick={() => { setSource('url'); setPreview(null); setPreviewKey(''); setFailure(null); }}>Paste a Google Forms URL</button>
      </div>
      {source === 'recent' && <div className="edit-target-field">
        {formsStatus === 'loading' && <p className="fine-print" role="status">Loading your recent forms…</p>}
        {formsStatus === 'error' && <div className="form-banner warn"><p>Your recent forms could not be loaded. You can still paste an edit URL.</p><button type="button" className="btn btn-ghost btn-sm" onClick={reloadForms}>Reload recent forms</button></div>}
        {formsStatus === 'ready' && googleForms.length > 0 && <><label htmlFor="edit-form-record">Select one of your recent Google Forms</label><select id="edit-form-record" value={selectedRecordId} disabled={busy !== null} onChange={event => { setSelectedRecordId(event.target.value); setPreview(null); setPreviewKey(''); setFailure(null); }}>
          {googleForms.map(form => <option key={form.id} value={form.id}>{byCreated(form)}{form.status === 'incomplete' ? ' · incomplete' : ''}</option>)}
        </select><p className="forms-help">Intake fetches the current form from Google before proposing changes. The Intake record is used only to identify a form you already own.</p></>}
        {formsStatus === 'ready' && googleForms.length === 0 && <div className="form-banner warn"><p>No recent Google Forms are recorded in Intake. Paste a Google Forms edit URL instead.</p></div>}
      </div>}
      {source === 'url' && <div className="edit-target-field"><label htmlFor="edit-form-url">Google Forms edit URL</label><input id="edit-form-url" type="url" autoComplete="url" inputMode="url" maxLength={2048} value={formUrl} disabled={busy !== null} onChange={event => { setFormUrl(event.target.value); setPreview(null); setPreviewKey(''); setFailure(null); }} placeholder="https://docs.google.com/forms/d/…/edit" aria-describedby="edit-url-help" /><p id="edit-url-help" className="forms-help">Use a URL from docs.google.com/forms ending in /edit or /viewform. Intake never fetches arbitrary links; the connected Google account still needs edit access.</p></div>}
      <div className="forms-actions"><button type="button" className="btn btn-accent" disabled={!target || busy !== null} onClick={() => void inspect()}>{busy === 'inspecting' ? 'Loading current Google Form…' : 'Inspect current form →'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={reloadForms}>Refresh form list</button>{busy === 'inspecting' && <span className="forms-progress" role="status"><span className="spin sm" /> Read-only check. Intake has not changed the form.</span>}</div>
    </section>, true)}
      {canUsePreview && !draft && <>
        {intakeRow('Here is the current form, read-only. I will not change it while I look.')}
        {intakeRow(<CurrentForm form={preview!} />, true)}
      </>}
      {pending && intakeRow(<>{'One thing I do not want to guess.'}<span className="msg-question" id="edit-clarification-title">{pending.question}</span></>)}
      {unsupported && intakeRow(<><strong>That edit is not supported safely.</strong>{' '}{unsupported}{' '}Reword it with a supported change, or make this one directly in Google Forms — the previous proposal has not been applied.</>)}
      {failure && !(draftId && !draft) && intakeRow(<FailureNotice failure={failure} onReload={draftId ? () => void loadSavedDraft(draftId) : undefined} />, true)}
      {draft && <>
        {intakeRow(draft.status === 'ready'
          ? 'Nothing has been sent to Google. Check the changes, then confirm if they are right.'
          : draft.status === 'applied'
            ? 'Done. I re-read the form after updating it, and the changes are in place on the same form.'
            : 'This proposal needs your attention before it goes any further.')}
        {intakeRow(<EditReview draft={draft} operationCost={operationCost} busy={busy} acknowledged={acknowledged} setAcknowledged={setAcknowledged}
          onConfirm={() => void confirm()} onDiscard={() => void discard()} onReload={() => void loadSavedDraft(draft.id)} onStartFresh={clearProposal}
          checkedOriginal={checkedOriginal} setCheckedOriginal={setCheckedOriginal} />, true)}
      </>}
      {(pending || unsupported) && <OperationCostReceipt receipt={operationCost} />}
    </section>

    {composer && <form className="thread-composer" onSubmit={submitComposer} aria-busy={busy !== null}>
      <label className="sr-only" htmlFor={composer.id}>{composer.label}</label>
      <textarea
        id={composer.id}
        className="draft-input"
        rows={1}
        value={composer.value}
        onChange={event => composer.set(event.target.value)}
        disabled={busy !== null || composer.disabled}
        maxLength={composer.max}
        required
        placeholder={composer.placeholder}
        aria-describedby="edit-composer-help"
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }
        }}
      />
      <div className="draft-input-foot">
        <span id="edit-composer-help">{composer.hint}</span>
        <span className="composer-shortcut">Enter to send · Shift + Enter for a new line · {composer.value.length} / {composer.max}</span>
      </div>
      <div className="forms-actions">
        <button className="btn btn-accent" type="submit" disabled={busy !== null || !composer.value.trim() || composer.disabled}>
          {busy !== null && composer.id !== 'edit-revision' ? (composer.id === 'edit-request' ? 'Preparing proposal…' : composer.action) : composer.action}
        </button>
        {pending && <button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => { setPending(null); setClarificationAnswer(''); }}>Dismiss question</button>}
        {busy === 'interpreting' && <span className="forms-progress" role="status"><span className="spin sm" /> Rechecking the provider form before suggesting changes.</span>}
        {busy === 'revising' && <span className="forms-progress" role="status"><span className="spin sm" /> No Google change is being made.</span>}
      </div>
    </form>}
  </>;
}

function CurrentForm({ form }: { form: FormEditView }) {
  return <section className="edit-current" aria-labelledby="edit-current-title">
    <div className="edit-current-head"><div><span className="forms-legend">CURRENT FORM · READ FROM GOOGLE</span><h2 id="edit-current-title">{form.title || 'Untitled Google Form'}</h2>{form.description && <p>{form.description}</p>}</div><div className="forms-links">{formLink(form.responderUrl, 'Open respondent view')}{formLink(form.editUrl, 'Open in Google Forms')}</div></div>
    <div className="draft-review-meta"><span>{form.items.filter(item => item.kind === 'question').length} QUESTIONS</span>{form.hasSections && <span>SECTIONS</span>}{form.hasBranching && <span>BRANCHING · STRUCTURAL EDITS RESTRICTED</span>}</div>
    {form.items.length === 0 ? <p className="fine-print">This form has no items. Intake will only propose operations the current Google Forms API can safely express.</p> : <ol className="edit-current-items">{form.items.map(item => <li key={item.itemId}>
      <span className="draft-number">{String(item.index + 1).padStart(2, '0')}</span><div><span className="edit-item-kind">{item.kind === 'section' ? 'SECTION BREAK' : item.kind === 'question' ? `${editTypeLabel(item.questionType ?? 'unknown')}${item.required ? ' · REQUIRED' : ''}` : item.kind.replace('_', ' ').toUpperCase()}</span><strong>{item.title || (item.kind === 'section' ? 'Untitled section' : 'Untitled item')}</strong>
        {item.description && <p>{item.description}</p>}{item.options && item.options.length > 0 && <p className="edit-current-options">Options: {item.options.join(' · ')}</p>}{item.hasRouting && <p className="edit-routing-note">Has response routing; Intake limits structural changes to protect respondent navigation.</p>}
      </div></li>)}</ol>}
    <p className="forms-help">This preview is read-only. Intake fetches the Google revision again when creating the proposal and immediately before a confirmed update.</p>
  </section>;
}

function EditReview({
  draft, operationCost, busy, acknowledged, setAcknowledged, onConfirm, onDiscard, onReload, onStartFresh, checkedOriginal, setCheckedOriginal,
}: {
  draft: PublicFormEditDraft; operationCost: PublicOperationCost | null; busy: Busy; acknowledged: boolean; setAcknowledged: (value: boolean) => void; onConfirm: () => void; onDiscard: () => void;
  onReload: () => void; onStartFresh: () => void;
  checkedOriginal: boolean; setCheckedOriginal: (value: boolean) => void;
}) {
  const locked = draft.status === 'applying' || draft.status === 'blocked' || draft.status === 'stale';
  const resultFailure = draft.result && !draft.result.ok ? draft.result.failure : null;
  const success = draft.status === 'applied' && draft.result?.ok ? draft.result : null;
  return <>
    <section className="edit-review" aria-labelledby="edit-review-title">
      <div className="edit-review-head"><div><span className="forms-legend">02 / REVIEW THE EXACT CHANGES</span><h2 id="edit-review-title">{draft.plan.summary}</h2></div><span className={`status-pill ${success ? 'ok' : locked ? 'warn' : 'ok'}`}>{success ? 'APPLIED TO ORIGINAL' : draft.status.toUpperCase()}</span></div>
      <p className="edit-original-note">Original Google Form · {draft.current.providerFormId}<br />Intake preserves this form ID. Respondent answers and the responder URL are not replaced.</p>
      {draft.changes.length > 0 ? <ol className="edit-diff-list">{draft.changes.map((change, index) => <li key={`${change.type}:${index}`} className={change.destructive ? 'destructive' : ''}>
        <span className="edit-diff-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{change.title}</strong><p>{change.detail}</p></div><span className={`edit-diff-tag ${change.destructive ? 'danger' : ''}`}>{change.destructive ? 'REMOVE' : change.type.replaceAll('_', ' ')}</span>
      </li>)}</ol> : <p className="fine-print">No supported changes were proposed.</p>}
      <OperationCostReceipt receipt={operationCost} />
      <details className="edit-current-details"><summary>Review the current form structure</summary><CurrentForm form={{ ...draft.current, items: draft.current.items }} /></details>
      {draft.result && !draft.result.ok && draft.status === 'ready' && <div className="form-banner warn edit-outcome" role="status"><strong>The last confirmed attempt was not applied.</strong><p>{draft.result.failure.error}</p><p>Intake refreshed the form and found the proposal unchanged. You can revise it, discard it, or explicitly confirm another attempt after reviewing the current proposal.</p></div>}

      {draft.status === 'ready' && <div className="edit-confirm-panel">
        <p><strong>No Google change has been made yet.</strong> Confirming sends the reviewed updates to this existing form only. Intake rechecks the Google revision and connected account first.</p>
        <label className="edit-confirm-check"><input type="checkbox" checked={acknowledged} disabled={busy !== null} onChange={event => setAcknowledged(event.target.checked)} /> I reviewed these changes and want Intake to apply them to the original Google Form.</label>
        <div className="forms-actions"><button type="button" className="btn btn-accent" disabled={busy !== null || !acknowledged} onClick={onConfirm}>{busy === 'confirming' ? 'Applying to the original form…' : draft.result?.ok === false ? 'Confirm another apply attempt →' : 'Confirm and apply edit →'}</button><button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={onDiscard}>{busy === 'cancelling' ? 'Discarding…' : 'Discard proposal'}</button></div>
        {busy === 'confirming' && <p className="forms-progress" role="status"><span className="spin sm" /> Google may take several seconds. Keep this page open; Intake will verify the resulting form.</p>}
        <p className="forms-help">Only clicking the button above confirms the mutation. Intake does not create a new form as a fallback.</p>
      </div>}

      {locked && <div className={`form-banner ${draft.status === 'stale' ? 'warn' : 'bad'} edit-outcome`} role="alert">
        {draft.status === 'stale' && <><strong>The Google Form changed; this proposal is stale.</strong><p>{resultFailure?.error ?? 'No changes were applied. Inspect the latest form and prepare a new proposal.'}</p><button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={onStartFresh}>Select and inspect the current form →</button></>}
        {draft.status === 'applying' && <><strong>The edit result is not confirmed. Do not resubmit.</strong><p>Intake has a one-shot apply claim but no final provider result. Refresh status; if it remains here, check the original Google Form before starting another edit.</p><div className="forms-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={onReload}>Check saved proposal status</button><label className="edit-confirm-check"><input type="checkbox" checked={checkedOriginal} disabled={busy !== null} onChange={event => setCheckedOriginal(event.target.checked)} /> I checked the original form in Google Forms and understand this proposal will not be retried.</label><button type="button" className="btn btn-ghost btn-sm" disabled={!checkedOriginal || busy !== null} onClick={onStartFresh}>Start a separate proposal</button></div></>}
        {draft.status === 'blocked' && <><strong>{resultFailure?.outcome === 'partial' ? 'The final form contains only some requested changes.' : 'Intake could not confirm all requested changes.'} Do not retry this proposal.</strong><p>{resultFailure?.error ?? 'The result is partial or uncertain. Check the original Google Form before deciding what to do next.'}</p><div className="forms-links">{formLink(draft.current.editUrl, 'Check the original in Google Forms')}</div><label className="edit-confirm-check"><input type="checkbox" checked={checkedOriginal} disabled={busy !== null} onChange={event => setCheckedOriginal(event.target.checked)} /> I checked the original form and understand Intake will not retry this proposal.</label><button type="button" className="btn btn-ghost btn-sm" disabled={!checkedOriginal || busy !== null} onClick={onStartFresh}>Start a separate proposal</button></>}
      </div>}

      {draft.status === 'applied' && success && <div className="form-banner ok edit-success" role="status"><span className="forms-legend">03 / VERIFIED · ORIGINAL FORM UPDATED</span><strong>{success.title}</strong><p>Intake fetched the same Google Form after the update and verified every requested change. The form ID stayed {success.providerFormId}.</p><div className="forms-links">{formLink(success.responderUrl, 'Open responder form', true)}{formLink(success.editUrl, 'Open the updated form')}</div><button type="button" className="btn btn-ghost btn-sm" onClick={onStartFresh}>Edit another form →</button></div>}
    </section>

  </>;
}

function FailureNotice({ failure, onReload }: { failure: FormEditFailure; onReload?: () => void }) {
  const connection = shouldReconnect(failure);
  return <div className="form-banner warn draft-feedback edit-failure" role="alert"><strong>{connection ? 'Google connection needs attention' : failure.code === 'edit_stale' ? 'Review the latest form' : 'The edit request was not completed'}</strong><p>{failure.error}</p>{failure.issues && <ul className="forms-issues">{failure.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}{issue.hint && <em>{issue.hint}</em>}</li>)}</ul>}{connection && <a className="btn btn-ghost btn-sm" href="/app/connections">Reconnect Google →</a>}{onReload && <button type="button" className="btn btn-ghost btn-sm" onClick={onReload}>Check saved proposal</button>}{failure.requestId && <p className="forms-trace">Request {failure.requestId}</p>}</div>;
}
