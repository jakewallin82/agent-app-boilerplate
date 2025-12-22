import { createMiddleware } from 'hono/factory';
import { supabase } from '../lib/supabase.js';

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    accessToken: string;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    // Fetch admin status from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    c.set('user', {
      id: user.id,
      email: user.email!,
      isAdmin: profile?.is_admin ?? false,
    });
    c.set('accessToken', token);
    await next();
  } catch (error) {
    console.error('Auth error:', error);
    return c.json({ error: 'Authentication failed' }, 401);
  }
});
