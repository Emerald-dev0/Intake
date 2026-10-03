import { Reveal } from './SectionHead';

/** Editorial use-case line shared by the desktop comparison and mobile comparison. */
export function Audience() {
  return (
    <Reveal className="audience">
      <h3 className="audience-title">Who is Intake for?</h3>
      <span className="audience-k">START WITH A QUESTION</span>
      <div className="audience-lead">
        <p>“I need a questionnaire for my <em>final-year project.</em>”</p>
        <span>You know what to ask. You shouldn't have to build every field by hand first.</span>
      </div>
      <ul className="audience-line" aria-label="More ways people could use Intake">
        <li>Students <i>→</i> project questionnaires</li>
        <li>Researchers <i>→</i> surveys</li>
        <li>Event organizers <i>→</i> registrations</li>
        <li>Teachers &amp; lecturers <i>→</i> class questionnaires</li>
        <li>Small businesses <i>→</i> customer details</li>
        <li>Churches, clubs &amp; communities <i>→</i> sign-ups</li>
      </ul>
    </Reveal>
  );
}
