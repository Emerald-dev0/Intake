import { MarketingFooter, MarketingNav } from './MarketingChrome';
import { MarketingIndex } from './MarketingIndex';
import { MobileActionBar } from './MobileActionBar';
import {
  ComingSoonSection,
  CompareSection,
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
  ProofSection,
  TrustSection,
  UseCaseSection,
} from './MarketingSections';
import { usePublicSession } from './usePublicSession';
import { useSiteAnalytics } from '../lib/analytics';

export default function MarketingHome() {
  const authenticated = usePublicSession();
  useSiteAnalytics('/');

  return (
    <div className="marketing-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <MarketingNav authenticated={authenticated} />
      <MarketingIndex />
      <main id="main-content" tabIndex={-1}>
        <Hero authenticated={authenticated} />
        <DifferenceSection />
        <ProofSection />
        <CompareSection />
        <HowItWorks authenticated={authenticated} />
        <CreationDemo authenticated={authenticated} />
        <EditingDemo />
        <UseCaseSection authenticated={authenticated} />
        <ControlSection />
        <TrustSection />
        <GoogleConnection authenticated={authenticated} />
        <PricingSection authenticated={authenticated} />
        <ComingSoonSection />
        <FAQSection authenticated={authenticated} />
        <FinalCTA authenticated={authenticated} />
      </main>
      <MarketingFooter authenticated={authenticated} />
      <MobileActionBar authenticated={authenticated} />
    </div>
  );
}
