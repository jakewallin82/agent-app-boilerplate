-- Migration: Add admin role support
-- Description: Adds admin flag to profiles and agent_id to sessions

-- Add is_admin column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON public.profiles(is_admin) WHERE is_admin = true;

-- Add agent_id column to sessions table if not exists
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT 'default';

-- Create index for agent queries
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON public.sessions(agent_id);
