export type Provider = 'google' | 'microsoft';

export const PROVIDERS: Record<Provider, { name: string; short: string; color: string; signin: string; host: string }> = {
  google: { name: 'Google Forms', short: 'Google', color: '#6d3fc0', signin: 'Google', host: 'docs.google.com/forms' },
  microsoft: { name: 'Microsoft Forms', short: 'Microsoft', color: '#07827f', signin: 'Microsoft', host: 'forms.office.com' },
};
