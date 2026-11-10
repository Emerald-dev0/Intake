/**
 * Google Picker, loaded only when somebody asks to connect an existing spreadsheet.
 *
 * The Picker is Google's own file chooser: a dialog Google renders, listing Google's files, with
 * Google's search. Intake never lists a Drive folder, never enumerates files and never sees what the
 * person did not pick — the API returns one file, after a person chose it.
 *
 * That is also why `drive.file` is enough. Google documents it as reaching "existing files that you
 * open with an app or that the user shares with an app while using the Google Picker API": picking
 * is the grant. Nothing broader is requested for this screen.
 *
 * Icons come from Google, the dialog comes from Google; the token is handed over per request by the
 * server and lives in memory on this page. No refresh token is ever here.
 */

/** The API Loader. The Picker library is loaded through it, not imported as a module. */
export const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';

/** Only real Google spreadsheets can be chosen. Nothing else is a destination Intake can write. */
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** What the server hands the page: public key, project number, and a short-lived access token. */
export interface PickerToken {
  apiKey: string;
  appId: string | null;
  accessToken: string;
  tokenExpiresAt: string;
}

export type PickerOutcome =
  | { kind: 'picked'; spreadsheetId: string; name: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: 'not_configured' | 'token_expired' | 'load_failed' | 'picker_failed'; message: string };

/** The parts of `window.google` this file uses, so a test can supply its own. */
export interface PickerNamespace {
  picker: {
    PickerBuilder: new () => {
      addView(view: unknown): unknown;
      setOAuthToken(token: string): unknown;
      setDeveloperKey(key: string): unknown;
      setAppId(appId: string): unknown;
      setCallback(callback: (data: Record<string, unknown>) => void): unknown;
      enableFeature(feature: string): unknown;
      build(): { setVisible(visible: boolean): void };
    };
    DocsView: new (viewId?: string) => {
      setMimeTypes(types: string): unknown;
      setIncludeFolders?(include: boolean): unknown;
      setSelectFolderEnabled?(enabled: boolean): unknown;
    };
    ViewId: Record<string, string> & { SPREADSHEETS?: string };
    Response: { ACTION?: string; DOCUMENTS?: string };
    Action: { PICKED?: string; CANCEL?: string };
    Document: { ID?: string; NAME?: string; MIME_TYPE?: string };
    Feature: { SUPPORT_DRIVES?: string };
  };
}

/** `window.gapi`, which is what actually loads the library. `window.google.picker` appears after. */
export interface GapiNamespace {
  load?: (library: string, callback: () => void) => void;
}

export interface PickerDeps {
  /** `window.google`, or null before the library has been loaded through `gapi`. */
  getGoogle: () => PickerNamespace | null;
  /** `window.gapi`, the loader itself, or null before the script has run. */
  getGapi: () => GapiNamespace | null;
  /** Injects the API Loader and resolves when it has executed. */
  loadScript: (url: string) => Promise<void>;
  /** How long to wait for Google's library before giving up. */
  timeoutMs?: number;
}

const MESSAGES = {
  not_configured: 'Choosing an existing spreadsheet is not set up on this server. You can still create a new one.',
  token_expired: 'Intake’s Google access has expired. Reconnect Google Forms, then try again.',
  load_failed: 'Google’s file chooser did not load. Check your connection and try again — or create a new spreadsheet instead.',
  picker_failed: 'Google’s file chooser closed unexpectedly. Try again.',
} as const;

function failed(code: keyof typeof MESSAGES): PickerOutcome {
  return { kind: 'failed', code, message: MESSAGES[code] };
}

/** Default dependencies: the real script and the real `window.google`. */
export function browserPickerDeps(): PickerDeps {
  return {
    getGoogle: () => (typeof window === 'undefined' ? null : ((window as unknown as { google?: PickerNamespace }).google ?? null)),
    getGapi: () => (typeof window === 'undefined' ? null : ((window as unknown as { gapi?: GapiNamespace }).gapi ?? null)),
    loadScript: url => new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) {
        // The script may already have run (a second picker on the same page).
        if ((window as unknown as { gapi?: unknown }).gapi) { resolve(); return; }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('picker_script_failed')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('picker_script_failed'));
      document.head.appendChild(script);
    }),
    timeoutMs: 15_000,
  };
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    void work.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(onTimeout()); });
  });
}

