import type { FormProvider } from './connections';

/**
 * What Intake cannot change, per provider, in the words a person can act on.
 *
 * One source of truth, used in three places: the edit workspace (so the limit is visible before
 * someone asks for the impossible thing), the public trust page (so nobody discovers it after
 * signing up), and the server's own refusals (so the explanation a person sees when a proposal is
 * refused matches the one they were shown earlier).
 *
 * Every entry here is a limit Intake genuinely enforces in code. If a capability is added, the entry
 * must be removed in the same change — that is the point of keeping the text next to the rules.
 */

export interface EditLimit {
  /** Stable key; the server uses it to find the paragraph for a refusal. */
  key: 'delete' | 'retype' | 'reorder' | 'sections' | 'sharing' | 'media' | 'grading';
  title: string;
  detail: string;
}

export interface ProviderEditLimits {
  /** One sentence, shown first. */
  summary: string;
  limits: EditLimit[];
}

export const EDIT_LIMITS: Partial<Record<FormProvider, ProviderEditLimits>> = {
  typeform: {
    summary: 'Typeform edits rewrite the whole form, so Intake only offers changes it can verify — and refuses the three it cannot make without risking your answers.',
    limits: [
      {
        key: 'delete',
        title: 'Deleting a question',
        detail: 'Typeform cannot delete a question without deleting the answers already collected for it, and Intake is not allowed to read your responses — so it cannot tell you what would be lost. Delete it in Typeform, where the response count is visible.',
      },
      {
        key: 'retype',
        title: 'Changing a question’s type',
        detail: 'Typeform cannot change a question’s type in place: a retyped field behaves like a new field and orphans the answers already collected for it. Add the new question in Typeform and retire the old one there.',
      },
      {
        key: 'reorder',
        title: 'Reordering a form that uses logic',
        detail: 'Logic jumps point at specific fields, so the order is part of the flow. Intake will not reorder a form with logic jumps; change the order in Typeform and check the jump targets there.',
      },
    ],
  },
  google: {
    summary: 'Google Forms edits go through the Forms API, which cannot reach every part of a form. These are the changes Intake will not attempt.',
    limits: [
      {
        key: 'sections',
        title: 'Adding, deleting or moving questions on a form with section routing',
        detail: 'A routed form sends respondents to different sections by option. Re-ordering its items would silently change that path, so Intake refuses structural changes and asks you to make them in Google Forms.',
      },
      {
        key: 'sharing',
        title: 'Sharing, publishing and who can respond',
        detail: 'That lives in Google Drive permissions and Google Forms settings, outside the Forms API this connection holds. Set it in Google Forms.',
      },
      {
        key: 'media',
        title: 'Images, videos and question grading',
        detail: 'The editing connection does not carry media or quiz grading. Add those in Google Forms directly.',
      },
    ],
  },
};

export function editLimitsFor(provider: FormProvider): ProviderEditLimits | null {
  return EDIT_LIMITS[provider] ?? null;
}

/** The paragraph for one refusal, or a plain fallback if a provider has no entry. */
export function editLimitText(provider: FormProvider, key: EditLimit['key']): string | null {
  return EDIT_LIMITS[provider]?.limits.find(limit => limit.key === key)?.detail ?? null;
}
