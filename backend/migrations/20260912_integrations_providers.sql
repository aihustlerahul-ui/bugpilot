-- Add linear, slack, teams to provider_enum
ALTER TYPE provider_enum ADD VALUE IF NOT EXISTS 'linear';
ALTER TYPE provider_enum ADD VALUE IF NOT EXISTS 'slack';
ALTER TYPE provider_enum ADD VALUE IF NOT EXISTS 'teams';
