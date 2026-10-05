import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../lib/plans.ts';

const comparison = proPriceComparison();

export const PRICING_TITLE = 'Intake Pricing — Free and Pro Plans';
export const PRICING_DESCRIPTION = `Free is $0 with ${PLAN_CATALOG.free.dailyCredits} daily AI credits. Pro is ${formatUsd(comparison.monthlyCents)} per month or ${formatUsd(comparison.annualCents)} per year with ${PLAN_CATALOG.pro.monthlyCredits} monthly credits. Payments are not available yet.`;

/** Shared by the visible pricing page, its crawlable fallback and pricing structured data. */
export const PRICING_FAQS = [
  {
    question: 'How much does Intake cost?',
    answer: `Free is $0. Pro is ${formatUsd(comparison.monthlyCents)} per month or ${formatUsd(comparison.annualCents)} per year. Annual billing saves ${formatUsd(comparison.annualSavingsCents)} compared with twelve monthly payments. Checkout is not available yet.`,
  },
  {
    question: 'What does Pro add?',
    answer: `Pro has ${PLAN_CATALOG.pro.dailyCredits} daily AI credits plus ${PLAN_CATALOG.pro.monthlyCredits} monthly credits. The supported form workflows and provider limits are the same as Free; Pro does not include priority processing. Unused credits do not roll over.`,
  },
  {
    question: 'Can I upgrade or pay for Pro now?',
    answer: 'No. Intake does not process payments or allow self-service plan changes yet. The billing-period toggle only changes the price display.',
  },
  {
    question: 'How are AI credit charges decided?',
    answer: 'Intake calculates the exact operation cost on the server from a validated proposal. Failed, unsupported, or clarifying interpretations are not charged. A Google Forms change still requires explicit review and confirmation.',
  },
] as const;
