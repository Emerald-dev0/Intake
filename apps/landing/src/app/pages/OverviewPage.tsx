import { useOutletContext } from 'react-router-dom';
import type { User } from '../../lib/api';

export function OverviewPage() {
  const { name } = useOutletContext<User>();
  return <>
    <div className="page-heading"><div className="eyebrow">01 / YOUR WORKSPACE</div><p>Welcome, {name.split(' ')[0]}.</p><h1>What do you need<br />to <em>collect?</em></h1><div className="heading-description">Describe the form you want to create. Intake will build it in your connected form platform when this feature launches.</div></div>
    <section className="prompt-card"><div className="prompt-top"><span><span className="rec" /> THE NEXT STEP</span><span>INTAKE / CREATE</span></div><label htmlFor="future-prompt">Start with an idea</label><textarea id="future-prompt" placeholder="e.g. A registration form for our conference, with name, email and transportation needs…" disabled aria-describedby="prompt-note" /><div className="prompt-actions"><span id="prompt-note">Form creation is coming in a future release.</span><button className="btn btn-accent" disabled title="Form creation is not available yet">Create a form ↗</button></div></section>
    <div className="dashboard-grid"><section className="info-card"><span className="info-index">01 / CONNECT</span><div className="info-icon">◇</div><h2>Your tools, your forms.</h2><p>Later, you’ll be able to authorize a Google or Microsoft account separately from your Intake login. Forms will live in your own account.</p><a href="/app/connections">About connections <span>↗</span></a></section><section className="info-card"><span className="info-index">02 / CREATE</span><div className="info-icon orange">✳</div><h2>Just say what you need.</h2><p>Intake will turn your request into an actual form on the platform you connect. No new form builder to learn.</p><span className="soon-label">COMING IN A FUTURE RELEASE</span></section></div>
  </>;
}
