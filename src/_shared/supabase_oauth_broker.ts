import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  OAuthClientInformationFullSchema,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import { z } from 'zod';
import type { SupabaseSessionPayload } from './supabase_session.js';
import {
  EncryptedOAuthBrokerStore,
  constantTimeEqual,
  createOpaqueToken,
  createPkcePair,
} from './oauth_broker_store.js';

const UPSTREAM_SCOPES = ['openid', 'email', 'profile'] as const;
const ACCESS_TOKEN_PREFIX = 'mcp_at_';
const REFRESH_TOKEN_PREFIX = 'mcp_rt_';
const AUTHORIZATION_CODE_PREFIX = 'mcp_ac_';
const AUTHORIZATION_STATE_PREFIX = 'mcp_st_';
const SESSION_ID_PREFIX = 'mcp_ss_';
const UPSTREAM_EXPIRY_BUFFER_SECONDS = 30;

const UpstreamTokensSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().min(1),
});

const UpstreamUserInfoSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email().optional(),
});

type UpstreamTokens = z.infer<typeof UpstreamTokensSchema>;

type UpstreamSession = {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
};

type AuthorizationState = {
  clientCodeChallenge: string;
  clientId: string;
  clientRedirectUri: string;
  clientState?: string;
  resource: string;
  scopes: string[];
  upstreamCodeVerifier: string;
};

type AuthorizationCode = {
  clientCodeChallenge: string;
  clientId: string;
  clientRedirectUri: string;
  email?: string;
  resource: string;
  scopes: string[];
  subject: string;
  upstreamSession: UpstreamSession;
};

type BrokerSession = {
  clientId: string;
  email?: string;
  resource: string;
  scopes: string[];
  subject: string;
  upstreamSession: UpstreamSession;
};

type AccessGrant = {
  expiresAt: number;
  sessionId: string;
};

type RefreshGrant = {
  clientId: string;
  expiresAt: number;
  resource: string;
  scopes: string[];
  sessionId: string;
};

export type OAuthBrokerClient = {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  scope?: string;
};

export type SupabaseOAuthBrokerConfig = {
  accessTokenTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  authorizationStateTtlSeconds: number;
  clients: OAuthBrokerClient[];
  fetch?: typeof fetch;
  now?: () => number;
  refreshTokenTtlSeconds: number;
  resourceUrl: URL;
  store: EncryptedOAuthBrokerStore;
  supportedScopes: string[];
  supabaseBaseUrl: URL;
  supabaseClientId: string;
  supabaseClientSecret: string;
  supabaseRedirectUri: URL;
};

class UpstreamOAuthError extends Error {
  readonly retryable: boolean;

  constructor(retryable: boolean) {
    super('Upstream OAuth request failed');
    this.retryable = retryable;
  }
}

