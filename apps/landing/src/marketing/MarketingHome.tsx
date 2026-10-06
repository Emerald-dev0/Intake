import { MarketingFooter, MarketingNav } from './MarketingChrome';
import { MarketingIndex } from './MarketingIndex';
import { MobileActionBar } from './MobileActionBar';
import {
  ControlSection,
  CreationDemo,
  DifferenceSection,
  EditingDemo,
  FAQSection,
  FinalCTA,
  GoogleConnection,
  Hero,
  HowItWorks,
  PricingSection,
} from './MarketingSections';
import { usePublicSession } from './usePublicSession';

export default function MarketingHome() {
  const authenticated = usePublicSession();

  return (
    <div className="marketing-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <MarketingNav authenticated={authenticated} />
      <MarketingIndex />
      <main id="main-content" tabIndex={-1}>
        <Hero authenticated={authenticated} />
        <DifferenceSection />
        <HowItWorks />
        <CreationDemo authenticated={authenticated} />
        <EditingDemo />
        <ControlSection />
        <GoogleConnection authenticated={authenticated} />
        <PricingSection authenticated={authenticated} />
        <FAQSection />
        <FinalCTA authenticated={authenticated} />
      </main>
      <MarketingFooter authenticated={authenticated} />
      <MobileActionBar authenticated={authenticated} />
    </div>
  );
}
