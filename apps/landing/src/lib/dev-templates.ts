/**
 * Starter sentences for the developer console.
 *
 * These are prompts, not forms. Pressing one puts the sentence in the box so it can be read,
 * changed and sent — the model writes the questions from there, exactly as it does for a
 * sentence the developer typed. Nothing is created until the developer presses the button.
 *
 * The list is deliberately small and plain: the forms people actually reach for. A login form
 * asks for an email address and a one-time code rather than a password, because a hosted form
 * collects answers — it does not hold a session, and it should never be the place a password
 * is typed.
 */

export interface DevFormTemplate {
  id: string;
  label: string;
  /** The sentence that lands in the box. */
  prompt: string;
}

export const DEV_FORM_TEMPLATES: DevFormTemplate[] = [
  {
    id: 'waitlist',
    label: 'Waitlist',
    prompt: 'a waitlist form: their name, their email address, and what they hope to use it for',
  },
  {
    id: 'feedback',
    label: 'Feedback',
    prompt: 'a feedback form: what worked, what did not, and one thing they would change',
  },
  {
    id: 'contact',
    label: 'Contact',
    prompt: 'a contact form: their name, their email address, and a message',
  },
  {
    id: 'sign-in',
    label: 'Sign-in',
    prompt: 'a sign-in form that asks for an email address and a one-time code',
  },
  {
    id: 'newsletter',
    label: 'Newsletter',
    prompt: 'a newsletter sign-up: their email address, and how often they want to hear from us',
  },
  {
    id: 'beta',
    label: 'Beta application',
    prompt: 'an application for our beta: their name, email address, what they are building and what they want from it',
  },
  {
    id: 'support',
    label: 'Support request',
    prompt: 'a support request: their email address, what broke, what they expected to happen and what they have already tried',
  },
  {
    id: 'booking',
    label: 'Booking',
    prompt: 'a booking form: their name, email address, which day they want and anything we should know first',
  },
  {
    id: 'rsvp',
    label: 'Event RSVP',
    prompt: 'an RSVP for our event: their name, email address, whether they can come, and how many people they are bringing',
  },
  {
    id: 'one-question',
    label: 'One question',
    prompt: 'a single question form with one long answer box',
  },
];
