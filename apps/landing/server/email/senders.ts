/**
 * Which of Intake's three senders does Calder actually know about?
 *
 * This exists because of a specific, quiet failure. Calder resolves a bare `from` address by looking
 * for a sender identity in the project; if there is none it does **not** refuse the send — it passes
 * the message through unattributed (`senderIdentityId: null`, `displayName: null`) and delivers it
 * from the platform leg. Nothing errors. The message arrives, or does not, but:
 *
 *   - the recipient sees the display name registered in Calder, not the one in Intake's config;
 *   - the send is missing from that sender's counts, so "4 sent" next to a stream that says 5 is the
 *     only visible symptom;
 *   - a sender that exists but is `pending`/`disabled` fails the send later with `sender_not_ready`,
 *     which is indistinguishable from any other delayed failure if you never looked at the list.
 *
 * So the doctor asks Calder for the list and compares it with what this deployment is configured to
 * send as. Pure: no fetch, no env, no database, so the rules can be tested without a network.
 */

export type SenderRole = 'system' | 'team' | 'personal';

export interface ConfiguredSender {
  role: SenderRole;
  email: string;
  /** The name Intake labels this sender with. Recipients only see it if Calder agrees. */
  name: string;
}

export interface RegisteredSender {
  email: string;
  displayName: string | null;
  status: string;
}

export type SenderGap =
  | { kind: 'unregistered'; role: SenderRole; email: string }
  | { kind: 'not-ready'; role: SenderRole; email: string; status: string }
  | { kind: 'name-differs'; role: SenderRole; email: string; configuredName: string; providerName: string };

const USABLE = new Set(['verified', 'connected']);

const normalise = (value: string) => value.trim().toLowerCase();

const ROLE_LABEL: Record<SenderRole, string> = {
  system: 'system',
  team: 'team',
  personal: 'personal',
};

export function roleLabel(role: SenderRole): string {
  return ROLE_LABEL[role];
}

/**
 * One finding per configured address that Calder disagrees about.
 *
 * Addresses are deduplicated first: `team` falls back to the system address when
 * `CALDER_ANNOUNCEMENT_FROM_EMAIL` is unset, and reporting the same missing identity twice reads as
 * two problems. The first role that claims an address owns it.
 */
export function senderGaps(
  configured: readonly ConfiguredSender[],
  registered: readonly RegisteredSender[],
): SenderGap[] {
  const byEmail = new Map<string, RegisteredSender>();
  for (const sender of registered) byEmail.set(normalise(sender.email), sender);

  const seen = new Set<string>();
  const gaps: SenderGap[] = [];

  for (const sender of configured) {
    const email = normalise(sender.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);

    const match = byEmail.get(email);
    if (!match) {
      gaps.push({ kind: 'unregistered', role: sender.role, email });
      continue;
    }
    if (!USABLE.has(match.status)) {
      gaps.push({ kind: 'not-ready', role: sender.role, email, status: match.status });
      continue;
    }
    // A verified sender with no display name sends as a bare address, which is worth saying but is
    // not the failure this check is for.
    if (match.displayName && normalise(match.displayName) !== normalise(sender.name)) {
      gaps.push({
        kind: 'name-differs',
        role: sender.role,
        email,
        configuredName: sender.name,
        providerName: match.displayName,
      });
    }
  }

  return gaps;
}

/** The three senders a deployment is configured to send as, in the order the composer shows them. */
export function configuredSenders(config: {
  fromEmail: string;
  fromName: string;
  announcementFromEmail: string;
  announcementFromName: string;
  welcomeFromEmail: string;
  welcomeFromName: string;
}): ConfiguredSender[] {
  return [
    { role: 'system', email: config.fromEmail, name: config.fromName },
    { role: 'team', email: config.announcementFromEmail || config.fromEmail, name: config.announcementFromName },
    { role: 'personal', email: config.welcomeFromEmail, name: config.welcomeFromName },
  ];
}
