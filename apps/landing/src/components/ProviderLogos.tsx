/**
 * Provider brand marks for the public pages.
 *
 * The geometry is the providers' own logo shape as redistributed by Simple Icons 16.x under CC0 1.0
 * (`googleforms`, `typeform`, and the roadmap marks further down). The names and marks remain the property of Google LLC and Typeform
 * S.L.; they are used here only to identify which accounts Intake can create forms in — never as an
 * endorsement, and never redrawn, recoloured or distorted. `brand` colours are the official hex
 * values; `mono` renders in the surrounding text colour for dense or low-contrast contexts.
 */

export const GOOGLE_FORMS_BRAND = '#7248B9';
export const TYPEFORM_BRAND = '#262627';

/** Google Forms: the purple document mark. */
export function GoogleFormsLogo({
  size = 22,
  tone = 'brand',
  className,
  label = 'Google Forms',
}: {
  size?: number | string;
  tone?: 'brand' | 'mono';
  className?: string;
  /** Accessible name. Pass `null` where the brand name is already written next to the mark. */
  label?: string | null;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
      fill={tone === 'brand' ? GOOGLE_FORMS_BRAND : 'currentColor'}
    >
      <path d="M14.727 6h6l-6-6v6zm0 .727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6zM7.91 17.318a.819.819 0 1 1 .001-1.638.819.819 0 0 1 0 1.638zm0-3.273a.819.819 0 1 1 .001-1.637.819.819 0 0 1 0 1.637zm0-3.272a.819.819 0 1 1 .001-1.638.819.819 0 0 1 0 1.638zm9 6.409h-6.818v-1.364h6.818v1.364zm0-3.273h-6.818v-1.364h6.818v1.364zm0-3.273h-6.818V9.273h6.818v1.363z" />
    </svg>
  );
}

/**
 * Typeform: the official wordmark (not a square monogram — Typeform does not publish one, and an
 * invented "T" badge would misrepresent the brand). The path is the word "typeform"; the viewBox
 * trims the empty margin so it sits on the same optical line as the Google Forms icon.
 */
export function TypeformLogo({
  height = 15,
  tone = 'brand',
  className,
  label = 'Typeform',
}: {
  height?: number | string;
  tone?: 'brand' | 'mono';
  className?: string;
  /** Accessible name. Pass `null` where the brand name is already written next to the mark. */
  label?: string | null;
}) {
  return (
    <svg
      className={className}
      height={height}
      viewBox="0 0 24 14.2"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
      fill={tone === 'brand' ? TYPEFORM_BRAND : 'currentColor'}
      style={{ width: 'auto' }}
    >
      <path d="M15.502 13.035c-.5 0-.756-.411-.756-.917 0-.505.252-.894.756-.894.513 0 .756.407.756.894-.004.515-.261.917-.756.917Zm-4.888-1.81c.292 0 .414.17.414.317 0 .357-.365.514-1.126.536 0-.442.253-.854.712-.854Zm-3.241 1.81c-.473 0-.67-.384-.67-.917 0-.527.202-.894.67-.894.477 0 .702.38.702.894 0 .537-.234.917-.702.917Zm-3.997-2.334h-.738l1.224 2.808c-.234.519-.36.648-.522.648-.171 0-.333-.138-.45-.259l-.324.43c.22.232.522.366.832.366.387 0 .685-.224.856-.626l1.413-3.371h-.725l-.738 2.012-.828-2.008Zm19.553.523c.36 0 .432.246.432.823v1.516H24v-1.914c0-.689-.473-.988-.91-.988-.386 0-.742.241-.94.688a.901.901 0 0 0-.891-.688c-.365 0-.73.232-.927.666v-.626h-.64v2.857h.64v-1.22c0-.617.324-1.114.765-1.114.36 0 .427.246.427.823v1.516h.64l-.005-1.225c0-.617.329-1.114.77-1.114Zm-5.1-.523h-.324v2.857h.639v-1.095c0-.693.306-1.163.76-1.163.118 0 .217.005.325.05l.099-.676c-.081-.009-.153-.018-.225-.018-.45 0-.774.309-.964.707V10.7h-.31Zm-2.327-.045c-.846 0-1.418.644-1.418 1.458 0 .845.58 1.475 1.418 1.475.85 0 1.431-.648 1.431-1.475-.004-.818-.594-1.458-1.431-1.458Zm-4.852 2.38c-.333 0-.581-.17-.685-.515.847-.036 1.675-.242 1.675-.988 0-.43-.423-.872-1.03-.872-.82 0-1.374.666-1.374 1.457 0 .828.545 1.476 1.36 1.476.567 0 .927-.228 1.21-.559l-.31-.42c-.329.335-.531.42-.846.42Zm-3.151-2.38c-.324 0-.648.188-.774.483v-.438h-.64v3.98h.64v-1.422c.135.205.445.34.72.34.85 0 1.3-.631 1.3-1.48-.004-.841-.445-1.463-1.246-1.463Zm-4.483-1.1H0v.622h1.18v3.38h.67v-3.38h1.166v-.622Zm9.502 1.145h-.383v.572h.383v2.285h.639v-2.285h.621v-.572h-.621v-.447c0-.286.117-.385.382-.385.1 0 .19.027.311.068l.144-.537c-.117-.067-.351-.094-.504-.094-.612 0-.972.367-.972 1.002v.393Z" />
    </svg>
  );
}

