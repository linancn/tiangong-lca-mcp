// Cognito Configuration
export const COGNITO_REGION = process.env.COGNITO_REGION ?? 'us-east-1';
export const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? 'us-east-1_SnSYiMoND';
export const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '3p182unuqch7rahbp0trs1sprv';
export const COGNITO_CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET; // Optional for public clients
export const COGNITO_ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;
export const COGNITO_JWKS_URL = `${COGNITO_ISSUER}/.well-known/jwks.json`;
export const COGNITO_BASE_URL = 'https://us-east-1snsyimond.auth.us-east-1.amazoncognito.com';

// Legacy Supabase Configuration (可以考虑移除)
export const supabase_base_url =
  process.env.SUPABASE_BASE_URL ?? 'https://qgzvkongdjqiiamzbbts.supabase.co';
export const supabase_publishable_key =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_EFWH4E61tpAtf82WQ37xTA_Fxa5OPyg';
export const x_region = process.env.X_REGION ?? 'us-east-1';

export const redis_url = process.env.UPSTASH_REDIS_URL ?? '';
export const redis_token = process.env.UPSTASH_REDIS_TOKEN ?? '';
