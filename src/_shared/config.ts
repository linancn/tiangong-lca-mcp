export const supabase_base_url =
  process.env.SUPABASE_BASE_URL ?? 'https://qgzvkongdjqiiamzbbts.supabase.co';
export const supabase_anon_key =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnenZrb25nZGpxaWlhbXpiYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAzNjUyMzQsImV4cCI6MjA1NTk0MTIzNH0.PsZIcjAqexpqIg-91twpKjALyw9big6Bn4WRLLoCzTo';
export const x_region = process.env.X_REGION ?? 'us-east-1';

export const redis_url = process.env.UPSTASH_REDIS_URL ?? '';
export const redis_token = process.env.UPSTASH_REDIS_TOKEN ?? '';
