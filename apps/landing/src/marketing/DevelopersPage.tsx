import { useState } from 'react';
import { HubShell } from './HubShell';
import { Reveal, SectionIntro } from './MarketingSections';
import { usePublicSession } from './usePublicSession';
import { SITE_URL } from '../content/site';

/**
 * The public Developers page.
 *
 * The honest version of a developer product page: every capability carries the state it is really
 * in. "Shipping" means it exists today. "Building" means it is being built and can be read about
 * in the changelog. "Not promised" means nobody should plan around it.
 *
 * The status of each row lives in `CAPABILITIES` below, so shipping a capability is a one-line
 * change here and a changelog entry — never a quiet upgrade of a promise.
 */

type CapabilityStatus = 'shipping' | 'building' | 'not-promised';

interface Capability {
  name: string;
  status: CapabilityStatus;
  detail: string;
}

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  shipping: 'Shipping',
  building: 'Building',
  'not-promised': 'Not promised',
};

const CAPABILITIES: Capability[] = [
  {
    name: 'Projects, forms and versions',
    status: 'shipping',
    detail: 'A project holds forms; a form holds versions. Editing a published form never rewrites the form your respondents already answered.',
  },
  {
    name: 'A hosted form page and an embed snippet',
    status: 'shipping',
    detail: 'Every published form gets a stable URL and a snippet you paste into your page. The form renders on its own, so it does not inherit anything from your CSS by accident.',
  },
  {
    name: 'The field types developers actually use',
    status: 'shipping',
    detail: 'Short and long text, email, number, dropdown, single and multiple choice, checkbox and date — with required flags, descriptions and sensible validation.',
  },
  {
    name: 'Submissions validated on the server',
    status: 'shipping',
    detail: 'Values are checked against the published version of the form, payloads are size-limited, requests are rate-limited, and a retry does not create a second response. The answers are stored; reading them comes with the inbox.',
  },
  {
    name: 'A response inbox with search, filters and CSV export',
    status: 'shipping',
    detail: 'Read responses without building an admin panel. The count comes from the database, not from a model, and the export has the same columns as the table.',
  },
  {
    name: 'Pause, close, reopen, archive and delete without a redeploy',
    status: 'shipping',
    detail: 'The public endpoint enforces the state of the form, so you can stop collecting answers from the console and leave your site untouched. A form that is still live has to be closed before it can be deleted, and deleting one asks you to type its address first.',
  },
  {
    name: 'AI summaries on the credits you already have',
    status: 'shipping',
    detail: 'Summarising a set of responses uses the same 20 daily credits as the rest of Intake, at three credits a summary. There is no second wallet and no separate currency, and the cost is shown before you run it.',
  },
  {
    name: 'Per-project usage you can look at',
    status: 'shipping',
    detail: 'Accepted submissions, rejected requests and payload sizes, per project and per period, so the cost of the workload is a number you can read.',
  },
  {
    name: 'Answer notices on your terms',
    status: 'shipping',
    detail: 'Ask to be emailed when a project has new answers — every N answers, or a daily digest. It is off until you turn it on, and it only ever goes to you.',
  },
  {
    name: 'A paid tier for developers',
    status: 'building',
    detail: 'The billing path is built — checkout, verified webhooks and the whole subscription lifecycle — but it is switched off. Nothing is charged today and no price is promised; if it opens, this page and the changelog will say so first.',
  },
  {
    name: 'Webhooks to your own backend',
    status: 'not-promised',
    detail: 'Signed delivery, retries and a delivery log do not exist. Nothing on this page should be read as a promise of a webhook endpoint, and there is no date to plan around.',
  },
  {
    name: 'A JavaScript SDK and API keys',
    status: 'not-promised',
    detail: 'The plain embed is the interface. An SDK would follow it, not replace it, and there is no API key to issue today.',
  },
];

