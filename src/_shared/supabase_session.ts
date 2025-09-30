export interface SupabaseSessionPayload {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
}

export type SupabaseSessionLike =
  | SupabaseSessionPayload
  | ({
      accessToken: string;
      refreshToken?: string | null;
      expiresAt?: number | null;
      [key: string]: unknown;
    } & Record<string, unknown>)
  | ({
      access_token: string;
      refresh_token?: string | null;
      expires_at?: number | null;
      [key: string]: unknown;
    } & Record<string, unknown>);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeRefreshToken(value: unknown): string | null | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null) {
    return null;
  }

  return undefined;
}

function normalizeExpiresAt(value: unknown): number | null | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (value === null) {
    return null;
  }

  return undefined;
}

const nestedSessionKeys = ['session', 'supabaseSession', 'supabaseSessionTokens'];

export function normalizeSupabaseSession(input: unknown): SupabaseSessionPayload | undefined {
  if (!input) {
    return undefined;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed.startsWith('{')) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return normalizeSupabaseSession(parsed);
    } catch (_error) {
      return undefined;
    }
  }

  if (typeof input !== 'object') {
    return undefined;
  }

  const record = input as Record<string, unknown>;

  const candidateAccessToken = record['access_token'] ?? record['accessToken'];
  const accessToken = isNonEmptyString(candidateAccessToken) ? candidateAccessToken : undefined;

  if (accessToken) {
    const candidateRefreshToken = record['refresh_token'] ?? record['refreshToken'];
    const refreshToken = normalizeRefreshToken(candidateRefreshToken);

    const candidateExpiresAt = record['expires_at'] ?? record['expiresAt'];
    const expiresAt = normalizeExpiresAt(candidateExpiresAt);

    const normalized: SupabaseSessionPayload = {
      access_token: accessToken,
    };

    if (refreshToken !== undefined) {
      normalized.refresh_token = refreshToken;
    }

    if (expiresAt !== undefined) {
      normalized.expires_at = expiresAt;
    }

    return normalized;
  }

  for (const key of nestedSessionKeys) {
    if (key in record) {
      const nestedValue = record[key];
      if (nestedValue && nestedValue !== input) {
        const normalized = normalizeSupabaseSession(nestedValue);
        if (normalized) {
          return normalized;
        }
      }
    }
  }

  return undefined;
}

export function resolveSupabaseAccessToken(input: unknown): {
  session?: SupabaseSessionPayload;
  accessToken?: string;
} {
  const session = normalizeSupabaseSession(input);

  if (session) {
    return {
      session,
      accessToken: session.access_token,
    };
  }

  if (typeof input === 'string' && input.trim().length > 0) {
    return {
      accessToken: input.trim(),
    };
  }

  return {};
}
