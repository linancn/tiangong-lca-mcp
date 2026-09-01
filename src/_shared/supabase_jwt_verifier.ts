import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';

const SupabaseAccessClaimsSchema = z
  .object({
    aud: z.union([z.string(), z.array(z.string())]),
    client_id: z.string().uuid(),
    exp: z.number().int(),
    iat: z.number().int(),
    iss: z.string(),
    role: z.literal('authenticated'),
    session_id: z.string().uuid(),
    sub: z.string().uuid(),
    scope: z.string().optional(),
  })
  .passthrough();

type ClaimsVerificationResult = {
  data: { claims?: unknown } | null;
  error: unknown;
};

export type SupabaseClaimsVerifier = (token: string) => Promise<ClaimsVerificationResult>;

export type SupabaseJwtVerifierOptions = {
  allowedClientIds: ReadonlySet<string>;
  audience: string;
  clockSkewSeconds?: number;
  getClaims: SupabaseClaimsVerifier;
  issuer: string;
  now?: () => number;
  resource: URL;
};

function invalidToken(): InvalidTokenError {
  return new InvalidTokenError('Access token is invalid');
}

function scopesFromClaim(scope: string | undefined): string[] {
  if (!scope) {
    return [];
  }
  return scope
    .split(' ')
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

export class SupabaseJwtTokenVerifier implements OAuthTokenVerifier {
  readonly #allowedClientIds: ReadonlySet<string>;
  readonly #audience: string;
  readonly #clockSkewSeconds: number;
  readonly #getClaims: SupabaseClaimsVerifier;
  readonly #issuer: string;
  readonly #now: () => number;
  readonly #resource: URL;

  constructor(options: SupabaseJwtVerifierOptions) {
    this.#allowedClientIds = options.allowedClientIds;
    this.#audience = options.audience;
    this.#clockSkewSeconds = options.clockSkewSeconds ?? 60;
    this.#getClaims = options.getClaims;
    this.#issuer = options.issuer;
    this.#now = options.now ?? Date.now;
    this.#resource = new URL(options.resource.href);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token) {
      throw invalidToken();
    }

    const { data, error } = await this.#getClaims(token);
    if (error) {
      throw invalidToken();
    }

    const parsed = SupabaseAccessClaimsSchema.safeParse(data?.claims);
    if (!parsed.success) {
      throw invalidToken();
    }

    const claims = parsed.data;
    const nowSeconds = Math.floor(this.#now() / 1_000);
    const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
    if (
      claims.iss !== this.#issuer ||
      !audiences.includes(this.#audience) ||
      claims.exp <= nowSeconds ||
      claims.iat > nowSeconds + this.#clockSkewSeconds ||
      !this.#allowedClientIds.has(claims.client_id)
    ) {
      throw invalidToken();
    }

    return {
      token,
      clientId: claims.client_id,
      scopes: scopesFromClaim(claims.scope),
      expiresAt: claims.exp,
      resource: new URL(this.#resource.href),
      extra: {
        authMethod: 'supabase_oauth_jwt',
        sessionId: claims.session_id,
        subject: claims.sub,
      },
    };
  }
}
