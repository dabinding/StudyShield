CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE website_scope_type AS ENUM ('global', 'state', 'district', 'school', 'class', 'teacher', 'student');
CREATE TYPE website_rule_action AS ENUM ('blacklist', 'whitelist');
CREATE TYPE website_match_type AS ENUM ('exact', 'suffix');

CREATE TABLE website_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type website_scope_type NOT NULL,
  scope_id TEXT NOT NULL,
  action website_rule_action NOT NULL,
  match_type website_match_type NOT NULL DEFAULT 'suffix',
  pattern TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, action, match_type, pattern)
);
CREATE INDEX website_rules_scope_lookup ON website_rules (scope_type, scope_id) WHERE active = true;

CREATE TABLE website_classifications (
  domain TEXT PRIMARY KEY,
  allowed BOOLEAN NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('educational', 'non_educational', 'uncertain')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason TEXT NOT NULL,
  model TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX website_classifications_expiry ON website_classifications (expires_at);
