import type { PublicCreditCostGuide, PublicOperationCost, PublicCredits } from '../../lib/credits';

/**
 * The price, said once. A person about to type a sentence needs one number and one promise
 * ("nothing is charged unless it works"), not a paragraph of billing policy — the detail is one
 * click away for anyone who wants it.
 */
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
      <p>Credit estimate unavailable — the exact cost is still calculated on the server before any proposal is returned.</p>
    </aside>;
  }
  const isFormDraft = mode === 'create' || mode === 'revise';
  const range = isFormDraft
    ? `${guide.formCreate.min}–${guide.formCreate.max} credits`
    : `${guide.formEdit.min}–${guide.formEdit.max} credits`;
  const headline = isFormDraft
    ? `A standard form costs ${guide.formCreate.standard} credits`
    : `One focused change costs ${guide.formEdit.singleChange} credit`;
  const detail = isFormDraft
    ? `Larger or conditional forms may cost ${guide.formCreate.complexMin}–${guide.formCreate.max}. Intake calculates the exact amount from the validated form.`
    : `A major restructure may cost ${guide.formEdit.majorMin}–${guide.formEdit.max}. Intake calculates the exact amount from the validated plan.`;
  return <aside className="credit-cost-preview" aria-label={`${mode === 'edit' ? 'Form edit' : 'Form creation'} credit estimate`}>
    <p className="credit-cost-line">
      <strong>{range}</strong>
      <span>{headline}</span>
      <details className="credit-cost-details">
        <summary>How charging works</summary>
        <p>{detail} Only a validated proposal is charged, and only once. A failed, unsupported or clarifying result costs nothing; creating the form after you confirm adds no extra charge.</p>
      </details>
    </p>
    {credits && credits.availableCredits > 0 && credits.availableCredits < (isFormDraft ? guide.formCreate.min : guide.formEdit.min) && <p className="credit-cost-limit" role="status">Your balance ({credits.availableCredits}) may not cover the minimum. Intake checks the exact amount before returning a proposal.</p>}
    {credits && credits.availableCredits === 0 && <p className="credit-cost-limit" role="status">No credits are available right now. Nothing will be charged or created until a balance is available.</p>}
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
  return <div className="operation-cost-receipt" role="status"><strong>{receipt.credits} credits used for interpretation.</strong> Creating the form still requires your confirmation and adds no extra charge.</div>;
}