/**
 * "Where your forms live" lockup: the two marks, each with the plain-language line it earns.
 * Used on the homepage hero and in the connection section so the promise is visible, not buried.
 */
export function ProviderLogoStrip({ className }: { className?: string }) {
  return (
    <ul className={`mk-providers ${className ?? ''}`} aria-label="Form providers Intake creates in">
      <li className="mk-provider">
        <GoogleFormsLogo size={20} label={null} />
        <span>
          <strong>Google Forms</strong>
          <small>Create and edit in place</small>
        </span>
      </li>
      <li className="mk-provider">
        <TypeformLogo height={14} label={null} />
        <span>
          <strong>Typeform</strong>
          <small>Create and import</small>
        </span>
      </li>
    </ul>
  );
}

/**
 * Roadmap marks: brands Intake does not talk to yet.
 *
 * These exist so the provider story is a line, not a closed list — but they are always rendered
 * `mono` and muted, never in brand colour, and always beside the word "Planned". A brand colour
 * next to a working provider would read as support that does not exist yet; a monochrome roadmap
 * chip reads as intent. Geometry from Simple Icons 16.x (CC0 1.0), same source as the live marks.
 */
export const PLANNED_PROVIDERS = [
  { name: 'SurveyMonkey', icon: 'surveymonkey' },
  { name: 'Google Sheets', icon: 'googlesheets' },
  { name: 'Jira', icon: 'jira' },
  { name: 'n8n', icon: 'n8n' },
] as const;

export type PlannedProviderName = (typeof PLANNED_PROVIDERS)[number]['icon'];

