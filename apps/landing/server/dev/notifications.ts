/**
 * Telling a developer that their form has new answers.
 *
 * The rules:
 *
 * - **Opt-in.** The default is off, and nothing is sent until somebody chooses to be told.
 * - **Never a respondent.** These are notices to the owner about their own form. No email is ever
 *   written to somebody who filled the form in.
 * - **Idempotent.** The event id is worked out from the project and the number of answers already
 *   reported, so a repeated trigger is one email rather than two. The email service's own
 *   idempotency key makes that true even if the same event is fired twice.
 * - **Through the existing email system.** The same service, the same templates, the same delivery
 *   log, the same suppression list. There is no second mail path.
 */

import type { DevStore } from './contracts.js';
import type { EmailService } from '../email/service.js';

export interface DevNotifyUser {
  id: string;
  email: string;
  name: string | null;
}

export interface DevNotifierDeps {
  store: DevStore;
  emails: Pick<EmailService, 'send'>;
  /** The owner of a project, for the address the notice goes to. */
  user: (userId: string) => Promise<DevNotifyUser | null>;
  /** The public origin, so the link in the email is a real one. */
  publicOrigin: string;
  now?: () => Date;
  log?: (label: string, detail?: unknown) => void;
}

export interface DevNotifier {
  /**
   * Counts one new answer and sends a notice if the preference says one is due.
   *
   * It never throws: a notice that fails to send must not fail the answer that triggered it.
   */
  answersReceived(input: { projectId: string; userId: string; projectName: string; formName: string }): Promise<boolean>;
}

export function createDevNotifier(deps: DevNotifierDeps): DevNotifier {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  return {
    async answersReceived(input): Promise<boolean> {
      try {
        const preference = await deps.store.getNotificationPreference(input.userId, input.projectId);
        if (!preference || preference.mode === 'off') return false;

        const counted = await deps.store.addPendingAnswers(input.projectId, 1);
        const current = counted ?? preference;
        if (current.mode === 'off') return false;

        const stamp = now();
        let due = false;
        if (current.mode === 'threshold') {
          due = current.pending >= current.threshold;
        } else if (current.mode === 'digest') {
          // At most one a day.
          const last = current.lastSentAt ? current.lastSentAt.getTime() : 0;
          due = stamp.getTime() - last >= 24 * 60 * 60 * 1000;
        }
        if (!due) return false;

        const user = await deps.user(input.userId);
        if (!user) return false;

        // The event id carries the number of answers reported so far, so the same notice cannot be
        // sent twice even if the trigger fires again.
        const reported = current.pending;
        const eventId = `dev-answers:${input.projectId}:${reported}`;
        const outcome = await deps.emails.send({
          type: 'dev_answers_received',
          to: user.email,
          eventId,
          userId: user.id,
          variables: {
            userName: user.name ?? '',
            projectName: input.projectName,
            formName: input.formName,
            answerCount: String(reported),
            sinceLast: current.lastSentAt ? current.lastSentAt.toISOString().slice(0, 10) : '',
            dashboardUrl: `${deps.publicOrigin}/app/developers`,
          },
        });
        if (outcome.status !== 'sent') {
          log('dev notification skipped', { projectId: input.projectId, reason: outcome.status === 'skipped' ? outcome.reason : outcome.errorCode });
          return false;
        }

        // The counter resets only when the notice really went out.
        await deps.store.saveNotificationPreference({
          ...current,
          pending: 0,
          lastSentAt: stamp,
          updatedAt: stamp,
        });
        return true;
      } catch (error) {
        log('dev notification failed', error);
        return false;
      }
    },
  };
}
