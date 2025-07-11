import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { createRemoteJWKSet, decodeJwt, JWTPayload, jwtVerify } from 'jose';
import { redis_token, redis_url, supabase_anon_key, supabase_base_url } from './config.js';
import decodeApiKey from './decode_api_key.js';

const COGNITO_REGION = 'us-east-1';
const COGNITO_USER_POOL_ID = 'us-east-1_SnSYiMoND';
const COGNITO_CLIENT_ID = '3p182unuqch7rahbp0trs1sprv';
const COGNITO_ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;
const COGNITO_JWKS_URL = `${COGNITO_ISSUER}/.well-known/jwks.json`;

const supabase = createClient(supabase_base_url, supabase_anon_key);

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

const jwksCognito = createRemoteJWKSet(new URL(COGNITO_JWKS_URL));

export interface AuthResult {
  isAuthenticated: boolean;
  response?: string;
}

export async function authenticateRequest(bearerKey: string): Promise<AuthResult> {
  // 1. 支持API Key
  const credentials = decodeApiKey(bearerKey);
  if (credentials) {
    const { email = '', password = '' } = credentials;
    const userIdFromRedis = await redis.get('lca_' + email);
    if (!userIdFromRedis) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        return { isAuthenticated: false, response: 'Unauthorized' };
      }
      if (data.user.role !== 'authenticated') {
        return { isAuthenticated: false, response: 'You are not an authenticated user.' };
      } else {
        await redis.setex('lca_' + email, 3600, data.user.id);
        return { isAuthenticated: true, response: data.user.id };
      }
    }
    return { isAuthenticated: true, response: String(userIdFromRedis) };
  }

  // 2. 判断JWT格式
  let jwtPayload: JWTPayload | undefined;
  try {
    jwtPayload = decodeJwt(bearerKey);
  } catch {
    // 不是JWT格式，尝试Supabase方式
    const { data: authData } = await supabase.auth.getUser(bearerKey);
    if (authData.user?.role === 'authenticated') {
      return { isAuthenticated: true, response: authData.user?.id };
    }
    return { isAuthenticated: false, response: 'User Not Found' };
  }

  // 3. 识别iss并路由验证
  const iss = jwtPayload?.iss || '';
  if (iss.startsWith('https://cognito-idp.')) {
    // ===== Cognito JWT校验 =====
    try {
      const { payload } = await jwtVerify(bearerKey, jwksCognito, {
        issuer: COGNITO_ISSUER,
        audience: COGNITO_CLIENT_ID, // 可选，建议严格校验
      });
      // 你可以返回 payload.sub、payload.email 或其它字段
      return { isAuthenticated: true, response: String(payload.sub || payload.email || '') };
    } catch (e) {
      return { isAuthenticated: false, response: 'Invalid Cognito token' };
    }
  } else if (iss.includes('supabase')) {
    // ===== Supabase JWT校验 =====
    const { data: authData } = await supabase.auth.getUser(bearerKey);
    if (authData.user?.role === 'authenticated') {
      return { isAuthenticated: true, response: authData.user?.id };
    }
    return { isAuthenticated: false, response: 'User Not Found' };
  }

  // 未支持的Token
  return { isAuthenticated: false, response: 'Unsupported token issuer' };
}
