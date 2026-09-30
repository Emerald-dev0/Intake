import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectionSummary } from '../Connections';
import { useWorkspace } from '../hooks/useWorkspace';

export function OverviewPage() {
  const { user, providers } = useWorkspace();
  const [idea, setIdea] = useState('');
  const navigate = useNavigate();
  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (idea.trim()) navigate('/app/forms', { state: { initialPrompt: idea.trim() } });
  }
  return <>
    <div className="page-heading"><div className="eyebrow">01 / YOUR WORKSPACE</div><p>Welcome, {user.name.split(' ')[0]}.</p><h1>What do you need<br />to <em>collect?</em></h1><div className="heading-description">Describe the form you want. Intake will propose questions and logic for you to review before anything is created in Google Forms.</div></div>
    <form className="prompt-card" onSubmit={start}><div className="prompt-top"><span><span className="rec" /> START A FORM</span><span>INTAKE / CREATE</span></div><label htmlFor="future-prompt">Start with an idea</label><textarea id="future-prompt" value={idea} onChange={event => setIdea(event.target.value)} maxLength={3000} required placeholder="e.g. A registration form for our conference, with name, email and transportation needs…" aria-describedby="prompt-note" /><div className="prompt-actions"><span id="prompt-note">You can refine it before it reaches Google. No JSON required.</span><button className="btn btn-accent" type="submit" disabled={!idea.trim()}>Review my form →</button></div></form>
    <div className="dashboard-grid"><section className="info-card"><span className="info-index">01 / CONNECT</span><div className="info-icon">◇</div><h2>Your tools, your forms.</h2><p>Authorize Google separately from your Intake login. A connection gives Intake permission to create forms in that account only after you confirm.</p><a href="/app/connections">{connectionSummary(providers.providers)} <span>↗</span></a></section><section className="info-card"><span className="info-index">02 / CREATE</span><div className="info-icon orange">✳</div><h2>Just say what you need.</h2><p>Intake turns your description into a proposed form. Review the questions, revise naturally and choose when to create the real form in your Google account.</p><a href="/app/forms">Open form creation <span>↗</span></a></section></div>
  </>;
}
