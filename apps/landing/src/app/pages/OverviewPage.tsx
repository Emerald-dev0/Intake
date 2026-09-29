import { connectionSummary } from '../Connections';
import { useWorkspace } from '../hooks/useWorkspace';

export function OverviewPage() {
  const { user, providers } = useWorkspace();
  return <>
    <div className="page-heading"><div className="eyebrow">01 / YOUR WORKSPACE</div><p>Welcome, {user.name.split(' ')[0]}.</p><h1>What do you need<br />to <em>collect?</em></h1><div className="heading-description">Describe the form you want to create. Plain-language requests are coming in a future release. Today you can create a Google Form from a structured specification.</div></div>
    <section className="prompt-card"><div className="prompt-top"><span><span className="rec" /> THE NEXT STEP</span><span>INTAKE / CREATE</span></div><label htmlFor="future-prompt">Start with an idea</label><textarea id="future-prompt" placeholder="e.g. A registration form for our conference, with name, email and transportation needs…" disabled aria-describedby="prompt-note" /><div className="prompt-actions"><span id="prompt-note">Describing a form in plain language is coming in a future release.</span><button className="btn btn-accent" disabled title="Plain-language form creation is not available yet">Create a form ↗</button></div></section>
    <div className="dashboard-grid"><section className="info-card"><span className="info-index">01 / CONNECT</span><div className="info-icon">◇</div><h2>Your tools, your forms.</h2><p>Authorize a Google or Microsoft account separately from this login. A connection is permission for that account. It is not created by signing in, and it does not create a form.</p><a href="/app/connections">{connectionSummary(providers.providers)} <span>↗</span></a></section><section className="info-card"><span className="info-index">02 / CREATE</span><div className="info-icon orange">✳</div><h2>Just say what you need.</h2><p>Intake will turn your request into an actual form on the platform you connect. Plain-language requests are coming in a future release. Until then, a developer preview creates a Google Form from a structured specification.</p><a href="/app/forms">Open the developer preview <span>↗</span></a></section></div>
  </>;
}
