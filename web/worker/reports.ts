import { DurableObject } from "cloudflare:workers";

/**
 * ReportsDO — one global instance ("reports") that stores diagnostic reports sent from
 * the pages' "Send report" button, in its SQLite storage (free plan: 5 GB total).
 *
 * Guards so a public endpoint can't eat the free quota: max body size, per-IP daily cap
 * (IP stored only as a salted hash), and 30-day retention pruned on every insert.
 * Reading reports needs the REPORTS_TOKEN secret (see scripts/reports.mjs).
 */

export const MAX_REPORT_BYTES = 256 * 1024;
const PER_IP_PER_DAY = 30;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type StoredReport = { id: string; created_at: number; country: string; summary: string; body: string };

export class ReportsDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        ip_hash TEXT NOT NULL,
        country TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at);
    `);
  }

  /** Returns the new id, or null when this IP hit its daily cap. */
  add(ipHash: string, country: string, summary: string, body: string): string | null {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM reports WHERE created_at < ?", now - RETENTION_MS);
    const recent = sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created_at > ?", ipHash, now - 86_400_000)
      .one().n;
    if (recent >= PER_IP_PER_DAY) return null;
    const id = makeId();
    sql.exec("INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?)", id, now, ipHash, country, summary, body);
    return id;
  }

  list(limit: number): Omit<StoredReport, "body">[] {
    return this.ctx.storage.sql
      .exec<Omit<StoredReport, "body">>(
        "SELECT id, created_at, country, summary FROM reports ORDER BY created_at DESC LIMIT ?",
        limit,
      )
      .toArray();
  }

  get(id: string): StoredReport | null {
    const rows = this.ctx.storage.sql
      .exec<StoredReport>("SELECT id, created_at, country, summary, body FROM reports WHERE id = ?", id)
      .toArray();
    return rows[0] ?? null;
  }
}

function makeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "R-" + Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}
