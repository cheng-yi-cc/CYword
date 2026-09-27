export function allowedAuthSource(request: Request): boolean {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) return false;
  const origin = request.headers.get("Origin");
  if (!origin) return request.headers.get("Sec-Fetch-Site") !== "cross-site";
  return ["https://cyword.chengyi.me", "https://localhost", "http://localhost", "capacitor://localhost"].includes(origin);
}

export async function claimMailBudget(db: D1Database, now: number, hourly = 200, daily = 1000): Promise<boolean> {
  const hour = Math.floor(now / 3600), day = Math.floor(now / 86400);
  // Check both ceilings in the same atomic UPSERT, so concurrent distinct emails
  // cannot overshoot. No low per-IP ceiling penalizes shared campus networks.
  const claimed = await db.prepare(`INSERT INTO auth_mail_budget (id, hour_slot, day_slot, hour_count, day_count) VALUES (1, ?, ?, 1, 1)
    ON CONFLICT(id) DO UPDATE SET hour_slot = excluded.hour_slot, day_slot = excluded.day_slot,
      hour_count = CASE WHEN auth_mail_budget.hour_slot = excluded.hour_slot THEN auth_mail_budget.hour_count + 1 ELSE 1 END,
      day_count = CASE WHEN auth_mail_budget.day_slot = excluded.day_slot THEN auth_mail_budget.day_count + 1 ELSE 1 END
    WHERE (auth_mail_budget.hour_slot != excluded.hour_slot OR auth_mail_budget.hour_count < ?)
      AND (auth_mail_budget.day_slot != excluded.day_slot OR auth_mail_budget.day_count < ?)
    RETURNING id`).bind(hour, day, hourly, daily).first();
  return Boolean(claimed);
}
