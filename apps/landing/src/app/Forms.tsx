import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import {
  describeFailure, parseFormFailure,
  type CreateFormResult, type FormFailure, type FormStage, type PublicFormSummary,
} from '../lib/forms';
import { parseConfirmedResponse, parseDraftLoad, parseInterpretResponse, parseDraftList, type PublicDraft } from '../lib/drafts';
import {
  FORM_PROVIDERS, FORM_PROVIDER_ACCOUNTS, FORM_PROVIDER_LABELS, formProviderLabel, isFormProvider,
  type FormProvider, type PublicProvider,
} from '../lib/connections';
import { ProviderBadge, ProviderMark } from './components/ProviderBadge';
import { useRecentForms } from './hooks/useRecentForms';
import type { ProviderLoad } from './Connections';
import { FormEditWorkspace } from './FormEditWorkspace';
import { FormLibrary } from './FormLibrary';
import { useCredits } from './hooks/useCredits';
import { createOperationTracker } from '../lib/operation-id';
import { insufficientCreditsMessage, isInsufficientCredits, type PublicOperationCost } from '../lib/credits';
import { CreditCostPreview, OperationCostReceipt } from './components/CreditCostPreview';
import { DraftEditor } from './components/DraftEditor';
import { Preview } from './components/Preview';
import type { FormSpecification } from '../lib/specification';

type Busy = 'loading' | 'interpreting' | 'revising' | 'creating' | 'cancelling' | null;
type Pending = { mode: 'new' | 'revise'; request: string; question: string; answers: string };
/** Conversational thread entries. Interactive content (proposals, results) renders from live state;
    history entries carry just enough snapshot to read as a transcript. */
type ThreadEntry =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'intake'; kind: 'text'; text: string }
  | { id: number; role: 'intake'; kind: 'proposal'; draftId: string; version: number; title: string; questions: number }
  | { id: number; role: 'intake'; kind: 'result'; result: CreateFormResult }
  | { id: number; role: 'intake'; kind: 'failure'; failure: FormFailure; draftId: string | null };
const greetingEntry = (): ThreadEntry => ({ id: 0, role: 'intake', kind: 'text', text: 'Hi, I’m Intake. Describe the form you need — I’ll plan the questions, you review, and nothing is created until you say so.' });
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
/**
 * What to say when a confirmation response is lost. The likely-exists sentence names the provider
 * the draft targets, because "check Google Forms" is unhelpful advice for a Typeform draft.
 */
function networkFailure(provider: FormProvider): FormFailure {
  return {
  error: provider === 'google'
    ? 'Intake could not confirm the result. A Google Form may exist. Check your draft status, Recent forms and Google Forms before starting over. This draft will not be sent again if creation started.'
    : `Intake could not confirm the result. A Typeform form may exist. Check your draft status, Recent forms and Typeform before starting over. This draft will not be sent again if creation started.`,
  code: 'internal_error', requestId: '', outcome: 'unknown', retryable: false,
  } as FormFailure;
}
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

export function useDrafts() {
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; drafts: PublicDraft[] }>({ status: 'loading', drafts: [] });
  const alive = useAlive();
  async function load() {
    try {
      const response = await fetch('/api/forms/drafts', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('unavailable');
      const drafts = parseDraftList(await response.json());
      if (!drafts) throw new Error('invalid');
      if (alive.current) setState({ status: 'ready', drafts });
    } catch {
      if (alive.current) setState({ status: 'error', drafts: [] });
    }
  }
  useEffect(() => { void load(); }, []);
  return { state, load };
}

function FormLink({ href, primary, children }: { href: string; primary?: boolean; children: string }) {
  return <a className={`btn ${primary ? 'btn-accent' : 'btn-ghost'} btn-sm`} href={href} target="_blank" rel="noreferrer">{children} <span aria-hidden>↗</span></a>;
}

function connectionLine(provider: PublicProvider | undefined): string {
  if (!provider) return 'Not connected';
  if (provider.status === 'connected') return `Connected${provider.accountEmail ? ` as ${provider.accountEmail}` : ''}`;
  if (provider.status === 'expired') return 'Expired';
  if (provider.status === 'reauthorization_required') return 'Reconnect required';
  if (!provider.configured) return 'Setup required';
  return 'Not connected';
}

