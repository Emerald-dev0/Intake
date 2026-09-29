import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  EXAMPLE_SPECIFICATION_JSON,
  describeFailure,
  parseCreateFormResponse,
  parseFormList,
  type CreateFormResult,
  type FailureAction,
  type FormFailure,
  type FormStage,
  type PublicFormSummary,
} from '../lib/forms';
import type { PublicProvider } from '../lib/connections';
import type { ProviderLoad } from './Connections';

type Phase = 'idle' | 'creating' | 'done' | 'failed';
type Recent = { status: 'loading' | 'error' | 'ready'; forms: PublicFormSummary[] };

const MICROSOFT_REASON = 'Not available yet. Microsoft publishes no supported API for creating or editing forms, so Intake does not pretend to.';

/** Same wording as the Connections page, so the two screens never disagree about one account. */
function connectionLine(google: PublicProvider | undefined): string {
  if (!google) return 'Not connected';
  if (google.status === 'connected') return `Connected${google.accountEmail ? ` as ${google.accountEmail}` : ''}`;
  if (google.status === 'expired') return 'Expired';
  if (google.status === 'reauthorization_required') return 'Reconnect required';
  if (!google.configured) return 'Setup required';
  return 'Not connected';
}

// The request was sent but no answer was read. A form may or may not exist, and the page must not say otherwise.
const NETWORK_FAILURE: FormFailure = {
  error: 'Intake could not be reached, so the result is not known. If the request arrived, a form may have been created. Check Recent forms and Google Forms before trying again.',
  code: 'internal_error',
  requestId: '',
  outcome: 'unknown',
};

const STAGE_LABEL: Partial<Record<FormStage, string>> = {
  add_questions: 'adding the questions',
  configure_logic: 'setting up conditional logic',
  publish: 'publishing',
};

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
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
  useEffect(() => {
    void load();
  }, []);
  return { state, load };
}

function ProviderAction({ action }: { action: Exclude<FailureAction, null> }) {
  // The same authorization flow as the Connections screen: a plain form POST that redirects to Google.
  return (
    <form method="POST" action="/api/providers/google/connect">
      <button className="btn btn-accent btn-sm" type="submit">{action === 'connect' ? 'Connect Google Forms' : 'Reconnect Google'}</button>
    </form>
  );
}

function FormLink({ href, primary, children }: { href: string; primary?: boolean; children: string }) {
  return <a className={`btn ${primary ? 'btn-accent' : 'btn-ghost'} btn-sm`} href={href} target="_blank" rel="noreferrer">{children} <span aria-hidden>↗</span></a>;
}

export function Forms({ providers, reloadProviders }: { providers: ProviderLoad; reloadProviders: () => void }) {
  const [text, setText] = useState(EXAMPLE_SPECIFICATION_JSON);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<CreateFormResult | null>(null);
  const [jsonError, setJsonError] = useState('');
  const recent = useRecentForms();
  const alive = useAlive();
  const creating = phase === 'creating';

  const google = providers.providers?.find(provider => provider.id === 'google');
  const googleLine = !providers.providers
    ? providers.status === 'error' ? 'Connection status could not be loaded. Creating a form will still check it.' : 'Checking connection…'
    : connectionLine(google);
  // Advice only. The server decides on every request, so an out-of-date list here cannot let anything through.
  const notice: { action: Exclude<FailureAction, null> | null; text: string } | null = !google || google.status === 'connected'
    ? null
    : !google.configured && google.status === 'not_connected'
      ? { action: null, text: `Google is not set up on this Intake server, so it cannot be connected yet. The server needs ${google.setupEnv.join(' and ')}.` }
      : google.status === 'not_connected'
        ? { action: 'connect', text: 'Connect your Google account so Intake can create forms in it.' }
        : { action: 'reconnect', text: 'Your Google authorization has expired or was revoked. Reconnect to create forms.' };

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setJsonError('');
    let specification: unknown;
    try {
      specification = JSON.parse(text);
    } catch (error) {
      setResult(null);
      setPhase('idle');
      setJsonError(`This is not valid JSON${error instanceof SyntaxError ? `: ${error.message}` : ''}. Nothing was sent.`);
      return;
    }
    setPhase('creating');
    setResult(null);
    try {
      const response = await fetch('/api/forms', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', specification }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!alive.current) return;
      const parsed = parseCreateFormResponse(response.status, body);
      setResult(parsed);
      setPhase(parsed.ok ? 'done' : 'failed');
      if (parsed.ok || parsed.failure.partialForm) void recent.load();
      if (!parsed.ok && (parsed.failure.code === 'provider_not_connected' || parsed.failure.code === 'provider_reauthorization_required')) void reloadProviders();
    } catch {
      if (!alive.current) return;
      setResult({ ok: false, failure: NETWORK_FAILURE });
      setPhase('failed');
    }
  }

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">04 / FORMS · DEVELOPER PREVIEW</div>
        <h1>Create a form<br />from a <em>specification.</em></h1>
        <div className="heading-description">Choose a provider and enter a structured form specification. Intake checks it, then builds the form in your own Google account. Plain-language requests are a later release.</div>
      </div>

      {notice && phase !== 'failed' && (
        <div className="form-banner warn" role="status">
          <p>{notice.text}</p>
          {notice.action && <ProviderAction action={notice.action} />}
        </div>
      )}

      <form className="forms-panel" onSubmit={event => void create(event)} aria-busy={creating}>
        <fieldset className="forms-providers" disabled={creating}>
          <legend className="forms-legend">PROVIDER</legend>
          <label className="forms-option">
            <input type="radio" name="provider" value="google" checked readOnly />
            <span><strong>Google Forms</strong><small>{googleLine}</small></span>
          </label>
          <label className="forms-option unavailable">
            <input type="radio" name="provider" value="microsoft" disabled />
            <span><strong>Microsoft Forms</strong><small>{MICROSOFT_REASON}</small></span>
          </label>
        </fieldset>

        <label className="forms-legend" htmlFor="form-specification">FORM SPECIFICATION (JSON)</label>
        <textarea
          id="form-specification"
          className="forms-editor"
          value={text}
          onChange={event => setText(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={creating}
          aria-invalid={jsonError ? true : undefined}
          aria-describedby={jsonError ? 'spec-json-error spec-help' : 'spec-help'}
        />
        <p id="spec-help" className="forms-help">Question types: short_text, long_text, email, multiple_choice (one answer), dropdown, checkboxes. A question can be shown only when an earlier multiple_choice or dropdown has an exact answer, using <code>visibility</code>.</p>
        {jsonError && <p id="spec-json-error" className="forms-error" role="alert">{jsonError}</p>}

        <div className="forms-actions">
          <button className="btn btn-accent" type="submit" disabled={creating || !text.trim()}>{creating ? 'Creating your form…' : 'Create form'}</button>
          {creating && <span className="forms-progress" role="status">Google Forms is building it. This can take several seconds.</span>}
        </div>
        <p className="forms-help">Every click creates a new form in your Google account. Intake does not detect or reuse an earlier one.</p>
      </form>

      {result && <Outcome result={result} />}

      <section className="forms-recent" aria-labelledby="recent-forms-title">
        <h2 id="recent-forms-title" className="forms-legend">RECENT FORMS</h2>
        {recent.state.status === 'loading' && <p className="fine-print" role="status">Loading your forms…</p>}
        {recent.state.status === 'error' && (
          <div className="form-banner bad" role="alert">
            <p>Intake couldn’t load your recent forms. This does not mean they are gone.</p>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void recent.load()}>Try again</button>
          </div>
        )}
        {recent.state.status === 'ready' && recent.state.forms.length === 0 && <p className="fine-print">Forms you create here will be listed.</p>}
        {recent.state.forms.length > 0 && (
          <ul className="provider-list forms-list">
            {recent.state.forms.map(form => <RecentRow key={form.id} form={form} />)}
          </ul>
        )}
      </section>
    </>
  );
}

