-- Migration: Add shared file support
-- Description: Adds is_shared and agent_id columns to agent_files for shared storage

-- Add is_shared and agent_id columns to agent_files
ALTER TABLE public.agent_files
ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT 'default';

-- Create index for shared file queries
CREATE INDEX IF NOT EXISTS idx_agent_files_shared ON public.agent_files(agent_id, is_shared)
WHERE is_shared = true;

-- RLS policy for shared files (anyone can read)
DROP POLICY IF EXISTS "Anyone can read shared files" ON public.agent_files;
CREATE POLICY "Anyone can read shared files" ON public.agent_files
  FOR SELECT USING (is_shared = true);

-- Update existing policy to still allow users to manage their own files
-- (This policy already exists from previous migration, just ensuring it's there)
DROP POLICY IF EXISTS "Users can manage own files" ON public.agent_files;
CREATE POLICY "Users can manage own files" ON public.agent_files
  FOR ALL USING (auth.uid() = user_id);
