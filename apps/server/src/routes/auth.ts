import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = new Hono();

// Verify token and return user
authRouter.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ user });
});