function Outcome({ result }: { result: CreateFormResult }) {
  if (result.ok) {
    const { form, warnings, requestId } = result;
    return (
      <div className="form-banner ok forms-result" role="status">
        <strong>Form created.</strong>
        <p>{form.title} {form.published ? 'is published in your Google account and accepting responses.' : 'was created in your Google account but is not accepting responses.'}</p>
        <div className="forms-links">
          {form.responderUrl && <FormLink href={form.responderUrl} primary>Open form</FormLink>}
          {form.editUrl && <FormLink href={form.editUrl}>Edit form</FormLink>}
        </div>
        {!form.responderUrl && <p className="provider-note">Google did not return a respondent link that Intake could verify. Use Edit form to find it in Google Forms.</p>}
        {form.id === null && <p className="provider-note">Intake could not save a record of this form, so it will not appear under Recent forms. The links above still work.</p>}
        {warnings.length > 0 && (
          <ul className="forms-issues" aria-label="Things to know">
            {warnings.map(warning => <li key={`${warning.code}:${warning.questionId ?? ''}`}>{warning.message}</li>)}
          </ul>
        )}
        {requestId && <p className="forms-trace">Request {requestId}</p>}
      </div>
    );
  }

  const { failure } = result;
  const view = describeFailure(failure);
  return (
    <div className={`form-banner ${view.tone === 'bad' ? 'bad' : 'warn'} forms-result`} role="alert">
      <strong>{view.heading}</strong>
      <p>{failure.error}</p>
      {failure.detail && <p className="provider-note">Google said: {failure.detail}</p>}
      {failure.issues && failure.issues.length > 0 && (
        <ul className="forms-issues" aria-label="What to fix">
          {failure.issues.map((issue, index) => (
            <li key={`${issue.code}:${issue.path}:${index}`}>
              <code>{issue.path || 'specification'}</code> {issue.message}
              {issue.hint && <em>{issue.hint}</em>}
            </li>
          ))}
        </ul>
      )}
      {failure.partialForm?.editUrl && (
        <div className="forms-links">
          <FormLink href={failure.partialForm.editUrl}>Open partly built form</FormLink>
        </div>
      )}
      {view.action && <ProviderAction action={view.action} />}
      {failure.requestId && <p className="forms-trace">Request {failure.requestId}</p>}
    </div>
  );
}

function RecentRow({ form }: { form: PublicFormSummary }) {
  const incomplete = form.status === 'incomplete';
  return (
    <li className="provider-row forms-row">
      <span className="provider-symbol" aria-hidden>G</span>
      <div className="provider-main">
        <div className="provider-title">
          <h3>{form.title}</h3>
          <span className={`status-pill ${incomplete ? 'warn' : 'ok'}`}>{incomplete ? 'Incomplete' : 'Published'}</span>
        </div>
        <p className="provider-note">Google Forms · {formatWhen(form.createdAt)}</p>
        {incomplete && <p className="provider-note">Stopped while {(form.failureStage && STAGE_LABEL[form.failureStage]) || 'building'}. It is not published and does not accept responses.</p>}
      </div>
      <div className="provider-actions">
        {form.responderUrl && <FormLink href={form.responderUrl} primary>Open form</FormLink>}
        {form.editUrl && <FormLink href={form.editUrl}>Edit form</FormLink>}
      </div>
    </li>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
