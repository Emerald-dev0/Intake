import { MarketingFooter, MarketingNav } from './MarketingChrome';
import { MarketingIndex } from './MarketingIndex';
import { MobileActionBar } from './MobileActionBar';
import { Hero } from './MarketingSections';
import {
  ControlTrustSection,
  CreateEditSection,
  FaqHomeSection,
  FinalBand,
  HowItWorksSection,
  PricingHomeSection,
  ProvidersSection,
  UpdatesSection,
  WhySection,
} from './HomeSections';
import { useSmoothScroll } from './useSmoothScroll';
import { usePublicSession } from './usePublicSession';
import { useSiteAnalytics } from '../lib/analytics';

export default function MarketingHome() {
  const authenticated = usePublicSession();
  useSiteAnalytics('/');
  useSmoothScroll();

  return (
    <div className="marketing-page">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <MarketingNav authenticated={authenticated} />
      <MarketingIndex />
      <main id="main-content" tabIndex={-1}>
        <Hero authenticated={authenticated} />
        <WhySection />
        <HowItWorksSection />
        <CreateEditSection authenticated={authenticated} />
        <ControlTrustSection />
        <ProvidersSection />
        <PricingHomeSection authenticated={authenticated} />
        <FaqHomeSection authenticated={authenticated} />
        <UpdatesSection />
        <FinalBand authenticated={authenticated} />
      </main>
      <MarketingFooter authenticated={authenticated} />
      <MobileActionBar authenticated={authenticated} />
    </div>
  );
}
