export type AdminRange = 'today' | '7d' | '30d';
export type AdminOperation = 'form_create' | 'form_revise' | 'form_edit';
export type AdminOperationStatus = 'succeeded' | 'failed' | 'no_result';
export type AdminProviderId = 'google' | 'microsoft' | 'groq' | 'openai' | 'none';

export interface RangeBounds {
  range: AdminRange;
  from: Date;
  to: Date;
  todayStart: Date;
  weekStart: Date;
  monthStart: Date;
}

export interface PageRequest {
  page: number;
  limit: number;
  offset: number;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminIdentity {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

export interface UnavailableMetric {
  available: false;
  reason: string;
}

export interface AiSummary {
  operations: number;
  succeeded: number;
  failed: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  creditsConsumed: number | null;
  estimatedCostUsd: null;
}

export interface AiUnavailableSummary {
  available: false;
  reason: string;
  trackingSince: null;
  summary: null;
  items: [];
}

export interface AiOperationItem {
  id: string;
  operationKey: string;
  userId: string;
  userName: string;
  userEmail: string;
  operation: AdminOperation;
  provider: AdminProviderId;
  model: string | null;
  status: AdminOperationStatus;
  failureCode: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  creditsConsumed: number;
  estimatedCostUsd: null;
  timestamp: Date;
}

export interface UserProviderStatus {
  provider: 'google' | 'microsoft';
  status: 'connected' | 'expired' | 'reauthorization_required';
  lastAuthorizedAt: Date | null;
  updatedAt: Date;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  lastSessionUpdate: Date | null;
  plan: null;
  subscriptionState: null;
  dailyCredits: null;
  monthlyCredits: null;
  formsCount: number | null;
  archivedFormsCount: number | null;
  aiOperations: number | null;
  aiOperationsFailed: number | null;
  aiInputTokens: number | null;
  aiOutputTokens: number | null;
  aiAvailable: boolean;
  providersAvailable: boolean;
  providers: UserProviderStatus[];
}

export interface UserDetail extends Omit<AdminIdentity, 'emailVerified'> {
  createdAt: Date;
  lastSessionUpdate: Date | null;
  authenticationMethods: string[];
  plan: null;
  entitlement: null;
  planAvailable: false;
  planUnavailableReason: string;
  credits: {
    available: false;
    reason: string;
    dailyBalance: null;
    monthlyBalance: null;
    recentEvents: [];
  };
  ai: {
    available: boolean;
    reason: string | null;
    operations: number | null;
    succeeded: number | null;
    failed: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    trackingSince: Date | null;
    estimatedCostUsd: null;
    creditsConsumed: null;
  };
  forms: {
    available: boolean;
    reason: string | null;
    total: number | null;
    created: number | null;
    incomplete: number | null;
    archived: number | null;
    updatedRecords: number | null;
  };
  providers: {
    available: boolean;
    reason: string | null;
    connections: UserProviderStatus[];
  };
}

export interface OverviewData {
  generatedAt: Date;
  range: AdminRange;
  from: Date;
  to: Date;
  timezone: 'UTC';
  users: {
    total: number;
    newToday: number;
    newThisWeek: number;
    newThisMonth: number;
    activeSessionsInRange: number;
    activeDefinition: 'unexpired sessions updated during the selected UTC range';
  };
  plans: UnavailableMetric & { free: null; pro: null; proPercentage: null };
  forms: {
    available: boolean;
    reason: string | null;
    totalRecords: number | null;
    createdRecords: number | null;
    incompleteRecords: number | null;
    createdInRange: number | null;
    incompleteInRange: number | null;
    updatedRecordsInRange: number | null;
    editCountAvailable: false;
  };
  ai: {
    available: boolean;
    reason: string | null;
    trackingSince: Date | null;
    operations: number | null;
    succeeded: number | null;
    failed: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    creditsConsumed: number | null;
    estimatedCostUsd: null;
  };
  email: OverviewEmail;
  credits: UnavailableMetric & { dailyGranted: null; monthlyGranted: null; consumed: null };
}

export interface AdminAiResult extends PageResult<AiOperationItem> {
  available: boolean;
  reason: string | null;
  trackingSince: Date | null;
  summary: AiSummary | null;
}

export interface AdminFormsResult extends PageResult<AdminFormItem> {
  available: boolean;
  reason: string | null;
}

export interface AdminFormItem {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  provider: 'google' | 'microsoft';
  providerFormId: string;
  status: 'created' | 'incomplete';
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date | null;
  archivedAt: Date | null;
}

/**
 * Operational email health. Deliberately aggregate: no OTP values, no reset tokens, no message
 * bodies, no API keys, and no recipient addresses beyond a masked form (mission §33).
 */
export interface EmailSummary {
  generatedAt: Date;
  range: AdminRange;
  available: boolean;
  reason: string | null;
  provider: string;
  configured: boolean;
  testCredential: boolean;
  sender: string | null;
  webhooksConfigured: boolean;
  accepted: number | null;
  skipped: number | null;
  failed: number | null;
  delivered: number | null;
  bounced: number | null;
  complained: number | null;
  suppressions: number | null;
  byType: Array<{ type: string; count: number }>;
  topErrors: Array<{ code: string; count: number }>;
  recent: Array<{
    id: string;
    emailType: string;
    status: string;
    errorCode: string | null;
    providerMessageId: string | null;
    createdAt: Date;
  }>;
}

export interface OverviewEmail {
  available: boolean;
  reason: string | null;
  provider: string;
  configured: boolean;
  accepted: number | null;
  failed: number | null;
  bounced: number | null;
  complained: number | null;
}

export interface ProviderSummary {
  generatedAt: Date;
  connectionsAvailable: boolean;
  connectionsUnavailableReason: string | null;
  google: {
    configured: boolean;
    activeConnections: number | null;
    connected: number | null;
    expired: number | null;
    reauthorizationRequired: number | null;
    connectivity: 'not_probed';
    recentFailuresAvailable: false;
  };
  microsoft: {
    configured: boolean;
    activeConnections: number | null;
    connected: number | null;
    expired: number | null;
    reauthorizationRequired: number | null;
    connectivity: 'not_probed';
    recentFailuresAvailable: false;
  };
  ai: {
    provider: 'groq';
    configured: boolean;
    model: string;
    connectivity: 'recent_success' | 'configured_unverified' | 'not_configured' | 'unknown';
    lastSuccessAt: Date | null;
    failuresIn24Hours: number | null;
    usageAvailable: boolean;
  };
}

export interface SystemStatus {
  generatedAt: Date;
  backend: { status: 'healthy'; evidence: string };
  database: { status: 'healthy' | 'unavailable'; evidence: string };
  aiProvider: { status: 'configured' | 'not_configured' | 'unknown'; evidence: string; model: string };
  googleIntegration: { status: 'configured' | 'not_configured'; evidence: string };
  rateLimiting: { status: 'ready' | 'not_ready' | 'unknown'; evidence: string };
  email: {
    status: 'configured' | 'not_configured' | 'unknown';
    evidence: string;
    provider: string;
    testCredential: boolean;
    webhooks: 'configured' | 'not_configured';
  };
  migrations: {
    trackingAvailable: boolean;
    applied: string[] | null;
    pending: string[] | null;
    latestAppliedAt: Date | null;
    required: string[];
  };
}

export interface AdminActivityItem {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: Date;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  description: string;
  requestId: string | null;
  provider: string | null;
}

export interface AdminErrorItem extends AdminActivityItem {
  operation: string;
  category: string;
  resolutionState: 'unknown';
}

export interface AdminActivityResult extends PageResult<AdminActivityItem> {
  sources: { users: boolean; forms: boolean; providers: boolean; ai: boolean; credits: false };
}

export interface AdminErrorsResult extends PageResult<AdminErrorItem> {
  sources: { aiFailures: boolean; incompleteForms: boolean; providerFailures: false; genericApiErrors: false };
  resolutionTrackingAvailable: false;
}

export interface AdminCreditsResult {
  available: false;
  reason: string;
  summary: null;
  items: [];
}

export interface AdminStore {
  getIdentity(userId: string): Promise<AdminIdentity | null>;
  getOverview(bounds: RangeBounds): Promise<OverviewData>;
  listUsers(input: PageRequest & { search: string }): Promise<PageResult<UserSummary>>;
  getUserDetail(userId: string): Promise<UserDetail | null>;
  listAi(input: PageRequest & {
    bounds: RangeBounds;
    operation: AdminOperation | null;
    status: AdminOperationStatus | null;
    model: string;
    userId: string;
  }): Promise<AdminAiResult>;
  getCredits(): AdminCreditsResult;
  listForms(input: PageRequest & {
    query: string;
    userId: string;
    provider: 'google' | 'microsoft' | null;
    status: 'created' | 'incomplete' | null;
    archived: 'active' | 'archived' | 'all';
  }): Promise<AdminFormsResult>;
  getProviders(): Promise<ProviderSummary>;
  getEmail(bounds: RangeBounds): Promise<EmailSummary>;
  getSystem(): Promise<SystemStatus>;
  listActivity(input: PageRequest & { bounds: RangeBounds; type: string; userId: string }): Promise<AdminActivityResult>;
  listErrors(input: PageRequest & { bounds: RangeBounds; userId: string }): Promise<AdminErrorsResult>;
}