/**
 * Cold-start-aware POST. The free API tier sleeps after ~15 minutes idle and needs up to a
 * minute to wake: one attempt gets 75 seconds, and network failures, timeouts and 502/503/429
 * get exactly one automatic retry (all Intake mutations are idempotent — operation ids for
 * interpret/revise, version gating for confirm — so a retried submission can never double-apply
 * or double-charge). `onWake` fires when the first attempt looks like a sleeping server so the
 * thread can say so honestly instead of failing.
 */
async function post(
  path: string,
  data: unknown,
  options: { onWake?: () => void; retry?: boolean } = {},
): Promise<{ status: number; body: unknown }> {
  const asleep: (status: number) => boolean = status => status === 502 || status === 503 || status === 429;
  // Confirmation is never retried: creating a Google Form is the one irreversible action, and an
  // ambiguous drop must be checked by the user, not re-fired. Interpret/revise are model reads
  // under idempotency keys, so one wake retry is safe there.
  const attempts = options.retry ? 2 : 1;
  // A 502/503 with a readable Intake error body is a real answer, not a dropped connection: if the
  // retry gets the same answer, that answer is returned so the user sees "GROQ_API_KEY is missing"
  // or "Try again later" instead of a made-up network failure.
  let lastAnswer: { status: number; body: unknown } | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    // Never hold a test runner or a background tab hostage for an abandoned request.
    (timer as unknown as { unref?: () => void }).unref?.();
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(data),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!asleep(response.status)) return { status: response.status, body };
      lastAnswer = { status: response.status, body };
    } catch {
      // Network failure or timeout: fall through to the wake retry below.
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 1) options.onWake?.();
  }
  if (lastAnswer && lastAnswer.body !== null) return lastAnswer;
  throw new Error('Intake could not be reached after two attempts.');
}

