-- Migration: Add agent files support
-- Description: Adds file persistence for agent-generated files

-- Add columns to sessions table for naming and data folder tracking
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS data_folder TEXT;

-- Create agent_files table for tracking files in Supabase Storage
CREATE TABLE IF NOT EXISTS public.agent_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  file_path TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  content_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, file_path)
);

-- Enable RLS
ALTER TABLE public.agent_files ENABLE ROW LEVEL SECURITY;

-- Users can only access their own files (idempotent)
DROP POLICY IF EXISTS "Users can manage own files" ON public.agent_files;
CREATE POLICY "Users can manage own files" ON public.agent_files
  FOR ALL USING (auth.uid() = user_id);

-- Index for faster session file lookups
CREATE INDEX IF NOT EXISTS idx_agent_files_session ON public.agent_files(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_files_user ON public.agent_files(user_id);
