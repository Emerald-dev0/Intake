export const PUBLIC_AUTH_METHODS = ['email_password', 'google'] as const;
export type PublicAuthMethod = (typeof PUBLIC_AUTH_METHODS)[number];

export interface PublicAuthMethodSummary {
  available: boolean;
  methods: PublicAuthMethod[];
}

type AccountQueryable = {
  query<T extends Record<string, unknown>>(sql: string, values: unknown[]): Promise<{ rows: T[] }>;
};

/** Reads only provider identifiers for the authenticated account; tokens and account data stay private. */
export async function readAuthenticationMethods(queryable: AccountQueryable, userId: string): Promise<PublicAuthMethodSummary> {
  const result = await queryable.query<{ providerId: string }>(
    'SELECT DISTINCT "providerId" FROM account WHERE "userId" = $1 ORDER BY "providerId"',
    [userId],
  );
  const methods = new Set<PublicAuthMethod>();
  for (const row of result.rows) {
    if (row.providerId === 'credential') methods.add('email_password');
    if (row.providerId === 'google') methods.add('google');
  }
  return { available: true, methods: [...methods] };
}
