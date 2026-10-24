import { FORM_PROVIDER_LABELS, type FormProvider, type ProviderId } from '../../lib/connections';

/** The letter that stands in for a provider where a logo would go. */
export function ProviderMark({ provider }: { provider: ProviderId | FormProvider | string }) {
  const label = provider === 'google' ? 'G' : provider === 'typeform' ? 'T' : '⊞';
  return <span className={`provider-mark provider-mark--${provider}`} aria-hidden>{label}</span>;
}

/** Provider name between a mark and its state. Used wherever a form's home matters. */
export function ProviderBadge({ provider, note }: { provider: FormProvider; note?: string }) {
  return <span className={`provider-badge provider-badge--${provider}`}>
    <ProviderMark provider={provider} />
    <span className="provider-badge__text">
      {FORM_PROVIDER_LABELS[provider]}
      {note && <small>{note}</small>}
    </span>
  </span>;
}
