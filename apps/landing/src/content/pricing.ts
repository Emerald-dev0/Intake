import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../lib/plans.ts';

const comparison = proPriceComparison();

export const PRICING_TITLE = 'Intake Pricing — Free during launch, Pro coming soon';
export const PRICING_DESCRIPTION = `Intake is free during launch: $0 with ${PLAN_CATALOG.free.dailyCredits} daily credits for everyone. Pro (${formatUsd(comparison.monthlyCents)} per month or ${formatUsd(comparison.annualCents)} per year) and credit packs are coming soon.`;

/** Numbers an FAQ answer embeds. The static export below uses build-time values (SEO, fallbacks); the pricing page passes runtime values. */
export interface PricingFaqNumbers {
  freeDailyCredits: number;
  proDailyCredits: number;
  proMonthlyCredits: number;
  monthlyCents: number;
  annualCents: number;
}

export function pricingFaqEntries(numbers: PricingFaqNumbers) {
  return [
    {
      question: 'How much does Intake cost during launch?',
      answer: `Nothing. Every account is on Free at $0 with ${numbers.freeDailyCredits} daily credits, refreshed at 00:00 UTC. Paid plans open later.`,
    },
    {
      question: 'What will Pro add?',
      answer: `Pro will add ${numbers.proMonthlyCredits} monthly credits on top of the ${numbers.proDailyCredits} daily credits, for ${formatUsd(numbers.monthlyCents)} per month or ${formatUsd(numbers.annualCents)} per year. The form workflows and provider limits stay the same as Free. Unused credits do not roll over.`,
    },
    {
      question: 'What are credit packs?',
      answer: 'Credit packs will let you buy additional credits when you need more. Packs will come in three sizes: 100 credits, 500 credits, or 1,500 credits. Purchased credits never expire and are used after your daily and subscription credits. They are coming soon.',
    },
    {
      question: 'How do I get Pro when it opens?',
      answer: 'Start with a free account and keep building. When Pro opens, you can switch it on from your billing page; everything you have made on Free comes with you.',
    },
    {
      question: 'How are credit charges decided?',
      answer: 'Intake works out the exact cost on the server from the proposal you reviewed. Requests it cannot carry out, and questions it has to ask you first, cost nothing. Creating the form, or changing a Google Form, still waits for your confirmation.',
    },
  ] as const;
}

/** Shared by the visible pricing page, its crawlable fallback and pricing structured data. */
export const PRICING_FAQS = pricingFaqEntries({
  freeDailyCredits: PLAN_CATALOG.free.dailyCredits,
  proDailyCredits: PLAN_CATALOG.pro.dailyCredits,
  proMonthlyCredits: PLAN_CATALOG.pro.monthlyCredits,
  monthlyCents: comparison.monthlyCents,
  annualCents: comparison.annualCents,
});
