export const supabase_base_url =
  process.env.SUPABASE_BASE_URL ?? 'https://qgzvkongdjqiiamzbbts.supabase.co';
export const supabase_publishable_key =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_EFWH4E61tpAtf82WQ37xTA_Fxa5OPyg';
export const supabase_functions_base_url = `${supabase_base_url.replace(/\/+$/u, '')}/functions/v1`;
export const x_region = process.env.X_REGION ?? 'us-east-1';

export const glad_api_base_url =
  process.env.GLAD_API_BASE_URL ?? 'https://www.globallcadataaccess.org/api/v1';
export const glad_api_key = process.env.GLAD_API_KEY ?? '';
