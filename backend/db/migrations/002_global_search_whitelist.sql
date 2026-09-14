INSERT INTO website_rules (scope_type, scope_id, action, match_type, pattern, active)
VALUES
  ('global', 'global', 'whitelist', 'exact', 'google.com', true),
  ('global', 'global', 'whitelist', 'exact', 'bing.com', true),
  ('global', 'global', 'whitelist', 'exact', 'duckduckgo.com', true)
ON CONFLICT (scope_type, scope_id, action, match_type, pattern)
DO UPDATE SET active = true, updated_at = now();
