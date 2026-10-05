import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../lib/plans.ts';

const comparison = proPriceComparison();

export const PRICING_TITLE = 'Intake Pricing — Free and Pro Plans';
export const PRICING_DESCRIPTION = `Free is $0 with ${PLAN_CATALOG.free.dailyCredits} daily credits. Pro is ${formatUsd(comparison.monthlyCents)} per month or ${formatUsd(comparison.annualCents)} per year with ${PLAN_CATALOG.pro.monthlyCredits} monthly credits.`;

/** Shared by the visible pricing page, its crawlable fallback and pricing structured data. */
export const PRICING_FAQS = [
  {
    question: 'How much does Intake cost?',
    answer: `Free is $0. Pro is ${formatUsd(comparison.monthlyCents)} per month or ${formatUsd(comparison.annualCents)} per year. Paying annually would save ${formatUsd(comparison.annualSavingsCents)} compared with twelve monthly payments.`,
  },
  {
    question: 'What does Pro add?',
    answer: `Pro has ${PLAN_CATALOG.pro.dailyCredits} daily credits plus ${PLAN_CATALOG.pro.monthlyCredits} monthly credits. The form workflows and provider limits are the same as Free. Unused credits do not roll over.`,
  },
  {
    question: 'How do I get Pro?',
    answer: 'Start with a free account and keep building. Pro opens to existing accounts first and can be switched on from your account page; everything you have made on Free comes with you.',
  },
  {
    question: 'How are credit charges decided?',
    answer: 'Intake works out the exact cost on the server from the proposal you reviewed. Requests it cannot carry out, and questions it has to ask you first, cost nothing. A Google Forms change still waits for your confirmation.',
  },
] as const;
