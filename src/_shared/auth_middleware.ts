import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { authenticateCognitoToken } from './cognito_auth.js';
import { redis_token, redis_url, supabase_anon_key, supabase_base_url } from './config.js';
import decodeApiKey from './decode_api_key.js';

const supabase = createClient(supabase_base_url, supabase_anon_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

export interface AuthResult {
  isAuthenticated: boolean;
  response?: string;
}

export async function authenticateRequest(bearerKey: string): Promise<AuthResult> {
  const credentials = decodeApiKey(bearerKey);
  if (credentials) {
    const { email = '', password = '' } = credentials;
    const userIdFromRedis = await redis.get('lca_' + email);
    if (!userIdFromRedis) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });
      if (error) {
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
      } else {
        await redis.setex('lca_' + email, 3600, data.user.id);
        return {
          isAuthenticated: true,
          response: data.user.id,
        };
      }
    }
    return {
      isAuthenticated: true,
      response: String(userIdFromRedis),
    };
  }

  const { data: authData } = await supabase.auth.getUser(bearerKey);

  if (authData.user?.role === 'authenticated') {
    return {
      isAuthenticated: true,
      response: authData.user?.id,
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
  };
}

/**
 * 混合认证函数 - 支持 Cognito JWT 和 Supabase 认证
 * @param bearerKey - Bearer token 或 API key
 * @returns AuthResult
 */
export async function authenticateHybridRequest(bearerKey: string): Promise<AuthResult> {
  // 首先尝试作为 Cognito JWT token 验证
  if (bearerKey.includes('.') && bearerKey.split('.').length === 3) {
    // 看起来像是 JWT token
    const cognitoResult = await authenticateCognitoToken(bearerKey);
    if (cognitoResult.isAuthenticated) {
      return cognitoResult;
    }
  }

  // 如果 Cognito 验证失败，回退到原有的 Supabase 认证
  return authenticateRequest(bearerKey);
}
