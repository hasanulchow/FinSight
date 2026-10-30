import { test } from "node:test";
import assert from "node:assert/strict";
import { journalStats, washSales, parseTradesCsv, tradeResult } from "../src/lib/journal.js";
import { cleanRules } from "../src/lib/rules.js";
import { nextRun } from "../src/lib/tasks.js";
import { hit } from "../src/lib/rateLimit.js";
import { unsubscribeToken, verifyUnsubscribe, renderWeeklyEmail } from "../src/lib/email.js";

const T = (o) => ({ side: "long", instrument: "stock", ...o });

test("trade results include P/L, return and R multiple", () => {
  const r = tradeResult(T({ quantity: 10, entry_price: 100, exit_price: 110, stop_price: 95, entry_date: "2026-01-01", exit_date: "2026-01-11" }));
  assert.equal(r.pnl, 100);
  assert.equal(r.r_multiple, 2);
  assert.equal(r.hold_days, 10);
  assert.equal(tradeResult(T({ instrument: "option", quantity: 1, entry_price: 2, exit_price: 3 })).pnl, 100); // 100 shares per contract
});

test("journal stats: win rate, profit factor, expectancy", () => {
  const s = journalStats([
    T({ ticker: "A", quantity: 1, entry_price: 100, exit_price: 120, entry_date: "2026-01-01", exit_date: "2026-01-02" }),
    T({ ticker: "B", quantity: 1, entry_price: 100, exit_price: 90, entry_date: "2026-01-03", exit_date: "2026-01-04" }),
  ]);
  assert.equal(s.totals.win_rate, 50);
  assert.equal(s.totals.profit_factor, 2);
  assert.equal(s.totals.expectancy, 5);
});

test("wash sales: a loss rebought within 30 days is flagged, an already-sold lot is not", () => {
  const flagged = washSales([
    T({ id: "1", ticker: "X", quantity: 1, entry_price: 100, exit_price: 90, entry_date: "2026-01-01", exit_date: "2026-01-10" }),
    T({ id: "2", ticker: "X", quantity: 1, entry_price: 91, entry_date: "2026-01-20" }),
  ]);
  assert.equal(flagged.length, 1);
  const clean = washSales([
    T({ id: "1", ticker: "Y", quantity: 1, entry_price: 100, exit_price: 110, entry_date: "2026-01-01", exit_date: "2026-01-05" }),
    T({ id: "2", ticker: "Y", quantity: 1, entry_price: 100, exit_price: 90, entry_date: "2026-01-06", exit_date: "2026-01-10" }),
  ]);
  assert.equal(clean.length, 0);
});

test("CSV import maps columns by name, including stop and emotion", () => {
  const { trades } = parseTradesCsv("Symbol,Side,Qty,Entry Date,Entry Price,Exit Price,Exit Date,Stop,Emotion\nTSLA,long,5,2026-08-21,240,221,2026-08-22,232,FOMO");
  assert.equal(trades[0].entry_price, 240);
  assert.equal(trades[0].stop_price, 232);
  assert.equal(trades[0].emotion, "fomo");
});

test("rules: unknown keys dropped and numbers clamped", () => {
  assert.deepEqual(cleanRules({ require_stop: true, max_risk_pct: 99, junk: 1, blocked_emotions: ["fomo", "nope"] }), { require_stop: true, max_risk_pct: 20, blocked_emotions: ["fomo"] });
});

test("automation schedules: weekdays skip the weekend, weekly lands on its day", () => {
  const fri = new Date("2026-10-30T15:00:00Z"); // Friday 15:00 UTC
  assert.equal(nextRun({ frequency: "weekdays", hour_utc: 14 }, fri), "2026-11-02T14:00:00.000Z"); // Monday
  assert.equal(nextRun({ frequency: "weekly", hour_utc: 14, weekday: 5 }, fri), "2026-11-06T14:00:00.000Z");
  assert.equal(nextRun({ frequency: "daily", hour_utc: 16 }, fri), "2026-10-30T16:00:00.000Z");
});

test("rate limiter allows `limit` hits per window", () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(hit("t", 3, 60_000, now).ok, true);
  assert.equal(hit("t", 3, 60_000, now).ok, false);
  assert.equal(hit("t", 3, 60_000, now + 61_000).ok, true);
});

test("unsubscribe tokens verify only for their user", () => {
  const u = "00000000-0000-0000-0000-000000000001";
  assert.equal(verifyUnsubscribe(u, unsubscribeToken(u)), true);
  assert.equal(verifyUnsubscribe("00000000-0000-0000-0000-000000000002", unsubscribeToken(u)), false);
});

test("weekly email escapes user content", () => {
  const html = renderWeeklyEmail({ portfolio: null, journal: { closed: 0 }, earnings: [], paper: null, theses: [{ ticker: "X", status: "intact", summary: "<script>alert(1)</script>" }] });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
