import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root (must be first import)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Export config values for type safety
export const config = {
  supabase: {
    url: process.env.VITE_SUPABASE_URL!,
    secretKey: process.env.SUPABASE_SECRET_KEY!,
    publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  server: {
    port: parseInt(process.env.PORT || '8080'),
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
};

// Validate required env vars
const required = [
  'VITE_SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
