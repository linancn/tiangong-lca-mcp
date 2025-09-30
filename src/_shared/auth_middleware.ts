import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { authenticateCognitoToken } from './cognito_auth.js';
import { redis_token, redis_url, supabase_base_url, supabase_publishable_key } from './config.js';
import decodeApiKey from './decode_api_key.js';
import type { SupabaseSessionPayload } from './supabase_session.js';
import { normalizeSupabaseSession } from './supabase_session.js';

export type { SupabaseSessionPayload } from './supabase_session.js';

const supabase = createClient(supabase_base_url, supabase_publishable_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

export interface AuthResult {
  isAuthenticated: boolean;
  response?: string;
  userId?: string;
  email?: string;
  supabaseSession?: SupabaseSessionPayload;
}

type CachedAuthPayload =
  | string
  | {
      userId?: string;
      session?: SupabaseSessionPayload | null;
    };

const SESSION_EXPIRY_BUFFER_SECONDS = 30;

function isSupabaseSessionReusable(
  session?: SupabaseSessionPayload | null,
): session is SupabaseSessionPayload {
  if (!session) {
    return false;
  }

  if (typeof session.access_token !== 'string' || session.access_token.length === 0) {
    return false;
  }

  const expiresAt =
    typeof session.expires_at === 'number'
      ? session.expires_at
      : session.expires_at === null
        ? null
        : undefined;

  if (!expiresAt) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return expiresAt - nowSeconds > SESSION_EXPIRY_BUFFER_SECONDS;
}

function calculateCacheTtlSeconds(session: SupabaseSessionPayload): number | null {
  const expiresAt = typeof session.expires_at === 'number' ? session.expires_at : null;

  if (!expiresAt) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const remaining = Math.floor(expiresAt - nowSeconds);

  if (remaining <= 0) {
    return null;
  }

  return Math.max(1, Math.min(remaining, 3600));
}

/**
 * 判断 token 类型
 * @param bearerKey - Bearer token
 * @returns 'cognito' | 'supabase' | 'api_key'
 */
export function getTokenType(bearerKey: string): 'cognito' | 'supabase' | 'api_key' {
  // Cognito JWT token 通常是三部分用点分隔的格式 (header.payload.signature)
  const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

  if (jwtPattern.test(bearerKey)) {
    try {
      // 解析 JWT payload 来进一步确认是否为 Cognito token
      const payload = JSON.parse(atob(bearerKey.split('.')[1]));
      if (payload.iss && payload.iss.includes('cognito')) {
        return 'cognito';
      }
    } catch (error) {
      // 如果解析失败，可能是其他格式的 JWT
    }
  }

  // 检查是否为 API key 格式（可以根据你的 API key 编码方式调整）
  const credentials = decodeApiKey(bearerKey);
  if (credentials) {
    return 'api_key';
  }

  // 默认使用 Supabase 认证
  return 'supabase';
}

export async function authenticateRequest(bearerKey: string): Promise<AuthResult> {
  const tokenType = getTokenType(bearerKey);

  switch (tokenType) {
    case 'cognito':
      return await authenticateCognitoRequest(bearerKey);

    case 'api_key':
      return await authenticateApiKeyRequest(bearerKey);

    case 'supabase':
    default:
      return await authenticateSupabaseRequest(bearerKey);
  }
}

/**
 * 使用 Cognito JWT 认证
 */
async function authenticateCognitoRequest(bearerKey: string): Promise<AuthResult> {
  const cognitoResult = await authenticateCognitoToken(bearerKey);
  return {
    isAuthenticated: cognitoResult.isAuthenticated,
    response: cognitoResult.response,
    userId: cognitoResult.userId,
    email: cognitoResult.email,
  };
}

/**
 * 使用 API Key 认证
 */
async function authenticateApiKeyRequest(bearerKey: string): Promise<AuthResult> {
  const credentials = decodeApiKey(bearerKey);
  if (credentials) {
    const { email = '', password = '' } = credentials;
    const cacheKey = 'lca_' + email;
    const cachedPayload = (await redis.get(cacheKey)) as CachedAuthPayload | null;

    let cachedUserId: string | undefined;
    let cachedSession: SupabaseSessionPayload | undefined;

    if (cachedPayload) {
      const applyCachedObject = (record: Record<string, unknown>) => {
        const recordUserId = record['userId'];
        if (typeof recordUserId === 'string') {
          cachedUserId = recordUserId;
        }

        if ('session' in record) {
          const normalized = normalizeSupabaseSession(record['session']);
          if (normalized) {
            cachedSession = normalized;
          }
        }
      };

      if (typeof cachedPayload === 'string') {
        try {
          const parsed = JSON.parse(cachedPayload) as Record<string, unknown>;
          applyCachedObject(parsed);
        } catch (_error) {
          cachedUserId = cachedPayload;
        }
      } else if (typeof cachedPayload === 'object') {
        applyCachedObject(cachedPayload as Record<string, unknown>);
      }
    }

    if (cachedUserId && isSupabaseSessionReusable(cachedSession)) {
      const ttlSeconds = calculateCacheTtlSeconds(cachedSession);

      if (ttlSeconds) {
        try {
          await redis.expire(cacheKey, ttlSeconds);
        } catch (error) {
          console.warn('Failed to refresh Redis TTL for cached Supabase session:', error);
        }
      }

      return {
        isAuthenticated: true,
        response: cachedUserId,
        userId: cachedUserId,
        email,
        supabaseSession: cachedSession,
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return {
        isAuthenticated: false,
        response: 'Unauthorized',
      };
    }

    if (data.user.role !== 'authenticated') {
      return {
        isAuthenticated: false,
        response: 'You are not an authenticated user.',
      };
    }

    const sessionTokens: SupabaseSessionPayload | undefined = data.session?.access_token
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token ?? null,
          expires_at: typeof data.session.expires_at === 'number' ? data.session.expires_at : null,
        }
      : undefined;

    const cacheValue: CachedAuthPayload = {
      userId: data.user.id,
      session: sessionTokens ?? null,
    };

    const cacheTtl = sessionTokens ? (calculateCacheTtlSeconds(sessionTokens) ?? 3600) : 3600;
    await redis.setex(cacheKey, cacheTtl, JSON.stringify(cacheValue));

    return {
      isAuthenticated: true,
      response: data.user.id,
      userId: data.user.id,
      email: data.user.email ?? email,
      supabaseSession: sessionTokens,
    };
  }

  return {
    isAuthenticated: false,
    response: 'Invalid API key',
  };
}

/**
 * 使用 Supabase 认证
 */
async function authenticateSupabaseRequest(bearerKey: string): Promise<AuthResult> {
  const { data: authData } = await supabase.auth.getUser(bearerKey);

  if (authData.user?.role === 'authenticated') {
    return {
      isAuthenticated: true,
      response: authData.user?.id,
      userId: authData.user?.id,
      email: authData.user?.email,
      supabaseSession: {
        access_token: bearerKey,
      },
    };
  }

  if (!authData || !authData.user) {
    return {
      isAuthenticated: false,
      response: 'User Not Found',
    };
  } else {
    if (authData.user.role !== 'authenticated') {
      return {
        isAuthenticated: false,
        response: 'Forbidden',
      };
    }
  }

  return {
    isAuthenticated: true,
    response: authData.user.id,
    userId: authData.user.id,
    email: authData.user.email,
    supabaseSession: {
      access_token: bearerKey,
    },
  };
}
