import pg from "pg";

export class InMemoryWebsitePolicyRepository {
  constructor({ rules = [], classifications = [] } = {}) {
    this.rules = [...rules];
    this.classifications = new Map(classifications.map(value => [value.domain, value]));
  }

  async findRules(scopes) {
    return this.rules.filter(rule => scopes.some(scope => rule.scopeType === scope.type && scope.ids.includes(rule.scopeId) && rule.active !== false));
  }

  async getClassification(domain, now) {
    const value = this.classifications.get(domain);
    return value?.expiresAt > now ? value : null;
  }

  async saveClassification(value) {
    this.classifications.set(value.domain, value);
  }

  async saveRule(rule) {
    const existing = this.rules.findIndex(item => item.scopeType === rule.scopeType && item.scopeId === rule.scopeId && item.action === rule.action && item.matchType === rule.matchType && item.pattern === rule.pattern);
    const saved = { id: existing >= 0 ? this.rules[existing].id : crypto.randomUUID(), ...rule };
    if (existing >= 0) this.rules.splice(existing, 1, saved);
    else this.rules.push(saved);
    return saved;
  }
}

export class PostgresWebsitePolicyRepository {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: Number(process.env.POLICY_DB_POOL_MAX ?? 30) });
  }

  async findRules(scopes) {
    const clauses = [];
    const values = [];
    for (const scope of scopes) {
      values.push(scope.type, scope.ids);
      const index = values.length - 1;
      clauses.push(`(scope_type = $${index} AND scope_id = ANY($${index + 1}))`);
    }
    if (!clauses.length) return [];
    const { rows } = await this.pool.query(
      `SELECT id, scope_type AS "scopeType", scope_id AS "scopeId", action, pattern, match_type AS "matchType"
       FROM website_rules WHERE active = true AND (${clauses.join(" OR ")})`, values
    );
    return rows;
  }

  async getClassification(domain, now) {
    const { rows } = await this.pool.query(
      `SELECT domain, allowed, category, confidence, reason, model, checked_at AS "checkedAt", expires_at AS "expiresAt"
       FROM website_classifications WHERE domain = $1 AND expires_at > to_timestamp($2 / 1000.0)`, [domain, now]
    );
    const value = rows[0];
    return value ? { ...value, expiresAt: new Date(value.expiresAt).getTime(), checkedAt: new Date(value.checkedAt).getTime() } : null;
  }

  async saveClassification(value) {
    await this.pool.query(
      `INSERT INTO website_classifications (domain, allowed, category, confidence, reason, model, checked_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))
       ON CONFLICT (domain) DO UPDATE SET allowed = EXCLUDED.allowed, category = EXCLUDED.category,
         confidence = EXCLUDED.confidence, reason = EXCLUDED.reason, model = EXCLUDED.model,
         checked_at = EXCLUDED.checked_at, expires_at = EXCLUDED.expires_at`,
      [value.domain, value.allowed, value.category, value.confidence, value.reason, process.env.OPENAI_MODEL ?? "gpt-5-mini", value.checkedAt, value.expiresAt]
    );
  }

  async saveRule(rule) {
    const { rows } = await this.pool.query(
      `INSERT INTO website_rules (scope_type, scope_id, action, match_type, pattern, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (scope_type, scope_id, action, match_type, pattern)
       DO UPDATE SET active = EXCLUDED.active, updated_at = now()
       RETURNING id, scope_type AS "scopeType", scope_id AS "scopeId", action, match_type AS "matchType", pattern, active`,
      [rule.scopeType, rule.scopeId, rule.action, rule.matchType, rule.pattern, rule.active]
    );
    return rows[0];
  }

  async close() { await this.pool.end(); }
}

export function createWebsitePolicyRepository(connectionString = process.env.POLICY_DATABASE_URL) {
  return connectionString ? new PostgresWebsitePolicyRepository(connectionString) : new InMemoryWebsitePolicyRepository();
}
