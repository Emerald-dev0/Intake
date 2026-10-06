/**
 * Intake email infrastructure.
 *
 *   Application ──▶ EmailService ──▶ EmailProvider ──▶ CalderEmailProvider ──▶ Calder API
 *
 * Calder is Intake's transactional email provider. It is also the only part of Intake that knows
 * Calder exists: this module is the seam. See ./README.md for the full map, the event catalogue and
 * the environment contract.
 */

export {
  readEmailConfig, webhooksEnabled, isTestCredential, type EmailConfig,
} from './config';
export {
  EmailError, emailUserMessage, isRetryableEmailError, mapCalderError,
} from './errors';
export { createEmailLogger, sanitizeEmailLogFields, type EmailLogEvent, type EmailLogger } from './logging';
export {
  createEmailNotifier, createMemorySignInMarkers, createPostgresSignInMarkers, createPostgresUserDirectory,
  type EmailNotifier, type SignInMarkers, type UserDirectory,
} from './notifications';
export {
  createMemoryOtpStore, createOtpService, createPostgresOtpStore,
  OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_HOUR, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS,
  type OtpPurpose, type OtpService, type OtpStartResult, type OtpStore, type OtpVerifyResult,
} from './otp';
export { createAccountEmailRouter, type AccountEmailRouterDeps } from './routes';
export {
  baseVariables, createEmailService, formatEmailTimestamp, idempotencyKeyFor, isValidRecipient,
  type EmailService, type EmailServiceOptions,
} from './service';
export {
  createMemoryEmailStore, createPostgresEmailStore, NULL_EMAIL_STORE,
} from './store';
export { EMAIL_TEMPLATES, escapeHtml, renderEmail, templateFor, type EmailVariables, type RenderedEmail } from './templates';
export { maskEmail } from './types';
export type {
  EmailDeliveryRecord, EmailDeliveryStatus, EmailErrorCode, EmailMessage, EmailProvider, EmailSendOutcome,
  EmailStats, EmailStore, EmailStream, EmailSuppressionReason, EmailType, ProviderSendResult, SendEmailRequest,
} from './types';
export {
  calderWebhookHandler, handleCalderWebhook, verifyCalderSignature, SIGNATURE_TOLERANCE_SECONDS,
  type CalderWebhookEvent, type WebhookDeps,
} from './webhooks';
export { createCalderProvider, createMemoryEmailProvider, type MemoryEmailProvider } from './providers/calder';
