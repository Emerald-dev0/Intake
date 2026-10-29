import { useCallback, useEffect, useState } from 'react';
import { devApi, DevApiError, type DevField, type DevSubmission, type DevSubmissionPage } from '../lib/dev-api';

/**
 * The response inbox.
 *
 * The counts come from the database, not from a model and not from the number of rows that happen
 * to be on screen, so "12 responses" means twelve responses. The table shows the questions of the
 * form as columns, and the CSV file has the same columns, so what you read here is what you get
 * when you export it.
 */

const PAGE_SIZE = 25;

function formatAnswer(value: string | number | boolean | string[] | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function DevResponses({ formId, fields }: { formId: string; fields: DevField[] }) {
  const [page, setPage] = useState<DevSubmissionPage | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await devApi.listSubmissions(formId, { q: query, limit: PAGE_SIZE, offset });
      setPage(result);
      setState('ready');
      setError('');
    } catch (caught) {
      setError(caught instanceof DevApiError ? caught.message : 'The answers could not be loaded.');
      setState('failed');
    }
  }, [formId, query, offset]);

  useEffect(() => { void load(); }, [load]);

  // The search box fills in as you type; the list waits until you stop.
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setOffset(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const total = page?.total ?? 0;
  const shown = page?.items.length ?? 0;
  const lastPage = offset + shown >= total;

  return (
    <div className="dev-responses">
      <div className="dev-responses__toolbar">
        <label className="dev-field">
          <span>Search the answers</span>
          <input
            type="search"
            value={search}
            placeholder="A word somebody wrote"
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <a className="dev-button dev-button--quiet" href={devApi.submissionsCsvUrl(formId)} download>Export CSV</a>
      </div>

      {state === 'loading' && <p className="dev-note" role="status">Loading the answers…</p>}
      {state === 'failed' && (
        <div className="dev-note dev-note--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {state === 'ready' && page && (
        <>
          <p className="dev-note">
            {total === 0
              ? 'No answers yet.'
              : `${total} ${total === 1 ? 'answer' : 'answers'}${query ? ' matching your search' : ''}.`}
          </p>

          {total > 0 && (
            <div className="dev-table-wrap">
              <table className="dev-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    {fields.map(field => <th scope="col" key={field.id}>{field.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((submission: DevSubmission) => (
                    <tr key={submission.id}>
                      <td className="dev-table__when">{formatWhen(submission.submittedAt)}</td>
                      {fields.map(field => (
                        <td key={field.id}>{formatAnswer(submission.answers[field.id])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="dev-pager">
              <button type="button" className="dev-button dev-button--quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Newer
              </button>
              <span className="dev-note">
                {offset + 1}–{offset + shown} of {total}
              </span>
              <button type="button" className="dev-button dev-button--quiet" disabled={lastPage} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Older
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
