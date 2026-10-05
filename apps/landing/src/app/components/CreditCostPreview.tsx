import type { PublicCreditCostGuide, PublicOperationCost } from '../../lib/credits';
import type { PublicCredits } from '../../lib/credits';

export function CreditCostPreview({
  guide,
  credits,
  mode,
}: {
  guide: PublicCreditCostGuide | null;
  credits: PublicCredits | null;
  mode: 'create' | 'edit' | 'revise';
}) {
  if (!guide) {
    return <aside className="credit-cost-preview is-unavailable" role="status">
      <strong>Credit estimate unavailable</strong>
      <p>Intake will still calculate the exact cost on the server before returning a usable proposal. No price is chosen by the model or browser.</p>
    </aside>;
  }
  const isFormDraft = mode === 'create' || mode === 'revise';
  const copy = mode === 'create'
    ? `A standard new form is ${guide.formCreate.standard} credits. Larger or conditional forms may cost ${guide.formCreate.complexMin}–${guide.formCreate.max}; Intake calculates the exact amount from the validated form.`
    : mode === 'revise'
      ? `A revision to a new-form draft uses the same pricing: a standard form is ${guide.formCreate.standard} credits, and larger or conditional forms may cost ${guide.formCreate.complexMin}–${guide.formCreate.max}. Intake calculates the exact amount from the validated form.`
      : `One focused supported change is ${guide.formEdit.singleChange} credit. A major restructure may cost ${guide.formEdit.majorMin}–${guide.formEdit.max}; Intake calculates the exact amount from the validated plan.`;
  return <aside className="credit-cost-preview" aria-label={`${mode === 'create' ? 'Form creation' : 'Form edit'} credit estimate`}>
    <div className="credit-cost-preview-head"><span className="info-index">CREDIT PREVIEW</span><strong>{isFormDraft ? `${guide.formCreate.min}–${guide.formCreate.max} credits` : `${guide.formEdit.min}–${guide.formEdit.max} credits`}</strong></div>
    <p>{copy}</p>
    <p className="credit-cost-fine">Only a validated proposal is charged, once. A failed, unsupported or clarifying result costs nothing; applying a reviewed form proposal has no extra charge.</p>
    {credits && credits.availableCredits > 0 && credits.availableCredits < (isFormDraft ? guide.formCreate.min : guide.formEdit.min) && <p className="credit-cost-limit" role="status">Your current balance is {credits.availableCredits}; it may not cover the minimum estimate. Intake will check the exact server-calculated amount before returning a proposal.</p>}
    {credits && credits.availableCredits === 0 && <p className="credit-cost-limit" role="status">No credits are available right now. The server will refuse an operation until a balance is available; nothing will be charged or created.</p>}
  </aside>;
}

export function OperationCostReceipt({ receipt }: { receipt: PublicOperationCost | null }) {
  if (!receipt) return null;
  if (receipt.status === 'not_charged') {
    return <div className="operation-cost-receipt is-not-charged" role="status"><strong>No credits were used.</strong> Intake did not return a usable proposal from this interpretation.</div>;
  }
  if (receipt.status === 'already_charged') {
    return <div className="operation-cost-receipt" role="status"><strong>{receipt.credits} credits were already counted.</strong> This retry did not deduct credits a second time.</div>;
  }
  return <div className="operation-cost-receipt" role="status"><strong>{receipt.credits} credits used for interpretation.</strong> Applying the reviewed proposal to Google Forms still requires your confirmation and adds no extra charge.</div>;
}