const PLANNED_PATHS: Record<PlannedProviderName, string> = {
  surveymonkey: 'M21.1627 13.1843a2.8517 2.8517 0 0 0-.6778.0841c-.8438-3.3181-3.5478-5.8376-6.9172-6.4452a8.3933 8.3933 0 0 0-.4407-.0668c.0259-.8255.0636-1.7791 1.2781-2.6369l-.1918-.4838s-2.3708.7349-2.6391 2.7598c-.1175-.5507-1.2209-1.2403-1.7673-1.3707l-.2717.4384s.7242.3621.9009 1.361c-3.3691.6056-6.0743 3.1229-6.9204 6.4398-1.5194-.376-3.056.5508-3.432 2.0703-.376 1.5194.5508 3.056 2.0703 3.432a2.8346 2.8346 0 0 0 1.7195-.1142 8.6821 8.6821 0 0 0 .9203 1.7123l2.3524-1.5852c-.6381-.8071-1.0206-1.9884-1.0873-3.1736-.07-1.2931.2446-2.5755 1.0701-3.3298 1.7016-1.4483 3.5561-.7877 4.7135.6002h.3114c1.1606-1.388 3.0173-2.0475 4.7135-.6002.8244.7543 1.1401 2.0378 1.0701 3.3298-.0656 1.1853-.4481 2.3664-1.0873 3.1736l2.3524 1.5852a8.6854 8.6854 0 0 0 .9224-1.7123c1.4551.5751 3.1009-.1384 3.676-1.5935s-.1384-3.1009-1.5935-3.676a2.8349 2.8349 0 0 0-1.0448-.1983zM2.7861 16.8482a.8362.8362 0 0 1 0-1.6724.8442.8442 0 0 1 .4688.1444c.0071.4391.0369.8776.0894 1.3136-.1472.1346-.3738.2329-.5582.2144zm18.4273 0a.8361.8361 0 0 1-.5582-.2155 12.679 12.679 0 0 0 .0894-1.3136.8352.8352 0 0 1 1.304.6929c.0078.4574-.3823.8581-.8352.8362z',
  googlesheets: 'M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z',
  jira: 'M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z',
  n8n: 'M21.4737 5.6842c-1.1772 0-2.1663.8051-2.4468 1.8947h-2.8955c-1.235 0-2.289.893-2.492 2.111l-.1038.623a1.263 1.263 0 0 1-1.246 1.0555H11.289c-.2805-1.0896-1.2696-1.8947-2.4468-1.8947s-2.1663.8051-2.4467 1.8947H4.973c-.2805-1.0896-1.2696-1.8947-2.4468-1.8947C1.1311 9.4737 0 10.6047 0 12s1.131 2.5263 2.5263 2.5263c1.1772 0 2.1663-.8051 2.4468-1.8947h1.4223c.2804 1.0896 1.2696 1.8947 2.4467 1.8947 1.1772 0 2.1663-.8051 2.4468-1.8947h1.0008a1.263 1.263 0 0 1 1.2459 1.0555l.1038.623c.203 1.218 1.257 2.111 2.492 2.111h.3692c.2804 1.0895 1.2696 1.8947 2.4468 1.8947 1.3952 0 2.5263-1.131 2.5263-2.5263s-1.131-2.5263-2.5263-2.5263c-1.1772 0-2.1664.805-2.4468 1.8947h-.3692a1.263 1.263 0 0 1-1.246-1.0555l-.1037-.623A2.52 2.52 0 0 0 13.9607 12a2.52 2.52 0 0 0 .821-1.4794l.1038-.623a1.263 1.263 0 0 1 1.2459-1.0555h2.8955c.2805 1.0896 1.2696 1.8947 2.4468 1.8947 1.3952 0 2.5263-1.131 2.5263-2.5263s-1.131-2.5263-2.5263-2.5263m0 1.2632a1.263 1.263 0 0 1 1.2631 1.2631 1.263 1.263 0 0 1-1.2631 1.2632 1.263 1.263 0 0 1-1.2632-1.2632 1.263 1.263 0 0 1 1.2632-1.2631M2.5263 10.7368A1.263 1.263 0 0 1 3.7895 12a1.263 1.263 0 0 1-1.2632 1.2632A1.263 1.263 0 0 1 1.2632 12a1.263 1.263 0 0 1 1.2631-1.2632m6.3158 0A1.263 1.263 0 0 1 10.1053 12a1.263 1.263 0 0 1-1.2632 1.2632A1.263 1.263 0 0 1 7.579 12a1.263 1.263 0 0 1 1.2632-1.2632m10.1053 3.7895a1.263 1.263 0 0 1 1.2631 1.2632 1.263 1.263 0 0 1-1.2631 1.2631 1.263 1.263 0 0 1-1.2632-1.2631 1.263 1.263 0 0 1 1.2632-1.2632',
};

/** A roadmap mark. Monochrome by construction: there is no `tone` prop to get wrong. */
export function PlannedProviderLogo({
  name,
  size = 16,
  className,
}: {
  name: PlannedProviderName;
  size?: number | string;
  className?: string;
}) {
  const label = PLANNED_PROVIDERS.find(provider => provider.icon === name)?.name ?? name;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      focusable="false"
      fill="currentColor"
    >
      <path d={PLANNED_PATHS[name]} />
    </svg>
  );
}
