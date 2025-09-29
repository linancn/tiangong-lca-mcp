import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { authenticateCognitoToken } from './cognito_auth.js';
import { redis_token, redis_url, supabase_base_url, supabase_publishable_key } from './config.js';
import decodeApiKey from './decode_api_key.js';

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

export interface SupabaseSessionPayload {
  access_token: string;
  refresh_token?: string | null;
}

type CachedAuthPayload =
  | string
  | {
      userId?: string;
      session?: SupabaseSessionPayload | null;
    };

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
      if (typeof cachedPayload === 'string') {
        try {
          const parsed = JSON.parse(cachedPayload) as CachedAuthPayload;
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.userId === 'string') {
              cachedUserId = parsed.userId;
            }
            if (parsed.session && typeof parsed.session === 'object') {
              const { access_token, refresh_token } = parsed.session;
              if (typeof access_token === 'string' && access_token.length > 0) {
                cachedSession = {
                  access_token,
                  refresh_token: typeof refresh_token === 'string' ? refresh_token : null,
                };
              }
            }
          }
        } catch (_error) {
          cachedUserId = cachedPayload;
        }
      } else if (typeof cachedPayload === 'object') {
        if (typeof cachedPayload.userId === 'string') {
          cachedUserId = cachedPayload.userId;
        }
        if (cachedPayload.session && typeof cachedPayload.session === 'object') {
          const { access_token, refresh_token } = cachedPayload.session;
          if (typeof access_token === 'string' && access_token.length > 0) {
            cachedSession = {
              access_token,
              refresh_token: typeof refresh_token === 'string' ? refresh_token : null,
            };
          }
        }
      }
    }

    if (cachedUserId && cachedSession) {
      try {
        await redis.expire(cacheKey, 3600);
      } catch (error) {
        console.warn('Failed to refresh Redis TTL for cached Supabase session:', error);
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
        }
      : undefined;

    const cacheValue: CachedAuthPayload = {
      userId: data.user.id,
      session: sessionTokens ?? null,
    };

    await redis.setex(cacheKey, 3600, JSON.stringify(cacheValue));

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