function opaque(prefix: string): string {
  return `${prefix}${createOpaqueToken()}`;
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

function redirectWithError(
  redirectUri: string,
  state: string | undefined,
  error: 'access_denied' | 'server_error',
): string {
  const redirect = new URL(redirectUri);
  redirect.searchParams.set('error', error);
  redirect.searchParams.set(
    'error_description',
    error === 'access_denied' ? 'Authorization was denied' : 'Authorization could not be completed',
  );
  if (state) {
    redirect.searchParams.set('state', state);
  }
  return redirect.href;
}

function scopesFromClient(client: OAuthClientInformationFull): string[] {
  return (client.scope ?? '')
    .split(' ')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function sameResource(left: URL | undefined, expected: URL): boolean {
  if (!left) {
    return false;
  }
  const normalized = new URL(left.href);
  normalized.hash = '';
  const canonical = new URL(expected.href);
  canonical.hash = '';
  return normalized.href === canonical.href;
}

function parseJsonResponse(response: globalThis.Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

export class SupabaseOAuthBrokerProvider implements OAuthServerProvider {
  readonly #accessTokenTtlSeconds: number;
  readonly #authorizationCodeTtlSeconds: number;
  readonly #authorizationStateTtlSeconds: number;
  readonly #clients = new Map<string, OAuthClientInformationFull>();
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #refreshTokenTtlSeconds: number;
  readonly #resourceUrl: URL;
  readonly #store: EncryptedOAuthBrokerStore;
  readonly #supportedScopes: ReadonlySet<string>;
  readonly #supabaseAuthorizationUrl: URL;
  readonly #supabaseClientId: string;
  readonly #supabaseClientSecret: string;
  readonly #supabaseRedirectUri: URL;
  readonly #supabaseTokenUrl: URL;
  readonly #supabaseUserInfoUrl: URL;

  constructor(config: SupabaseOAuthBrokerConfig) {
    this.#accessTokenTtlSeconds = config.accessTokenTtlSeconds;
    this.#authorizationCodeTtlSeconds = config.authorizationCodeTtlSeconds;
    this.#authorizationStateTtlSeconds = config.authorizationStateTtlSeconds;
    this.#fetch = config.fetch ?? fetch;
    this.#now = config.now ?? Date.now;
    this.#refreshTokenTtlSeconds = config.refreshTokenTtlSeconds;
    this.#resourceUrl = new URL(config.resourceUrl.href);
    this.#store = config.store;
    this.#supportedScopes = new Set(config.supportedScopes);
    this.#supabaseClientId = config.supabaseClientId;
    this.#supabaseClientSecret = config.supabaseClientSecret;
    this.#supabaseRedirectUri = new URL(config.supabaseRedirectUri.href);
    this.#supabaseAuthorizationUrl = new URL('/auth/v1/oauth/authorize', config.supabaseBaseUrl);
    this.#supabaseTokenUrl = new URL('/auth/v1/oauth/token', config.supabaseBaseUrl);
    this.#supabaseUserInfoUrl = new URL('/auth/v1/oauth/userinfo', config.supabaseBaseUrl);

    if (!this.#supabaseClientId || !this.#supabaseClientSecret) {
      throw new Error('Supabase OAuth broker client configuration is incomplete');
    }
    if (this.#supportedScopes.size === 0) {
      throw new Error('OAuth broker must advertise at least one scope');
    }

    for (const input of config.clients) {
      const client = OAuthClientInformationFullSchema.parse({
        client_id: input.client_id,
        client_name: input.client_name,
        redirect_uris: input.redirect_uris,
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
        scope: input.scope ?? config.supportedScopes.join(' '),
      });
      const clientScopes = scopesFromClient(client);
      if (
        clientScopes.length === 0 ||
        clientScopes.some((scope) => !this.#supportedScopes.has(scope))
      ) {
        throw new Error(`OAuth broker client ${client.client_id} has invalid scopes`);
      }
      this.#clients.set(client.client_id, client);
    }
    if (this.#clients.size === 0) {
      throw new Error('OAuth broker requires at least one fixed MCP client');
    }
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.#clients.get(clientId),
    };
  }

  get resourceUrl(): URL {
    return new URL(this.#resourceUrl.href);
  }

  get supportedScopes(): string[] {
    return [...this.#supportedScopes];
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!sameResource(params.resource, this.#resourceUrl)) {
      throw new InvalidTargetError('The requested resource is not this MCP server');
    }
    const allowedScopes = new Set(scopesFromClient(client));
    const scopes = params.scopes?.length ? params.scopes : [...allowedScopes];
    if (
      scopes.length === 0 ||
      scopes.some((scope) => !allowedScopes.has(scope) || !this.#supportedScopes.has(scope))
    ) {
      throw new InvalidScopeError('The requested scope is not allowed for this client');
    }

    const stateHandle = opaque(AUTHORIZATION_STATE_PREFIX);
    const upstreamPkce = createPkcePair();
    const state: AuthorizationState = {
      clientCodeChallenge: params.codeChallenge,
      clientId: client.client_id,
      clientRedirectUri: params.redirectUri,
      clientState: params.state,
      resource: this.#resourceUrl.href,
      scopes,
      upstreamCodeVerifier: upstreamPkce.verifier,
    };
    await this.#store.put(
      'authorization-state',
      stateHandle,
      state,
      this.#authorizationStateTtlSeconds,
    );

    const target = new URL(this.#supabaseAuthorizationUrl.href);
    target.search = new URLSearchParams({
      client_id: this.#supabaseClientId,
      code_challenge: upstreamPkce.challenge,
      code_challenge_method: 'S256',
      redirect_uri: this.#supabaseRedirectUri.href,
      response_type: 'code',
      scope: UPSTREAM_SCOPES.join(' '),
      state: stateHandle,
    }).toString();
    res.redirect(302, target.href);
  }

  async completeAuthorizationCallback(input: {
    code?: string;
    error?: string;
    state?: string;
  }): Promise<string | undefined> {
    if (!input.state) {
      return undefined;
    }
    const state = await this.#store.take<AuthorizationState>('authorization-state', input.state);
    if (!state) {
      return undefined;
    }
    if (input.error) {
      return redirectWithError(state.clientRedirectUri, state.clientState, 'access_denied');
    }
    if (!input.code) {
      return redirectWithError(state.clientRedirectUri, state.clientState, 'server_error');
    }

    try {
      const upstreamTokens = await this.#exchangeUpstreamAuthorizationCode(
        input.code,
        state.upstreamCodeVerifier,
      );
      if (!upstreamTokens.refresh_token) {
        throw new UpstreamOAuthError(false);
      }
      const userInfo = await this.#fetchUserInfo(upstreamTokens.access_token);
      const authorizationCode = opaque(AUTHORIZATION_CODE_PREFIX);
      const nowSeconds = Math.floor(this.#now() / 1_000);
      const codeRecord: AuthorizationCode = {
        clientCodeChallenge: state.clientCodeChallenge,
        clientId: state.clientId,
        clientRedirectUri: state.clientRedirectUri,
        email: userInfo.email,
        resource: state.resource,
        scopes: state.scopes,
        subject: userInfo.sub,
        upstreamSession: {
          accessToken: upstreamTokens.access_token,
          accessTokenExpiresAt: nowSeconds + upstreamTokens.expires_in,
          refreshToken: upstreamTokens.refresh_token,
        },
      };
      await this.#store.put(
        'authorization-code',
        authorizationCode,
        codeRecord,
        this.#authorizationCodeTtlSeconds,
      );
      const redirect = new URL(state.clientRedirectUri);
      redirect.searchParams.set('code', authorizationCode);
      if (state.clientState) {
        redirect.searchParams.set('state', state.clientState);
      }
      return redirect.href;
    } catch {
      return redirectWithError(state.clientRedirectUri, state.clientState, 'server_error');
    }
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = await this.#store.get<AuthorizationCode>(
      'authorization-code',
      authorizationCode,
    );
    if (!record || !constantTimeEqual(record.clientId, client.client_id)) {
      throw new InvalidGrantError('Authorization code is invalid or expired');
    }
    return record.clientCodeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.#store.get<AuthorizationCode>(
      'authorization-code',
      authorizationCode,
    );
    if (
      !record ||
      !constantTimeEqual(record.clientId, client.client_id) ||
      !redirectUri ||
      !constantTimeEqual(record.clientRedirectUri, redirectUri) ||
      !sameResource(resource, this.#resourceUrl) ||
      !constantTimeEqual(record.resource, this.#resourceUrl.href)
    ) {
      throw new InvalidGrantError('Authorization code is invalid or bound to another request');
    }

    const consumedRecord = await this.#store.take<AuthorizationCode>(
      'authorization-code',
      authorizationCode,
    );
    if (
      !consumedRecord ||
      !constantTimeEqual(consumedRecord.clientId, record.clientId) ||
      !constantTimeEqual(consumedRecord.clientCodeChallenge, record.clientCodeChallenge)
    ) {
      throw new InvalidGrantError('Authorization code has already been consumed');
    }

    return await this.#issueBrokerTokens({
      clientId: record.clientId,
      email: record.email,
      resource: record.resource,
      scopes: record.scopes,
      subject: record.subject,
      upstreamSession: record.upstreamSession,
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    requestedScopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const grant = await this.#store.get<RefreshGrant>('refresh-token', refreshToken);
    if (
      !grant ||
      grant.expiresAt <= Math.floor(this.#now() / 1_000) ||
      !constantTimeEqual(grant.clientId, client.client_id) ||
      !sameResource(resource, this.#resourceUrl) ||
      !constantTimeEqual(grant.resource, this.#resourceUrl.href)
    ) {
      throw new InvalidGrantError('Refresh token is invalid, expired, or bound elsewhere');
    }
    const scopes = requestedScopes?.length ? requestedScopes : grant.scopes;
    if (scopes.some((scope) => !grant.scopes.includes(scope))) {
      throw new InvalidScopeError('Refresh cannot add scopes');
    }

    const consumedGrant = await this.#store.take<RefreshGrant>('refresh-token', refreshToken);
    if (
      !consumedGrant ||
      !constantTimeEqual(consumedGrant.sessionId, grant.sessionId) ||
      consumedGrant.expiresAt !== grant.expiresAt
    ) {
      throw new InvalidGrantError('Refresh token has already been consumed');
    }

    const session = await this.#store.get<BrokerSession>('session', grant.sessionId);
    if (!session || !constantTimeEqual(session.clientId, client.client_id)) {
      throw new InvalidGrantError('Refresh session is no longer active');
    }

    try {
      const refreshed = await this.#refreshUpstreamSession(session.upstreamSession.refreshToken);
      const nowSeconds = Math.floor(this.#now() / 1_000);
      const nextSession: BrokerSession = {
        ...session,
        scopes,
        upstreamSession: {
          accessToken: refreshed.access_token,
          accessTokenExpiresAt: nowSeconds + refreshed.expires_in,
          refreshToken: refreshed.refresh_token ?? session.upstreamSession.refreshToken,
        },
      };
      return await this.#issueBrokerTokens(nextSession, grant.sessionId);
    } catch (error) {
      if (error instanceof UpstreamOAuthError && error.retryable) {
        const remaining = grant.expiresAt - Math.floor(this.#now() / 1_000);
        if (remaining > 0) {
          await this.#store.put('refresh-token', refreshToken, grant, remaining);
        }
      }
      if (error instanceof InvalidScopeError || error instanceof InvalidGrantError) {
        throw error;
      }
      throw new ServerError('The upstream authorization session could not be refreshed');
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token.startsWith(ACCESS_TOKEN_PREFIX)) {
      throw new InvalidTokenError('Access token is invalid');
    }
    const grant = await this.#store.get<AccessGrant>('access-token', token);
    const nowSeconds = Math.floor(this.#now() / 1_000);
    if (!grant || grant.expiresAt <= nowSeconds) {
      throw new InvalidTokenError('Access token is invalid or expired');
    }
    const session = await this.#store.get<BrokerSession>('session', grant.sessionId);
    if (
      !session ||
      !constantTimeEqual(session.resource, this.#resourceUrl.href) ||
      session.upstreamSession.accessTokenExpiresAt <= nowSeconds + UPSTREAM_EXPIRY_BUFFER_SECONDS
    ) {
      throw new InvalidTokenError('Access session is invalid or expired');
    }

    const supabaseSession: SupabaseSessionPayload = {
      access_token: session.upstreamSession.accessToken,
      expires_at: session.upstreamSession.accessTokenExpiresAt,
    };
    return {
      token,
      clientId: session.clientId,
      scopes: session.scopes,
      expiresAt: grant.expiresAt,
      resource: new URL(session.resource),
      extra: {
        authMethod: 'mcp_oauth_broker',
        downstreamAccessToken: session.upstreamSession.accessToken,
        email: session.email,
        subject: session.subject,
        supabaseSession,
        upstreamClientId: this.#supabaseClientId,
      },
    };
  }

  readonly revokeToken = async (
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> => {
    if (request.token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const accessGrant = await this.#store.get<AccessGrant>('access-token', request.token);
      if (accessGrant) {
        const session = await this.#store.get<BrokerSession>('session', accessGrant.sessionId);
        if (session && constantTimeEqual(session.clientId, client.client_id)) {
          await this.#store.remove('access-token', request.token);
        }
      }
      return;
    }
    if (request.token.startsWith(REFRESH_TOKEN_PREFIX)) {
      const refreshGrant = await this.#store.take<RefreshGrant>('refresh-token', request.token);
      if (refreshGrant && constantTimeEqual(refreshGrant.clientId, client.client_id)) {
        await this.#store.remove('session', refreshGrant.sessionId);
      }
    }
  };

  async #issueBrokerTokens(
    session: BrokerSession,
    existingSessionId?: string,
  ): Promise<OAuthTokens> {
    const nowSeconds = Math.floor(this.#now() / 1_000);
    const upstreamRemaining =
      session.upstreamSession.accessTokenExpiresAt - nowSeconds - UPSTREAM_EXPIRY_BUFFER_SECONDS;
    const accessTtl = Math.min(this.#accessTokenTtlSeconds, upstreamRemaining);
    if (accessTtl <= 0) {
      throw new InvalidGrantError('Upstream access token is too close to expiry');
    }

    const sessionId = existingSessionId ?? opaque(SESSION_ID_PREFIX);
    const accessToken = opaque(ACCESS_TOKEN_PREFIX);
    const refreshToken = opaque(REFRESH_TOKEN_PREFIX);
    const accessExpiresAt = nowSeconds + accessTtl;
    const refreshExpiresAt = nowSeconds + this.#refreshTokenTtlSeconds;

    await this.#store.put('session', sessionId, session, this.#refreshTokenTtlSeconds);
    await this.#store.put(
      'access-token',
      accessToken,
      { expiresAt: accessExpiresAt, sessionId } satisfies AccessGrant,
      accessTtl,
    );
    await this.#store.put(
      'refresh-token',
      refreshToken,
      {
        clientId: session.clientId,
        expiresAt: refreshExpiresAt,
        resource: session.resource,
        scopes: session.scopes,
        sessionId,
      } satisfies RefreshGrant,
      this.#refreshTokenTtlSeconds,
    );

    return OAuthTokensSchema.parse({
      access_token: accessToken,
      expires_in: accessTtl,
      refresh_token: refreshToken,
      scope: session.scopes.join(' '),
      token_type: 'Bearer',
    });
  }

  async #exchangeUpstreamAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<UpstreamTokens> {
    const body = new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: this.#supabaseRedirectUri.href,
    });
    return await this.#requestUpstreamTokens(body);
  }

  async #refreshUpstreamSession(refreshToken: string): Promise<UpstreamTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return await this.#requestUpstreamTokens(body);
  }

  async #requestUpstreamTokens(body: URLSearchParams): Promise<UpstreamTokens> {
    let response: globalThis.Response;
    try {
      response = await this.#fetch(this.#supabaseTokenUrl, {
        method: 'POST',
        headers: {
          Authorization: basicAuthorization(this.#supabaseClientId, this.#supabaseClientSecret),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new UpstreamOAuthError(true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamOAuthError(response.status >= 500 || response.status === 429);
    }
    const parsed = UpstreamTokensSchema.safeParse(await parseJsonResponse(response));
    if (!parsed.success) {
      throw new UpstreamOAuthError(false);
    }
    return parsed.data;
  }

  async #fetchUserInfo(accessToken: string): Promise<z.infer<typeof UpstreamUserInfoSchema>> {
    let response: globalThis.Response;
    try {
      response = await this.#fetch(this.#supabaseUserInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new UpstreamOAuthError(true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamOAuthError(response.status >= 500 || response.status === 429);
    }
    const parsed = UpstreamUserInfoSchema.safeParse(await parseJsonResponse(response));
    if (!parsed.success) {
      throw new UpstreamOAuthError(false);
    }
    return parsed.data;
  }
}

export function isMcpBrokerAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX);
}
