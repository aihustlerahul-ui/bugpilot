-- Run this in Supabase SQL Editor for the QA Reporter project

CREATE TABLE IF NOT EXISTS workspace_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT workspace_members_email_unique UNIQUE (workspace_id, email),
  CONSTRAINT workspace_members_name_unique  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, member_id)
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workspace_members' AND policyname = 'workspace_members_owner'
  ) THEN
    CREATE POLICY "workspace_members_owner" ON workspace_members
      USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'project_members' AND policyname = 'project_members_owner'
  ) THEN
    CREATE POLICY "project_members_owner" ON project_members
      USING (project_id IN (
        SELECT p.id FROM projects p
        JOIN workspaces w ON w.id = p.workspace_id
        WHERE w.owner_id = auth.uid()
      ));
  END IF;
END $$;
