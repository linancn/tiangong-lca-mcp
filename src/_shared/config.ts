// Cognito Configuration
export const COGNITO_REGION = process.env.COGNITO_REGION ?? 'us-east-1';
export const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? 'us-east-1_SnSYiMoND';
export const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '3p182unuqch7rahbp0trs1sprv';
export const COGNITO_ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;
export const COGNITO_JWKS_URL = `${COGNITO_ISSUER}/.well-known/jwks.json`;

// Legacy Supabase Configuration (可以考虑移除)
export const supabase_base_url =
  process.env.SUPABASE_BASE_URL ?? 'https://qgzvkongdjqiiamzbbts.supabase.co';
export const supabase_anon_key =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnenZrb25nZGpxaWlhbXpiYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAzNjUyMzQsImV4cCI6MjA1NTk0MTIzNH0.PsZIcjAqexpqIg-91twpKjALyw9big6Bn4WRLLoCzTo';
export const x_region = process.env.X_REGION ?? 'us-east-1';

export const redis_url = process.env.UPSTASH_REDIS_URL ?? '';
export const redis_token = process.env.UPSTASH_REDIS_TOKEN ?? '';
