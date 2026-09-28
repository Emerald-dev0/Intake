import { Nav, Hero } from './sections/Hero';
import { Problem } from './sections/Problem';
import { HowItWorks } from './sections/HowItWorks';
import { Showreel, Edits } from './sections/Showreel';
import { Playground } from './sections/Playground';
import { Logic } from './sections/Logic';
import { Where, Capabilities, Statement, FAQ, CTA, Footer } from './sections/Closing';
import { MCompare, MSteps, MWhere } from './mobile/MobileSections';
import { useIsMobile } from './lib/useIsMobile';

export default function App() {
  const mobile = useIsMobile();
  return (
    <>
      <div className="grain" aria-hidden />
      <Nav />
      <main>
        <Hero />
        {mobile ? (
          // Phone: one calm card per idea. The tap-through stories in the hero carry the demo.
          <>
            <MCompare />
            <MSteps />
            <Playground />
            <MWhere />
          </>
        ) : (
          <>
            <Problem />
            <HowItWorks />
            <Showreel />
            <Playground />
            <Logic />
            <Edits />
            <Where />
            <Capabilities />
          </>
        )}
        <Statement />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
