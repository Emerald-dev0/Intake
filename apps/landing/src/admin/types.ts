export type AdminRange = 'today' | '7d' | '30d';
export type Operation = 'form_create' | 'form_revise' | 'form_edit';
export type OperationStatus = 'succeeded' | 'failed' | 'no_result';
export type ConnectionStatus = 'connected' | 'expired' | 'reauthorization_required';

export interface PageData<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OverviewData {
  generatedAt: string;
  range: AdminRange;
  from: string;
  to: string;
  timezone: 'UTC';
  users: {
    total: number;
    newToday: number;
    newThisWeek: number;
    newThisMonth: number;
    activeSessionsInRange: number;
    activeDefinition: string;
  };
  plans: { available: false; reason: string; free: null; pro: null; proPercentage: null };
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
    trackingSince: string | null;
    operations: number | null;
    succeeded: number | null;
    failed: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    creditsConsumed: number | null;
    estimatedCostUsd: null;
  };
  credits: { available: false; reason: string; dailyGranted: null; monthlyGranted: null; consumed: null };
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastSessionUpdate: string | null;
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
  providers: { provider: 'google' | 'microsoft'; status: ConnectionStatus; lastAuthorizedAt: string | null; updatedAt: string }[];
}

export interface UserDetail {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastSessionUpdate: string | null;
  authenticationMethods: string[];
  plan: null;
  entitlement: null;
  planAvailable: false;
  planUnavailableReason: string;
  credits: { available: false; reason: string; dailyBalance: null; monthlyBalance: null; recentEvents: [] };
  ai: {
    available: boolean;
    reason: string | null;
    operations: number | null;
    succeeded: number | null;
    failed: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    trackingSince: string | null;
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
  providers: { available: boolean; reason: string | null; connections: UserSummary['providers'] };
}

export interface AiOperation {
  id: string;
  operationKey: string;
  userId: string;
  userName: string;
  userEmail: string;
  operation: Operation;
  provider: 'groq' | 'openai' | 'none';
  model: string | null;
  status: OperationStatus;
  failureCode: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  creditsConsumed: number;
  estimatedCostUsd: null;
  timestamp: string;
}

export interface AiData extends PageData<AiOperation> {
  available: boolean;
  reason: string | null;
  trackingSince: string | null;
  summary: null | {
    operations: number;
    succeeded: number;
    failed: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    creditsConsumed: number | null;
    estimatedCostUsd: null;
  };
}

export interface FormsData extends PageData<FormItem> {
  available: boolean;
  reason: string | null;
}

export interface FormItem {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  provider: 'google' | 'microsoft';
  providerFormId: string;
  status: 'created' | 'incomplete';
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  archivedAt: string | null;
}

export interface ActivityItem {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  description: string;
  requestId: string | null;
  provider: string | null;
}

export interface ErrorsData extends PageData<ErrorItem> {
  sources: { aiFailures: boolean; incompleteForms: boolean; providerFailures: false; genericApiErrors: false };
  resolutionTrackingAvailable: false;
}

export interface ErrorItem extends ActivityItem {
  route: string;
  operation: string;
  category: string;
  resolutionState: 'unknown';
}

export interface ProviderData {
  generatedAt: string;
  connectionsAvailable: boolean;
  connectionsUnavailableReason: string | null;
  google: ProviderHealth;
  microsoft: ProviderHealth;
  ai: {
    provider: 'groq';
    configured: boolean;
    model: string;
    connectivity: 'recent_success' | 'configured_unverified' | 'not_configured' | 'unknown';
    lastSuccessAt: string | null;
    failuresIn24Hours: number | null;
    usageAvailable: boolean;
  };
}

export interface ProviderHealth {
  configured: boolean;
  activeConnections: number | null;
  connected: number | null;
  expired: number | null;
  reauthorizationRequired: number | null;
  connectivity: 'not_probed';
  recentFailuresAvailable: false;
}

export interface SystemData {
  generatedAt: string;
  backend: { status: 'healthy'; evidence: string };
  database: { status: 'healthy' | 'unavailable'; evidence: string };
  aiProvider: { status: 'configured' | 'not_configured' | 'unknown'; evidence: string; model: string };
  googleIntegration: { status: 'configured' | 'not_configured'; evidence: string };
  rateLimiting: { status: 'ready' | 'not_ready' | 'unknown'; evidence: string };
  migrations: { trackingAvailable: boolean; applied: string[] | null; pending: string[] | null; latestAppliedAt: string | null; required: string[] };
}