const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: 'Does this replace my backend?',
    answer: 'No. Intake collects and stores the responses; your application still does whatever it does with them. Today that means reading them in the response inbox and exporting them as CSV. A webhook to your own backend is planned and is not available yet.',
  },
  {
    question: 'Will the embedded form look like my website?',
    answer: 'You set the colours, the background, the text colour, the border, the typeface and the corner radius as tokens on the form, and the embed uses them. What a cross-origin iframe cannot do is read your page’s CSS: an iframe pointing at intake.example cannot inherit your stylesheet, your fonts or your variables. That is a browser rule, not a setting — which is why the tokens exist.',
  },
  {
    question: 'What happens to a form I want to stop collecting from?',
    answer: 'You pause or close it in the console. The public endpoint enforces the state, so the form stops accepting submissions the moment you say so — no deployment, no change to your code.',
  },
  {
    question: 'Do you have an uptime guarantee?',
    answer: 'No. We are a small product and we would rather say so than print a number we cannot hold. What we do publish is the changelog, and what is in it is what actually shipped.',
  },
  {
    question: 'How are the AI summaries billed?',
    answer: 'With Intake’s own credits: 20 a day on the Free plan, refreshed at 00:00 UTC, and a Pro reserve on top. A summary that fails does not cost anything, and the cost is shown before you run it.',
  },
  {
    question: 'Is there a paid plan for the developer side?',
    answer: 'Not yet. The billing path is built and tested — checkout, verified webhooks, the whole subscription lifecycle — but it is switched off, so every developer is on the same Free plan with 20 credits a day and nothing is charged today. If it ever opens, this page and the changelog will say so first, and no price is promised here before that.',
  },
  {
    question: 'Is this the same Intake I already use for Google Forms?',
    answer: 'Same product, same account, same credits — a second capability. Intake still creates and edits forms in the Google Forms and Typeform accounts you connect. Intake for Developers is the hosted side: forms that live in Intake and are embedded in your own product.',
  },
];

function StatusChip({ status }: { status: CapabilityStatus }) {
  return (
    <span className={`mk-dev__status mk-dev__status--${status}`}>{STATUS_LABEL[status]}</span>
  );
}

