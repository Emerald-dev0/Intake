/**
 * Google Picker configuration.
 *
 * The Picker is Google's own file chooser, loaded in the browser. Three things have to be true
 * before it can open, and two of them come from the Google Cloud project rather than from code:
 *
 *  1. the **Google Picker API** is enabled in that project;
 *  2. an **API key** exists for it, restricted to this site and to that API;
 *  3. the browser holds an OAuth access token whose scope includes `drive.file`.
 *
 * Point 3 is the interesting one, because it decides whether this phase needs a new permission.
 * It does not. Google documents `drive.file` as covering "existing files that you open with an app
 * or that the user shares with an app while using the Google Picker API", and the Picker guide says
 * to obtain the view token with `drive.file`. Selecting a spreadsheet through the Picker *is* the
 * grant: from that moment Intake's existing `drive.file` grant reaches that one file, and nothing
 * else in anybody's Drive. So Phase D adds configuration, not scopes.
 *
 * The API key is not a secret — it ships to the browser, which is where the Picker runs — but it is
 * an identity, and it must be restricted by HTTP referrer in the Cloud console or anyone can spend
 * the project's quota with it. The refresh token never comes near this module: only a short-lived
 * access token is handed to the page, from the connection that is already encrypted in the database.
 *
 * Docs: https://developers.google.com/workspace/drive/picker/guides/web-picker
 */

/** The API Loader. The Picker library is loaded through it, not imported as a module. */
export const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';

/** The scope the Picker views require, and the one Intake already asks for. */
export const PICKER_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface PickerConfig {
  available: boolean;
  /** Public API key, restricted by referrer. Null when unset or malformed. */
  apiKey: string | null;
  /** The Cloud project number, which the Picker uses to reach the user's own files. */
  appId: string | null;
  /** Why the Picker cannot open, in a form the operator can act on. Null when it can. */
  problem: string | null;
}

/** Google API keys are `AIza` followed by 35 URL-safe characters. Anything else is a typo. */
const API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;

/** A Cloud project number: a run of digits. Not a project *id*, which is a string. */
const APP_ID = /^\d{6,20}$/;

export function readPickerConfig(env: NodeJS.ProcessEnv = process.env): PickerConfig {
  const apiKey = env.GOOGLE_PICKER_API_KEY?.trim() ?? '';
  const appId = env.GOOGLE_PICKER_APP_ID?.trim() ?? '';

  if (!apiKey) {
    return {
      available: false,
      apiKey: null,
      appId: null,
      problem: 'Choosing an existing spreadsheet needs GOOGLE_PICKER_API_KEY (a browser API key for the Google Picker API). Creating a new spreadsheet still works.',
    };
  }
  if (!API_KEY.test(apiKey)) {
    return {
      available: false,
      apiKey: null,
      appId: null,
      problem: 'GOOGLE_PICKER_API_KEY is not a Google API key (they start with AIza and are 39 characters long).',
    };
  }
  if (appId && !APP_ID.test(appId)) {
    return {
      available: false,
      apiKey: null,
      appId: null,
      problem: 'GOOGLE_PICKER_APP_ID must be the Google Cloud project number, not its name.',
    };
  }

  return { available: true, apiKey, appId: appId || null, problem: null };
}

/**
 * What the browser is allowed to see. Deliberately not the whole environment, and deliberately not
 * the OAuth client secret: the Picker needs an access token (handed out separately, per request)
 * and these two public values.
 */
export interface PickerPublicConfig {
  apiKey: string;
  appId: string | null;
  /** How long the token below stays usable, so the page can re-ask before it lapses. */
  tokenExpiresAt: string;
  accessToken: string;
}

/**
 * The token is only ever used to open the Picker, and only ever for one page. It is the same narrow
 * grant the server already holds — `drive.file` — so there is no escalation in handing it over,
 * and the refresh token stays where it has always been.
 */
export function publicPickerConfig(config: PickerConfig, token: { accessToken: string; expiresAt: string }): PickerPublicConfig {
  if (!config.available || !config.apiKey) throw new Error('picker_unavailable');
  return {
    apiKey: config.apiKey,
    appId: config.appId,
    accessToken: token.accessToken,
    tokenExpiresAt: token.expiresAt,
  };
}
