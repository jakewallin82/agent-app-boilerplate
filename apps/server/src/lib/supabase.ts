import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Service client for backend (bypasses RLS)
export const supabase = createClient(
  config.supabase.url,
  config.supabase.secretKey
);

// User client factory (respects RLS)
export function createUserClient(accessToken: string) {
  return createClient(
    config.supabase.url,
    config.supabase.publishableKey,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    }
  );
}
