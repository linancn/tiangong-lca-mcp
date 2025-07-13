import { Redis } from '@upstash/redis';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID, redis_token, redis_url } from './config.js';

export interface AuthResult {
  isAuthenticated: boolean;
  response?: string;
  userId?: string;
  email?: string;
}

// 创建 Cognito JWT 验证器
const verifier = CognitoJwtVerifier.create({
  userPoolId: COGNITO_USER_POOL_ID,
  tokenUse: 'access',
  clientId: COGNITO_CLIENT_ID,
});

const redis = new Redis({
  url: redis_url,
  token: redis_token,
});

/**
 * 验证 Cognito JWT token
 * @param token - JWT access token 或 ID token
 * @returns AuthResult
 */
export async function authenticateCognitoToken(token: string): Promise<AuthResult> {
  try {
    // 首先检查 Redis 缓存
    const cachedUser = await redis.get(`cognito_${token.substring(0, 20)}`);
    if (cachedUser) {
      const userData = JSON.parse(cachedUser as string);
      return {
        isAuthenticated: true,
        response: userData.userId,
        userId: userData.userId,
        email: userData.email,
      };
    }

    // 验证 JWT token
    const payload = await verifier.verify(token);

    // 从 token payload 中提取用户信息
    const userId = (payload.sub as string) || (payload['cognito:username'] as string);
    const email = (payload.email as string) || (payload['cognito:email'] as string);

    if (!userId) {
      return {
        isAuthenticated: false,
        response: 'Invalid token: missing user ID',
      };
    }

    // 缓存用户信息到 Redis (1小时)
    const userData = { userId, email };
    await redis.setex(`cognito_${token.substring(0, 20)}`, 3600, JSON.stringify(userData));

    return {
      isAuthenticated: true,
      response: userId,
      userId,
      email,
    };
  } catch (error) {
    console.error('Cognito token verification failed:', error);
    return {
      isAuthenticated: false,
      response: error instanceof Error ? error.message : 'Token verification failed',
    };
  }
}

/**
 * 验证 ID token (包含更多用户信息)
 * @param idToken - Cognito ID token
 * @returns AuthResult
 */
export async function authenticateCognitoIdToken(idToken: string): Promise<AuthResult> {
  try {
    // 为 ID token 创建单独的验证器
    const idVerifier = CognitoJwtVerifier.create({
      userPoolId: COGNITO_USER_POOL_ID,
      tokenUse: 'id',
      clientId: COGNITO_CLIENT_ID,
    });

    const payload = await idVerifier.verify(idToken);

    const userId = payload.sub as string;
    const email = payload.email as string;
    const name = payload.name as string;

    return {
      isAuthenticated: true,
      response: userId,
      userId,
      email,
    };
  } catch (error) {
    console.error('Cognito ID token verification failed:', error);
    return {
      isAuthenticated: false,
      response: error instanceof Error ? error.message : 'ID token verification failed',
    };
  }
}