/**
 * Open the Picker and wait for one decision: a spreadsheet, a cancel, or a failure.
 *
 * The token is checked before the dialog opens, because a Picker built with an expired token fails
 * in a way a person cannot act on. Everything Google reports back is read defensively: only an id
 * that looks like a spreadsheet id and a mime type that says spreadsheet is accepted.
 */
export async function openSpreadsheetPicker(config: PickerToken, deps: PickerDeps = browserPickerDeps()): Promise<PickerOutcome> {
  if (!config.apiKey || !config.accessToken) return failed('not_configured');
  const expiresAt = Date.parse(config.tokenExpiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return failed('token_expired');

  const timeoutMs = deps.timeoutMs ?? 15_000;

  let google = deps.getGoogle();
  if (!google?.picker) {
    try {
      await deps.loadScript(PICKER_SCRIPT_URL);
    } catch {
      return failed('load_failed');
    }

    // The loader is what knows how to fetch the picker library; `google.picker` exists only after
    // it has finished. `gapi.load` has no error channel, so a library that never arrives has to be
    // caught by waiting a bounded time instead of by a promise that never settles.
    const gapi = deps.getGapi();
    if (typeof gapi?.load !== 'function') return failed('load_failed');
    const loaded = await withTimeout(new Promise<boolean>(resolve => {
      try {
        gapi.load?.('picker', () => resolve(true));
      } catch {
        resolve(false);
      }
    }), timeoutMs, () => false);
    if (!loaded) return failed('load_failed');

    google = deps.getGoogle();
    if (!google?.picker) return failed('load_failed');
  }

  const namespace = google;
  const picker = namespace.picker;

  return new Promise<PickerOutcome>(resolve => {
    let settled = false;
    const finish = (outcome: PickerOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    try {
      const viewId = picker.ViewId?.SPREADSHEETS;
      const view = new picker.DocsView(viewId);
      // Belt and braces: the view is spreadsheets, and the mime filter says spreadsheets again, so a
      // folder or a document cannot arrive as a selection.
      (view.setMimeTypes as (types: string) => unknown)(SPREADSHEET_MIME);
      view.setIncludeFolders?.(false);
      view.setSelectFolderEnabled?.(false);

      let builder = new picker.PickerBuilder();
      builder = builder.addView(view) as typeof builder;
      builder = builder.setOAuthToken(config.accessToken) as typeof builder;
      builder = builder.setDeveloperKey(config.apiKey) as typeof builder;
      builder = builder.setCallback((data: Record<string, unknown>) => {
        const action = picker.Response?.ACTION;
        const documents = picker.Response?.DOCUMENTS;
        const current = action ? data[action] : undefined;

        if (current === picker.Action?.CANCEL) { finish({ kind: 'cancelled' }); return; }
        if (current !== picker.Action?.PICKED) return;

        const docs = documents ? data[documents] : null;
        const first = Array.isArray(docs) ? (docs[0] as Record<string, unknown> | undefined) : undefined;
        const id = first && picker.Document?.ID ? first[picker.Document.ID] : undefined;
        const name = first && picker.Document?.NAME ? first[picker.Document.NAME] : undefined;
        const mime = first && picker.Document?.MIME_TYPE ? first[picker.Document.MIME_TYPE] : undefined;

        // A selected folder, or anything that is not a spreadsheet, is a failed selection rather
        // than a destination. The server checks this too; the dialog should not offer it.
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(id) || (typeof mime === 'string' && mime !== SPREADSHEET_MIME)) {
          finish(failed('picker_failed'));
          return;
        }
        finish({ kind: 'picked', spreadsheetId: id, name: typeof name === 'string' ? name : 'Untitled spreadsheet' });
      }) as typeof builder;
      if (config.appId) builder = builder.setAppId(config.appId) as typeof builder;
      if (picker.Feature?.SUPPORT_DRIVES) builder = builder.enableFeature(picker.Feature.SUPPORT_DRIVES) as typeof builder;

      builder.build().setVisible(true);
    } catch {
      finish(failed('picker_failed'));
    }
  });
}