export function Forms({ providers, reloadProviders, newChatNonce = 0 }: { providers: ProviderLoad; reloadProviders: () => void; newChatNonce?: number }) {
  const location = useLocation();
  const locationState = location.state as { initialPrompt?: unknown; mode?: unknown; initialRecordId?: unknown; provider?: unknown } | null;
  const initialPrompt = locationState?.initialPrompt;
  const [prompt, setPrompt] = useState(typeof initialPrompt === 'string' && initialPrompt.length <= 3000 ? initialPrompt : '');
  const seededProvider = locationState?.provider;
  const [provider, setProvider] = useState<FormProvider>(isFormProvider(seededProvider as string) ? seededProvider as FormProvider : 'google');
  const [pending, setPending] = useState<Pending | null>(null);
  const [thread, setThread] = useState<ThreadEntry[]>([greetingEntry()]);
  const threadSeq = useRef(1);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const seededDraftRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<PublicDraft | null>(null);
  const [draftId, setDraftId] = useState(savedId);
  const [busy, setBusy] = useState<Busy>(draftId ? 'loading' : null);
  const [waking, setWaking] = useState(false);
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
  const [editMode, setEditMode] = useState<'review' | 'edit' | 'preview'>('review');
  const recent = useRecentForms();
  const drafts = useDrafts();
  const alive = useAlive();
  const credits = useCredits();
  function pushEntry(entry: ThreadEntryInput) {
    const id = threadSeq.current++;
    setThread(previous => [...previous, { ...entry, id } as ThreadEntry]);
  }
  useEffect(() => {
    try { threadEndRef.current?.scrollIntoView?.({ block: 'end' }); } catch { /* headless or older engines */ }
  }, [thread, busy]);
  const seenNewChat = useRef(newChatNonce);
  useEffect(() => {
    if (seenNewChat.current === newChatNonce) return;
    seenNewChat.current = newChatNonce;
    reset();
    setSelectedEditRecordId(undefined);
    setWorkspaceMode('create');
  }, [newChatNonce]);
  // Stable idempotency keys for AI operations: one key per distinct submission.
  const operations = useRef(createOperationTracker()).current;
  const selectedProvider = providers.providers?.find(entry => entry.id === provider);
  /** The provider is fixed once a draft exists: the server planned that draft for one target. */
  const activeProvider: FormProvider = draft?.provider ?? provider;
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
        setProvider(parsed.draft.provider);
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
      if (alive.current) { setBusy(null); setWaking(false); }
    }
  }
  useEffect(() => { if (draftId) void loadDraft(draftId); }, []);

  /** Resolves true when the server answered (even with a clarification or refusal), false when the
      words could not be sent at all — in which case the composer keeps them for another try. */
  async function interpret(mode: 'new' | 'revise', request: string, clarification?: string): Promise<boolean> {
    if (busyRef.current || (mode === 'revise' && (!draft || draft.status !== 'ready'))) return true;
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
        mode === 'new' ? { provider: activeProvider, request, operationId, ...(clarification ? { clarification } : {}) }
          : { draftId: draft!.id, version: draft!.version, request, operationId, ...(clarification ? { clarification } : {}) },
        { retry: true, onWake: () => { if (alive.current) setWaking(true); } });
      if (!alive.current) return true;
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
        // The words go back in the composer: a refused or failed request is retryable, and retyping
        // a paragraph to try again is exactly the friction this page exists to remove.
        return false;
      }
    } catch {
      // The key is deliberately kept: if the server did process this submission, the retry cannot charge twice.
      if (alive.current) setFailure({ error: 'Intake could not confirm the interpretation result. No form was created by this step. If you were revising, check the draft status before trying again.', code: 'model_unavailable', requestId: '', outcome: 'not_created', retryable: true });
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) { setBusy(null); setWaking(false); }
    }
    return true;
  }

  /** Keep the person's words when nothing reached the server; the thread has the copy already. */
  function restorePrompt(text: string, sent: Promise<boolean>) {
    void sent.then(ok => { if (!ok && alive.current) setPrompt(current => current || text); });
  }
  function submitDescription(text: string) {
    pushEntry({ role: 'user', text });
    setPrompt('');
    restorePrompt(text, interpret('new', text));
  }
  function submitRevision(text: string) {
    pushEntry({ role: 'user', text });
    setPrompt('');
    restorePrompt(text, interpret('revise', text));
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
    restorePrompt(text, interpret(pending.mode, pending.request, combined));
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
      const { status, body } = await post('/api/forms/confirm', { draftId: draft.id, version: draft.version, confirm: true },
        { onWake: () => { if (alive.current) setWaking(true); } });
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
        const failure = networkFailure(activeProvider);
        setResult({ ok: false, failure });
        pushEntry({ role: 'intake', kind: 'result', result: { ok: false, failure } });
        setDraft(previous => previous && { ...previous, status: 'creating' });
        void recent.load();
      }
    } finally {
      busyRef.current = false;
      if (alive.current) { setBusy(null); setWaking(false); }
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
      if (alive.current) { setBusy(null); setWaking(false); }
    }
  }

  async function updateDraft(spec: FormSpecification) {
    if (busyRef.current || !draft || draft.status !== 'ready') return;
    busyRef.current = true;
    setBusy('revising');
    setFailure(null);
    try {
      const response = await fetch(`/api/forms/draft/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ version: draft.version, specification: spec, assumptions: draft.assumptions, warnings: draft.warnings }),
      });
      if (!alive.current) return;
      if (!response.ok) {
        const rejected = parseFormFailure(response.status, await response.json().catch(() => null));
        setFailure(rejected);
        return;
      }
      const data = await response.json();
      if (data.draft) {
        setDraft(data.draft);
        setDraftId(data.draft.id);
        remember(data.draft.id);
        setEditMode('review');
      }
    } catch {
      if (alive.current) setFailure({ error: 'Could not save your changes. Please try again.', code: 'storage_unavailable', requestId: '', outcome: 'not_created' });
    } finally {
      busyRef.current = false;
      if (alive.current) { setBusy(null); setWaking(false); }
    }
  }

  function reset() {
    setWaking(false);
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

  const providerName = FORM_PROVIDER_LABELS[activeProvider];
  const providerAccount = activeProvider === 'typeform' ? 'Typeform' : 'Google';
  const notice = selectedProvider && selectedProvider.status !== 'connected'
    ? !selectedProvider.configured && selectedProvider.status === 'not_connected'
      ? `${providerAccount} OAuth is not configured on this server. An operator must set ${selectedProvider.setupEnv.join(' and ')} before you can connect.`
      : selectedProvider.status === 'not_connected'
        ? `Connect ${providerAccount} separately from your Intake sign-in before you create a form. You can keep drafting meanwhile.`
        : `Your ${providerAccount} authorization needs renewing before you can create a form.`
    : null;
  const providerLine = !providers.providers
    ? providers.status === 'error' ? 'Connection status could not be loaded. Intake will verify it when you create.' : 'Checking connection…'
    : connectionLine(selectedProvider);
  const blocked = draft?.status === 'creating' || draft?.status === 'blocked';
  const finished = draft?.status === 'created';
  const typingText = waking
    ? 'Waking up the server — the free tier sleeps when idle and can take up to a minute. Holding on…'
    : busy === 'interpreting'
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
      ? `Anything you send now revises this draft. Nothing reaches ${providerName} until you create.`
      : 'A clear first draft is enough. You can make changes before anything is created.';
  function renderEntry(entry: ThreadEntry) {
    if (entry.role === 'user') return <div key={entry.id} className="msg msg-user">{entry.text}</div>;
    if (entry.kind === 'text') return <div key={entry.id} className="msg msg-intake">{entry.text}</div>;
    if (entry.kind === 'failure') {
      return <div key={entry.id} className="msg msg-intake msg-wide"><FailureNotice failure={entry.failure} provider={activeProvider} onReload={entry.draftId ? () => void loadDraft(entry.draftId as string) : undefined} /></div>;
    }
    if (entry.kind === 'result') {
      return <div key={entry.id} className="msg msg-intake msg-wide"><Outcome result={entry.result} provider={activeProvider} onContinueEditing={(providerFormId) => { setSelectedEditRecordId(providerFormId); setWorkspaceMode('edit'); }} /></div>;
    }
    const live = draft?.id === entry.draftId && draft?.version === entry.version && draft?.status === 'ready';
    if (!live || !draft) {
      return <div key={entry.id} className="msg msg-intake">Proposed “{entry.title}” — {entry.questions} {entry.questions === 1 ? 'question' : 'questions'} (superseded).</div>;
    }

    if (editMode === 'edit') {
      return <div key={entry.id} className="msg msg-intake msg-wide">
        <DraftEditor draft={draft.specification} onUpdate={updateDraft} onCancel={() => setEditMode('review')} disabled={busy !== null} />
        <div className="draft-review-actions">
          <button type="button" className="btn btn-accent" onClick={() => void confirm()} disabled={busy !== null}>{busy === 'creating' ? 'Creating your form…' : 'Create form →'}</button>
          <button type="button" className="draft-cancel" onClick={() => void cancel()} disabled={busy !== null}>{busy === 'cancelling' ? 'Discarding…' : 'Cancel'}</button>
        </div>
        <p className="forms-help">Nothing has been sent to {providerName} yet. Creating requires your confirmation.</p>
      </div>;
    }

    if (editMode === 'preview') {
      return <div key={entry.id} className="msg msg-intake msg-wide">
        <Preview spec={draft.specification} onClose={() => setEditMode('review')} onEdit={() => setEditMode('edit')} />
        <div className="draft-review-actions">
          <button type="button" className="btn btn-accent" onClick={() => void confirm()} disabled={busy !== null}>{busy === 'creating' ? 'Creating your form…' : 'Create form →'}</button>
          <button type="button" className="draft-cancel" onClick={() => void cancel()} disabled={busy !== null}>{busy === 'cancelling' ? 'Discarding…' : 'Cancel'}</button>
        </div>
        <p className="forms-help">Nothing has been sent to {providerName} yet. Creating requires your confirmation.</p>
      </div>;
    }

    return <div key={entry.id} className="msg msg-intake msg-wide">
      <Review draft={draft} operationCost={operationCost} />
      <div className="draft-review-actions">
        <button type="button" className="btn btn-accent" onClick={() => void confirm()} disabled={busy !== null}>{busy === 'creating' ? 'Creating your form…' : 'Create form →'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditMode('edit')} disabled={busy !== null}>Edit questions</button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditMode('preview')} disabled={busy !== null}>Preview</button>
        <button type="button" className="draft-cancel" onClick={() => void cancel()} disabled={busy !== null}>{busy === 'cancelling' ? 'Discarding…' : 'Cancel'}</button>
      </div>
      <p className="forms-help">Nothing has been sent to {providerName} yet. Creating requires your confirmation, and this draft can only be submitted once.</p>
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
    {thread.length <= 1 && draft === null && !pending && <div className="chat-intro">
      <h1>Describe it. <em>Make it real.</em></h1>
      <p>Tell Intake what you need to collect. Review what it understood, then choose when to create the real form — it lives in your own Google or Typeform account.</p>
    </div>}

    <section className="draft-provider" aria-label="Form provider">
      <ProviderBadge provider={activeProvider} />
      <div className="draft-provider__status"><small>{providerLine}</small></div>
      <span className="draft-provider-note">{activeProvider === 'google' ? 'FORMS LIVE IN YOUR GOOGLE ACCOUNT' : 'FORMS LIVE IN YOUR TYPEFORM ACCOUNT'}</span>
    </section>
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
      {!draft && !pending && <div className="composer-target" role="group" aria-label="Create the form in">
        <span className="composer-target__label">Create in</span>
        {FORM_PROVIDERS.map(option => {
          const connection = providers.providers?.find(entry => entry.id === option);
          const state = connection ? connectionLine(connection) : 'Checking connection…';
          return <button
            key={option}
            type="button"
            className={`composer-target__option ${option === provider ? 'selected' : ''}`}
            aria-pressed={option === provider}
            onClick={() => setProvider(option)}
            disabled={busy !== null}
            title={state}
          >
            <ProviderMark provider={option} />
            {FORM_PROVIDER_LABELS[option]}
            {connection && connection.status !== 'connected' && <span className="composer-target__dot" aria-label="Not connected" />}
          </button>;
        })}
      </div>}
      <label className="sr-only" htmlFor="form-request">{composerLabel}</label>
      <textarea id="form-request" className="draft-input" placeholder={composerPlaceholder} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={3000} required disabled={busy !== null} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
        }
      }} />
      <div className="draft-input-foot"><span>{composerHint}</span><span>{prompt.length} / 3000</span></div>
      <div className="forms-actions">
        <button className="btn btn-accent" type="submit" disabled={busy !== null || !prompt.trim()}>{busy !== null ? 'Working…' : composerAction}</button>
        {pending && <button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => setPending(null)}>Dismiss question</button>}
      </div>
    </form>
    {!draft && thread.length <= 1 && <div className="draft-example"><span>NEED A STARTING POINT?</span><button type="button" onClick={() => setPrompt(EXAMPLE)} disabled={busy !== null}>Use a registration example ↗</button></div>}
    {finished && <button className="btn btn-ghost draft-start-again" type="button" onClick={reset}>Start another form →</button>}

    {blocked && draft && <div className="form-banner warn draft-feedback" role="alert"><strong>Do not create this draft again.</strong><p>{draft.status === 'creating' ? 'Creation was started, but Intake has not confirmed its outcome. It may still be running. Check Recent forms and Google Forms before starting a new draft.' : 'The creation attempt had a partial or uncertain outcome. Check the result and Google Forms; Intake will not submit this draft again.'}</p><div className="draft-recovery-actions"><button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={() => void loadDraft(draft.id)}>Check draft status</button><button className="btn btn-ghost btn-sm" type="button" disabled={busy !== null} onClick={reset}>Start a different form after checking {FORM_PROVIDER_ACCOUNTS[activeProvider]} →</button></div></div>}

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

    <section className="forms-drafts" aria-labelledby="drafts-title">
      <h2 id="drafts-title" className="forms-legend" style={{ margin: 0 }}>SAVED DRAFTS</h2>
      {drafts.state.status === 'loading' && <p className="fine-print" role="status">Loading your drafts…</p>}
      {drafts.state.status === 'error' && <div className="form-banner bad" role="alert"><p>Intake couldn't load your saved drafts.</p><button className="btn btn-ghost btn-sm" type="button" onClick={() => void drafts.load()}>Try again</button></div>}
      {drafts.state.status === 'ready' && drafts.state.drafts.length === 0 && <p className="fine-print">Drafts you save will appear here. They persist across sessions.</p>}
      {drafts.state.drafts.length > 0 && (
        <ul className="provider-list drafts-list">
          {drafts.state.drafts.filter(d => d.status === 'ready').map(draft => (
            <li key={draft.id} className="provider-row drafts-row">
              <span className="provider-symbol" aria-hidden>✎</span>
              <div className="provider-main">
                <div className="provider-title">
                  <h3>{draft.specification.title}</h3>
                  <span className="status-pill ok">{draft.specification.questions.length} question{draft.specification.questions.length !== 1 ? 's' : ''}</span>
                </div>
                <p className="provider-note">Updated {formatWhen(draft.updatedAt)} · v{draft.version}</p>
              </div>
              <div className="provider-actions">
                <button type="button" className="btn btn-accent btn-sm" onClick={() => void loadDraft(draft.id)} disabled={busy !== null}>Resume</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadDraft(draft.id)} disabled={busy !== null}>View</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
    <p className="draft-boundary">Google Forms and Typeform are supported creation targets. {MICROSOFT_REASON} Intake never hosts responses.</p>
  </>;
}

function Review({ draft, operationCost }: { draft: PublicDraft; operationCost: PublicOperationCost | null }) {
  const { specification: spec } = draft;
  const providerName = FORM_PROVIDER_LABELS[draft.provider];
  const controllers = new Map(spec.questions.map(question => [question.id, question.title]));
  return <section className="draft-review" aria-labelledby="review-title"><div className="draft-review-head"><div><span className="forms-legend">02 / WHAT INTAKE UNDERSTOOD</span><h2 id="review-title">{spec.title}</h2>{spec.description && <p className="draft-description">{spec.description}</p>}</div><span className="status-pill ok">{draft.status === 'ready' ? 'DRAFT · NOT CREATED' : draft.status === 'created' ? 'CREATED' : 'CREATION ATTEMPTED'}</span></div>
    <div className="draft-review-meta"><span>{spec.questions.length} {spec.questions.length === 1 ? 'QUESTION' : 'QUESTIONS'}</span><span>{providerName.toUpperCase()}</span>{spec.questions.some(question => question.visibility) && <span>SECTION ROUTING</span>}</div>
    <OperationCostReceipt receipt={operationCost} />
    <ol className="draft-items">{spec.questions.map((question, index) => {
      const condition = question.visibility?.when;
      const previous = spec.questions[index - 1]?.visibility?.when;
      const beginsSection = condition && (condition.question !== previous?.question || condition.equals !== previous?.equals);
      const resumes = !condition && !!previous;
      return <li key={question.id}>{(beginsSection || resumes) && <div className="draft-section-marker">{beginsSection ? `ROUTING SECTION · SHOW IF “${controllers.get(condition.question) ?? condition.question}” = “${condition.equals}”` : 'NEXT SECTION · EVERYONE ELSE CONTINUES'}</div>}
        <div className="draft-item"><span className="draft-number">{String(index + 1).padStart(2, '0')}</span><div className="draft-item-body"><div className="draft-item-title"><h3>{question.title}</h3><span className={question.required ? 'draft-required' : 'draft-optional'}>{question.required ? 'Required' : 'Optional'}</span></div><p className="draft-kind">{TYPE_LABEL[question.type]}</p>{question.description && <p className="draft-description">{question.description}</p>}{question.options && <ul className="draft-options">{question.options.map(option => <li key={option}>{option}</li>)}</ul>}{condition && <p className="draft-condition">Shown when “{controllers.get(condition.question) ?? condition.question}” is “{condition.equals}” · routing is applied by {providerName}</p>}</div></div>
      </li>;
    })}</ol>
    {(draft.assumptions.length > 0 || draft.warnings.length > 0) && <aside className="draft-notes"><span className="forms-legend">BEFORE YOU CREATE</span>{draft.assumptions.length > 0 && <div><strong>Assumptions</strong><ul>{draft.assumptions.map((note, index) => <li key={`${index}:${note}`}>{note}</li>)}</ul></div>}{draft.warnings.length > 0 && <div><strong>{providerName} limitations</strong><ul>{draft.warnings.map(note => <li key={`${note.code}:${note.questionId ?? ''}`}>{note.message}</li>)}</ul></div>}</aside>}
  </section>;
}

function FailureNotice({ failure, provider, onReload }: { failure: FormFailure; provider?: FormProvider; onReload?: () => void }) {
  const view = describeFailure(failure, provider);
  return <div className={`form-banner ${view.tone === 'bad' ? 'bad' : 'warn'} draft-feedback`} role="alert"><strong>{view.heading}</strong><p>{failure.error}</p>{failure.issues && <ul className="forms-issues">{failure.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}{issue.hint && <em>{issue.hint}</em>}</li>)}</ul>}{view.action && <a className="btn btn-ghost btn-sm" href="/app/connections">View connections →</a>}{onReload && <button type="button" className="btn btn-ghost btn-sm" onClick={onReload}>Check draft status</button>}{failure.requestId && <p className="forms-trace">Request {failure.requestId}</p>}</div>;
}

function Outcome({ result, provider, onContinueEditing }: { result: CreateFormResult; provider?: FormProvider; onContinueEditing?: (providerFormId: string) => void }) {
  if (result.ok) {
    const { form, warnings, requestId } = result;
    const target = isFormProvider(form.provider as string) ? form.provider as FormProvider : provider ?? 'google';
    const providerName = FORM_PROVIDER_LABELS[target];
    const account = target === 'typeform' ? 'Typeform' : 'Google';
    return <div className="form-banner ok forms-result draft-result" role="status"><span className="forms-legend">03 / READY TO SHARE</span><strong>Form created.</strong><p>{form.title} {form.published ? `is published in your ${account} account and accepting responses.` : `was created in your ${account} account but is not accepting responses.`}</p><div className="forms-links">{form.responderUrl && <FormLink href={form.responderUrl} primary>Open form</FormLink>}{form.editUrl && <FormLink href={form.editUrl}>Edit form</FormLink>}</div>{!form.responderUrl && <p className="provider-note">{providerName} did not return a respondent link that Intake could verify. Use Edit form to find it in {providerName}.</p>}{form.id === null && <p className="provider-note">Intake could not save a record of this form, so it will not appear under Recent forms. The links above still work.</p>}{warnings.length > 0 && <ul className="forms-issues" aria-label="Things to know">{warnings.map(warning => <li key={`${warning.code}:${warning.questionId ?? ''}`}>{warning.message}</li>)}</ul>}{requestId ? (
      <>
        <p className="forms-trace">Request {requestId}</p>
        {target === 'google' && <button className="btn btn-accent btn-sm mt-2" onClick={() => onContinueEditing?.(form.providerFormId)}>Continue editing in Intake →</button>}
      </>
    ) : null}</div>;
  }
  const { failure } = result;
  const view = describeFailure(failure, provider);
  return <div className={`form-banner ${view.tone === 'bad' ? 'bad' : 'warn'} forms-result`} role="alert"><strong>{view.heading}</strong><p>{failure.error}</p>{failure.issues && <ul className="forms-issues" aria-label="What to fix">{failure.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}{issue.hint && <em>{issue.hint}</em>}</li>)}</ul>}{failure.partialForm?.editUrl && <div className="forms-links"><FormLink href={failure.partialForm.editUrl}>Open partly built form</FormLink></div>}{view.action && <a className="btn btn-ghost btn-sm" href="/app/connections">View connections →</a>}{failure.requestId && <p className="forms-trace">Request {failure.requestId}</p>}</div>;
}

function RecentRow({ form }: { form: PublicFormSummary }) {
  const incomplete = form.status === 'incomplete';
  const owner = formProviderLabel(form.provider);
  return <li className="provider-row forms-row"><ProviderMark provider={form.provider} /><div className="provider-main"><div className="provider-title"><h3>{form.title}</h3><span className={`status-pill ${incomplete ? 'warn' : 'ok'}`}>{incomplete ? 'Incomplete' : 'Published'}</span></div><p className="provider-note">{owner} · {formatWhen(form.createdAt)}</p>{incomplete && <p className="provider-note">Stopped while {(form.failureStage && STAGE_LABEL[form.failureStage]) || 'building'}. It is not published and does not accept responses.</p>}</div><div className="provider-actions">{form.responderUrl && <FormLink href={form.responderUrl} primary>Open form</FormLink>}{form.editUrl && <FormLink href={form.editUrl}>Edit form</FormLink>}</div></li>;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
