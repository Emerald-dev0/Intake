import { Reveal } from './SectionHead';

/** Editorial use-case line shared by the desktop comparison and mobile comparison. */
export function Audience() {
  return (
    <Reveal className="audience">
      <span className="audience-k">WHO IT'S FOR / START WITH A QUESTION</span>
      <div className="audience-lead">
        <p>“I need a questionnaire for my <em>final-year project.</em>”</p>
        <span>You know what to ask. You shouldn't have to build every field by hand first.</span>
      </div>
      <div className="audience-line" aria-label="More ways people could use Intake">
        <span>Students <i>→</i> project questionnaires</span>
        <span>Researchers <i>→</i> surveys</span>
        <span>Event organizers <i>→</i> registrations</span>
        <span>Teachers &amp; lecturers <i>→</i> class questionnaires</span>
        <span>Small businesses <i>→</i> customer details</span>
        <span>Churches, clubs &amp; communities <i>→</i> sign-ups</span>
      </div>
    </Reveal>
  );
}