function DeveloperFaq() {
  const [open, setOpen] = useState<string | null>(FAQ[0]?.question ?? null);
  return (
    <div className="mk-faq__list">
      {FAQ.map((item, index) => {
        const expanded = open === item.question;
        const id = `dev-faq-${index}`;
        return (
          <article className={`mk-faq-item${expanded ? ' is-open' : ''}`} key={item.question}>
            <h3>
              <button
                type="button"
                id={`${id}-button`}
                aria-expanded={expanded}
                aria-controls={`${id}-panel`}
                onClick={() => setOpen(expanded ? null : item.question)}
              >
                <span>{item.question}</span>
                <span className="mk-faq-item__icon" aria-hidden="true"><i /><i /></span>
              </button>
            </h3>
            <div className="mk-faq-item__panel" id={`${id}-panel`} role="region" aria-labelledby={`${id}-button`} inert={!expanded}>
              <div className="mk-faq-item__inner"><p>{item.answer}</p></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/**
 * The questions on the page, as structured data.
 *
 * It is the same array the page renders, so the two cannot drift: a crawler sees exactly what a
 * reader sees. No invented claims, no ratings, no reviews.
 */
function faqSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/developers#faq`,
    mainEntity: FAQ.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function DevelopersPage() {
  const authenticated = usePublicSession();
  return (
    <HubShell
      path="/developers"
      title="Intake for Developers — embed a form without building a form system"
      description="What developers stop building when a form is hosted by Intake: the renderer, the validation, the storage, the spam control, the exports. What exists today, what is being built, and what is not promised."
      eyebrow="INTAKE FOR DEVELOPERS"
      heading={<>Ship the form. Keep the form system out of your repo.</>}
      lede="Embedding a form in a product means owning a renderer, a validation layer, a storage table, a spam story, an export, and a dashboard — none of which is what your product is for. Intake for Developers is that layer, hosted, with your branding on it and a lifecycle you can change without touching your code."
      analyticsPath="/developers"
      schema={faqSchema()}
    >
      <section className="mk-section" aria-label="What you stop building">
        <div className="mk-container">
          <SectionIntro eyebrow="THE HONEST COST" title="What a form costs when you host it yourself" titleId="dev-cost">
            The work is not the markup. It is everything around the markup that nobody budgets for,
            and every one of them arrives the first time a real person submits something.
          </SectionIntro>
          <ul className="mk-dev__costs">
            {[
              ['A renderer that matches your design', 'Every field type, every state, every error message, on every screen size you support.'],
              ['Validation the server also agrees with', 'The client is a convenience; the server is the one that gets it wrong at 3am.'],
              ['Storage, retention and deletion', 'Who collected what, when, and how a subject asks for it to be removed.'],
              ['Spam and abuse controls', 'Rate limits, honeypots, and the cost of a bot farm pointed at your endpoint.'],
              ['Exports and a dashboard', 'CSV, pagination, filters, and counts that are right.'],
              ['A lifecycle', 'Pausing a form after it goes out of date, without a deploy.'],
            ].map(([title, detail]) => (
              <li key={title}>
                <strong>{title}</strong>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section" aria-label="What Intake for Developers provides">
        <div className="mk-container">
          <SectionIntro eyebrow="WHAT EXISTS" title="Every capability, and where it really is" titleId="dev-status">
            This board is the source of truth for what the developer product does. “Shipping” means it
            works today. “Building” means it is being built — watch the changelog. “Not promised” means
            do not plan around it.
          </SectionIntro>
          <ul className="mk-dev__capabilities">
            {CAPABILITIES.map(capability => (
              <li key={capability.name}>
                <div className="mk-dev__capability-head">
                  <h3>{capability.name}</h3>
                  <StatusChip status={capability.status} />
                </div>
                <p>{capability.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section" aria-label="How embedding works">
        <div className="mk-container">
          <SectionIntro eyebrow="THE EMBED" title="One URL, one snippet, your tokens" titleId="dev-embed">
            A published form gets a permanent address of its own. The embed is a plain iframe and a
            script tag; the form renders inside it, and your page does not have to change when the
            form does.
          </SectionIntro>
          <div className="mk-dev__grid">
            <Reveal variant="rise" className="mk-dev__card">
              <h3>Stable URL and snippet</h3>
              <p>
                Every published form keeps the same URL for its lifetime, so an embed pasted into a
                page keeps working. The snippet is copyable from the console, and there is nothing to
                install.
              </p>
            </Reveal>
            <Reveal variant="rise" className="mk-dev__card">
              <h3>Theme tokens, not inherited CSS</h3>
              <p>
                Primary colour, background, text, border, typeface and corner radius are set on the
                form and travel with the embed. Light, dark and system themes are supported, including
                a transparent background.
              </p>
            </Reveal>
            <Reveal variant="rise" className="mk-dev__card">
              <h3>What an iframe cannot do</h3>
              <p>
                An iframe pointing at another origin cannot read your page’s stylesheet, your CSS
                variables or your web fonts. Nothing about the embed can change that, so the theme is
                configuration rather than inheritance.
              </p>
            </Reveal>
            <Reveal variant="rise" className="mk-dev__card">
              <h3>Graceful when things break</h3>
              <p>
                Loading, validation errors, a closed form, a form that no longer exists and a network
                failure each get their own state, so an embedded form never shows an empty box.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="mk-section" aria-label="Responses and credits">
        <div className="mk-container">
          <SectionIntro eyebrow="THE RESPONSES" title="Read them, export them, summarise them" titleId="dev-responses">
            You should not need to build an admin panel to find out what people wrote. Counts come from
            the database, so they are exact; summaries come from a model, and are labelled as
            interpretations.
          </SectionIntro>
          <div className="mk-dev__grid">
            <Reveal variant="rise" className="mk-dev__card">
              <h3>An inbox, not a spreadsheet</h3>
              <p>Paginated, searchable, filterable, with the individual response in view and a CSV export when you want the lot.</p>
            </Reveal>
            <Reveal variant="rise" className="mk-dev__card">
              <h3>Counts that are counts</h3>
              <p>Totals, per-period volumes and rates come from SQL. Where a model is involved, the answer is marked as an interpretation, and the exact number is shown beside it.</p>
            </Reveal>
            <Reveal variant="rise" className="mk-dev__card">
              <h3>The same credits you already have</h3>
              <p>AI summaries run on Intake’s 20 daily credits — no second wallet, no separate plan, no conversion rate to memorise. The cost is shown before you confirm.</p>
            </Reveal>
            <Reveal variant="rise" className="mk-dev__card">
              <h3>Usage you can look at</h3>
              <p>Accepted submissions, rejected requests and payload sizes, per project and per period, so you can price the thing before you sell it.</p>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="mk-section" aria-label="Questions developers ask">
        <div className="mk-container">
          <SectionIntro eyebrow="THE SHORT ANSWERS" title="What developers ask first" titleId="dev-faq">
            The questions that decide whether a hosted form is worth the switch, answered without
            hedging.
          </SectionIntro>
          <DeveloperFaq />
        </div>
      </section>

      cta={
        <section className="mk-section" aria-label="Get started">
          <div className="mk-container mk-dev__cta">
            <Reveal variant="rise">
              <h2>The developer workspace is open.</h2>
              <p>
                {authenticated
                  ? 'It is in your console, beside Chat, Library and Connections. Make a project, build a form, and paste the snippet into your page.'
                  : 'Create an Intake account and the workspace is in your console straight away — the same account, the same 20 credits, the same sign-in you already use for the rest of Intake.'}
              </p>
              {authenticated ? (
                <a className="mk-button mk-button--primary" href="/app/developers">
                  <span>Open the workspace</span>
                </a>
              ) : (
                <a className="mk-button mk-button--primary" href="/auth/sign-up">
                  <span>Sign up free</span>
                </a>
              )}
              <p className="mk-dev__cta-note">
                <a href="/changelog">The changelog</a> says what shipped and when. The things that
                do not exist yet — webhooks to your own backend, an SDK — are named on this page as
                things you should not plan around.
              </p>
            </Reveal>
          </div>
        </section>
      }
    </HubShell>
  );
}
