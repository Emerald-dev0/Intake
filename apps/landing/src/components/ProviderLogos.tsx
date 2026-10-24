/**
 * Provider brand marks for the public pages.
 *
 * The geometry is the providers' own logo shape as redistributed by Simple Icons 16.x under CC0 1.0
 * (`googleforms`, `typeform`). The names and marks remain the property of Google LLC and Typeform
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
