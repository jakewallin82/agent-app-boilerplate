import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only load .env file in development
if (process.env.NODE_ENV !== 'production') {
  const envPath = path.resolve(__dirname, '../../../.env');
  dotenv.config({ path: envPath });
}

// Validate required environment variables
const requiredVars = [
  'VITE_SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'ANTHROPIC_API_KEY',
];

const missing = requiredVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

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
  isProduction: process.env.NODE_ENV === 'production',
};
