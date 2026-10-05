import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../lib/plans.ts';

const comparison = proPriceComparison();

export const PRICING_TITLE = 'Intake Pricing — Free and Pro Plans';
export const PRICING_DESCRIPTION = `Free is $0 with ${PLAN_CATALOG.free.dailyCredits} daily credits. Pro is ${formatUsd(comparison.monthlyCents)} per month or ${formatUsd(comparison.annualCents)} per year with ${PLAN_CATALOG.pro.monthlyCredits} monthly credits. Intake does not take payments yet.`;

/** Shared by the visible pricing page, its crawlable fallback and pricing structured data. */
export const PRICING_FAQS = [
  {
    question: 'How much does Intake cost?',
    answer: `Free is $0. Pro is ${formatUsd(comparison.monthlyCents)} per month or ${formatUsd(comparison.annualCents)} per year. Paying annually would save ${formatUsd(comparison.annualSavingsCents)} compared with twelve monthly payments.`,
  },
  {
    question: 'What does Pro add?',
    answer: `Pro has ${PLAN_CATALOG.pro.dailyCredits} daily credits plus ${PLAN_CATALOG.pro.monthlyCredits} monthly credits. The supported form workflows and provider limits are the same as Free; Pro does not include priority processing. Unused credits do not roll over.`,
  },
  {
    question: 'Can I pay for Pro?',
    answer: 'Not on this page. Intake does not take payments yet, so there is nothing to check out and no subscription to cancel. The monthly and annual switch only compares the two prices.',
  },
  {
    question: 'How are credit charges decided?',
    answer: 'Intake works out the exact cost on the server from the proposal you reviewed. Requests it cannot carry out, and questions it has to ask you first, cost nothing. A Google Forms change still waits for your confirmation.',
  },
] as const;
