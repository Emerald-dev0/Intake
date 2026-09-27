import { Nav, Hero } from './sections/Hero';
import { Problem } from './sections/Problem';
import { HowItWorks } from './sections/HowItWorks';
import { Showreel, Edits } from './sections/Showreel';
import { Playground } from './sections/Playground';
import { Logic } from './sections/Logic';
import { Where, Capabilities, Statement, FAQ, CTA, Footer } from './sections/Closing';

export default function App() {
  return (
    <>
      <div className="grain" aria-hidden />
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Showreel />
        <Playground />
        <Logic />
        <Edits />
        <Where />
        <Capabilities />
        <Statement />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
