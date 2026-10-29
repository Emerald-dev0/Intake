import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DevFormBuilder } from './DevFormBuilder';
import { DevResponses } from './DevResponses';
import {
  ACTION_LABEL,
  availableActions,
  DevApiError,
  devApi,
  FORM_STATUS_LABEL,
  type DevForm,
  type DevFormDetail,
  type DevFormStatus,
  type DevProject,
} from '../lib/dev-api';

/**
 * The developer console.
 *
 * Projects, the forms inside them, and what can be done to a form right now. The console never
 * decides whether an action is allowed — it asks the server, and renders what the server says.
 * Every failure here is written in a sentence, because a developer staring at a 409 should not
 * have to guess what happened.
 */

function useAsync<T>(load: () => Promise<T>, deps: unknown[]): {
  state: { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed'; message: string };
  reload: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed'; message: string }>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void load()
      .then(value => { if (active) setState({ status: 'ready', value }); })
      .catch(error => {
        if (!active) return;
        const message = error instanceof DevApiError ? error.message : 'Intake could not load that just now.';
        setState({ status: 'failed', message });
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { state, reload: useCallback(() => setAttempt(value => value + 1), []) };
}

function StatusBadge({ status }: { status: DevFormStatus }) {
  return <span className={`dev-badge dev-badge--${status}`}>{FORM_STATUS_LABEL[status]}</span>;
}

/** Copies something and says so only when the clipboard really took it. */
function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="dev-button dev-button--quiet"
      onClick={async () => {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
          await navigator.clipboard.writeText(value);
          setState('copied');
        } catch {
          setState('failed');
        }
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed — select it' : label}
    </button>
  );
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="dev-note dev-note--error" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** The workspace: every project, and the forms inside it. */
export function DevelopersWorkspacePage() {
  const navigate = useNavigate();
  const projects = useAsync(() => devApi.listProjects(), []);
  const [formsByProject, setFormsByProject] = useState<Record<string, DevForm[]>>({});
  const [projectName, setProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [newFormFor, setNewFormFor] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState('');

  const loadForms = useCallback(async (projectIds: string[]) => {
    const entries = await Promise.all(
      projectIds.map(async id => {
        try {
          const detail = await devApi.getProject(id);
          return [id, detail.forms] as const;
        } catch {
          return [id, [] as DevForm[]] as const;
        }
      }),
    );
    setFormsByProject(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (projects.state.status !== 'ready') return;
    void loadForms(projects.state.value.map(project => project.id));
  }, [projects.state, loadForms]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    setCreatingProject(true);
    setProjectError('');
    try {
      await devApi.createProject({ name });
      setProjectName('');
      projects.reload();
    } catch (error) {
      setProjectError(error instanceof DevApiError ? error.message : 'That project could not be created.');
    } finally {
      setCreatingProject(false);
    }
  }

  async function createForm(event: React.FormEvent, projectId: string) {
    event.preventDefault();
    const name = formName.trim();
    if (!name) return;
    setFormError('');
    try {
      const detail = await devApi.createForm(projectId, { name });
      setFormName('');
      setNewFormFor(null);
      navigate(`/app/developers/forms/${detail.form.id}`);
    } catch (error) {
      setFormError(error instanceof DevApiError ? error.message : 'That form could not be created.');
    }
  }

  return (
    <div className="dev-console">
      <div className="page-heading page-heading--quiet">
        <span className="eyebrow">INTAKE FOR DEVELOPERS</span>
        <h1>Projects and forms.</h1>
        <p className="heading-description">
          A project holds forms. A form has its own address and its own lifecycle, and everything in
          here belongs to your account alone.
        </p>
      </div>

      <section className="dev-section" aria-labelledby="dev-new-project">
        <h2 id="dev-new-project" className="dev-section__title">New project</h2>
        <form className="dev-inline-form" onSubmit={createProject}>
          <label className="dev-field">
            <span>Name</span>
            <input
              type="text"
              value={projectName}
              maxLength={80}
              placeholder="Checkout app"
              onChange={event => setProjectName(event.target.value)}
            />
          </label>
          <button type="submit" className="dev-button" disabled={creatingProject || !projectName.trim()}>
            {creatingProject ? 'Creating…' : 'Create project'}
          </button>
        </form>
        {projectError && <ErrorNote message={projectError} />}
      </section>

      {projects.state.status === 'loading' && (
        <p className="dev-note" role="status">Loading your projects…</p>
      )}

      {projects.state.status === 'failed' && (
        <ErrorNote message={projects.state.message} onRetry={projects.reload} />
      )}

      {projects.state.status === 'ready' && projects.state.value.length === 0 && (
        <div className="dev-empty">
          <h2>No projects yet.</h2>
          <p>
            Make one above. A project is a container for forms — one per product, one per client, one
            per whatever you find natural.
          </p>
        </div>
      )}

      {projects.state.status === 'ready' && projects.state.value.map((project: DevProject) => (
        <section className="dev-section" key={project.id} aria-labelledby={`dev-project-${project.id}`}>
          <div className="dev-section__head">
            <h2 id={`dev-project-${project.id}`} className="dev-section__title">{project.name}</h2>
            <span className="dev-slug">/{project.slug}</span>
          </div>
          {project.description && <p className="dev-section__note">{project.description}</p>}

          {(formsByProject[project.id] ?? []).length === 0 ? (
            <p className="dev-note">No forms in this project yet.</p>
          ) : (
            <ul className="dev-list">
              {(formsByProject[project.id] ?? []).map(form => (
                <li key={form.id}>
                  <Link to={`/app/developers/forms/${form.id}`} className="dev-list__row">
                    <span className="dev-list__name">{form.name}</span>
                    <span className="dev-slug">/{form.slug}</span>
                    <StatusBadge status={form.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {newFormFor === project.id ? (
            <form className="dev-inline-form" onSubmit={event => createForm(event, project.id)}>
              <label className="dev-field">
                <span>Form name</span>
                <input
                  type="text"
                  value={formName}
                  maxLength={120}
                  placeholder="Waitlist"
                  onChange={event => setFormName(event.target.value)}
                />
              </label>
              <button type="submit" className="dev-button" disabled={!formName.trim()}>Create form</button>
              <button type="button" className="dev-button dev-button--quiet" onClick={() => { setNewFormFor(null); setFormError(''); }}>
                Cancel
              </button>
              {formError && <ErrorNote message={formError} />}
            </form>
          ) : (
            <button type="button" className="dev-button dev-button--quiet" onClick={() => { setNewFormFor(project.id); setFormError(''); }}>
              New form
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

/** One form: where it is, what is in it, and what can be done to it. */
export function DeveloperFormPage() {
  const { formId = '' } = useParams();
  const navigate = useNavigate();
  const detail = useAsync(() => devApi.getForm(formId), [formId]);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');

  const value = detail.state.status === 'ready' ? detail.state.value : null;
  const actions = useMemo(() => (value ? availableActions(value.form.status) : []), [value]);

  async function run(action: 'publish' | 'pause' | 'resume' | 'close' | 'reopen' | 'archive' | 'restore') {
    setBusy(action);
    setActionError('');
    try {
      if (action === 'publish') await devApi.publishForm(formId);
      else await devApi.applyAction(formId, action);
      detail.reload();
    } catch (error) {
      setActionError(error instanceof DevApiError ? error.message : 'That did not go through.');
    } finally {
      setBusy('');
    }
  }

  if (detail.state.status === 'loading') {
    return <p className="dev-note" role="status">Loading the form…</p>;
  }
  if (detail.state.status === 'failed') {
    return (
      <div className="dev-console">
        <ErrorNote message={detail.state.message} onRetry={detail.reload} />
        <button type="button" className="dev-button dev-button--quiet" onClick={() => navigate('/app/developers')}>
          Back to projects
        </button>
      </div>
    );
  }

  const { form, project, versions } = value as DevFormDetail;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const hostedUrl = `${origin}/forms/${project.slug}/${form.slug}`;
  const embedSnippet = `<iframe src="${origin}/embed/forms/${project.slug}/${form.slug}" title="${form.name}" style="width:100%;height:640px;border:0" loading="lazy"></iframe>`;

  return (
    <div className="dev-console">
      <Link to="/app/developers" className="dev-back">← All projects</Link>

      <div className="page-heading page-heading--quiet">
        <span className="eyebrow">{project.name} · /{project.slug}</span>
        <h1>{form.name}</h1>
        <p className="heading-description">
          <StatusBadge status={form.status} /> <span className="dev-slug">/{form.slug}</span>
        </p>
      </div>

      <section className="dev-section" aria-labelledby="dev-form-actions">
        <h2 id="dev-form-actions" className="dev-section__title">Lifecycle</h2>
        <div className="dev-actions">
          {actions.length === 0 && (
            <p className="dev-note">
              {form.status === 'draft'
                ? 'A draft is not public yet. Publish it once it has at least one field.'
                : 'Nothing to do here right now.'}
            </p>
          )}
          {actions.map(action => (
            <button
              key={action}
              type="button"
              className={`dev-button${action === 'archive' ? ' dev-button--quiet' : ''}`}
              disabled={busy !== ''}
              onClick={() => void run(action)}
            >
              {busy === action ? 'Working…' : ACTION_LABEL[action]}
            </button>
          ))}
        </div>
        {actionError && <ErrorNote message={actionError} />}
        <p className="dev-section__note">
          The state is enforced by the server, not by this page: pausing a form stops it accepting
          submissions the moment you click, with no change to your site.
        </p>
      </section>

      <section className="dev-section" aria-labelledby="dev-form-address">
        <h2 id="dev-form-address" className="dev-section__title">Where it lives</h2>
        {form.status === 'published' ? (
          <>
            <p className="dev-section__note">
              This form has a permanent address. It does not change when you edit the form, so a
              snippet pasted into a page keeps working.
            </p>
            <div className="dev-code">
              <code>{hostedUrl}</code>
              <CopyButton value={hostedUrl} />
            </div>
            <p className="dev-section__note">Or put it in your page:</p>
            <div className="dev-code dev-code--wrap">
              <code>{embedSnippet}</code>
              <CopyButton value={embedSnippet} label="Copy snippet" />
            </div>
          </>
        ) : (
          <p className="dev-section__note">
            A form gets its address when it is published. Until then there is nothing to paste into
            a page.
          </p>
        )}
      </section>

      <section className="dev-section" aria-labelledby="dev-form-fields">
        <h2 id="dev-form-fields" className="dev-section__title">Questions</h2>
        <DevFormBuilder detail={value as DevFormDetail} onSaved={() => detail.reload()} />
      </section>

      <section className="dev-section" aria-labelledby="dev-form-responses">
        <h2 id="dev-form-responses" className="dev-section__title">Answers</h2>
        <DevResponses
          formId={form.id}
          fields={(value as DevFormDetail).draftVersion?.definition.fields ?? (value as DevFormDetail).publishedVersion?.definition.fields ?? []}
        />
      </section>

      <section className="dev-section" aria-labelledby="dev-form-versions">
        <h2 id="dev-form-versions" className="dev-section__title">Versions</h2>
        <ul className="dev-list">
          {versions.map(version => (
            <li key={version.id}>
              <span className="dev-list__name">Version {version.version}</span>
              <span className={`dev-badge dev-badge--${version.state}`}>{version.state}</span>
            </li>
          ))}
        </ul>
        <p className="dev-section__note">
          A published version never changes. Editing a live form opens the next version, and the
          one people are answering stays exactly as it was.
        </p>
      </section>
    </div>
  );
}
