import { listTrades, tradeResult, EMOTIONS } from "./journal.js";
import { getEventData } from "./events.js";

// Pre-trade checklist: the user's own trading rules (often the ones the AI coach suggested),
// checked before a trade is logged. Rules warn; the user can still log the trade.

export const RULE_DEFS = {
  require_stop: { label: "Always set a stop", type: "boolean" },
  cooldown_after_loss_days: { label: "Wait after a losing trade (days)", type: "number", min: 0, max: 30 },
  max_trades_per_day: { label: "Max new trades per day", type: "number", min: 1, max: 100 },
  max_risk_pct: { label: "Max risk per trade (% of account)", type: "number", min: 0.1, max: 20 },
  account_size: { label: "Account size ($), for the risk rule", type: "number", min: 100, max: 1e9 },
  max_position_pct: { label: "Max position size (% of account)", type: "number", min: 1, max: 100 },
  no_earnings_within_days: { label: "No new trades this many days before earnings", type: "number", min: 0, max: 30 },
  blocked_emotions: { label: "Don't trade when feeling", type: "list", options: EMOTIONS },
  min_reward_risk: { label: "Minimum reward:risk (needs a target)", type: "number", min: 0.5, max: 10 },
};

/** Validates rules from the client: unknown keys dropped, numbers clamped, empty values removed. */
export function cleanRules(input = {}) {
  const out = {};
  for (const [key, def] of Object.entries(RULE_DEFS)) {
    const v = input[key];
    if (v == null || v === "" || v === false) continue;
    if (def.type === "boolean") out[key] = true;
    else if (def.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[key] = Math.min(def.max, Math.max(def.min, n));
    } else if (def.type === "list") {
      const list = (Array.isArray(v) ? v : []).filter((x) => def.options.includes(x));
      if (list.length) out[key] = list;
    }
  }
  return out;
}

const daysBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Checks a planned trade against the rules. Returns every rule's result so the app can show a checklist.
 * `trade` uses journal fields (ticker, side, quantity, entry_price, stop_price, target_price, entry_date, emotion).
 */
export async function precheckTrade(userId, rules, trade) {
  const checks = [];
  const add = (rule, passed, message) => checks.push({ rule, label: RULE_DEFS[rule].label, passed, message });
  const entryDate = trade.entry_date || new Date().toISOString().slice(0, 10);
  const qty = Number(trade.quantity), entry = Number(trade.entry_price), stop = Number(trade.stop_price) || null, target = Number(trade.target_price) || null;
  const mult = trade.instrument === "option" ? 100 : 1;

  if (rules.require_stop) add("require_stop", !!stop, stop ? `Stop at $${stop}` : "No stop set for this trade");

  if (rules.cooldown_after_loss_days != null || rules.max_trades_per_day != null) {
    const trades = await listTrades(userId);
    if (rules.cooldown_after_loss_days != null) {
      const lastLoss = trades.filter((t) => t.exit_date && tradeResult(t)?.pnl < 0).sort((a, b) => b.exit_date.localeCompare(a.exit_date))[0];
      const gap = lastLoss ? daysBetween(entryDate, lastLoss.exit_date) : Infinity;
      const ok = gap >= rules.cooldown_after_loss_days;
      add("cooldown_after_loss_days", ok, lastLoss ? `Last loss: ${lastLoss.ticker} closed ${lastLoss.exit_date} (${Math.floor(gap)} day${Math.floor(gap) === 1 ? "" : "s"} ago)` : "No recent losing trade");
    }
    if (rules.max_trades_per_day != null) {
      const today = trades.filter((t) => t.entry_date === entryDate).length;
      add("max_trades_per_day", today < rules.max_trades_per_day, `${today} trade${today === 1 ? "" : "s"} already opened on ${entryDate}`);
    }
  }

  if (rules.max_risk_pct != null) {
    if (!rules.account_size) add("max_risk_pct", true, "Set your account size in the rules to check risk");
    else if (!stop) add("max_risk_pct", false, "Can't check risk without a stop");
    else {
      const risk = Math.abs(entry - stop) * qty * mult;
      const pct = (risk / rules.account_size) * 100;
      add("max_risk_pct", pct <= rules.max_risk_pct, `Risking $${risk.toFixed(0)} = ${pct.toFixed(2)}% of account (limit ${rules.max_risk_pct}%)`);
    }
  }

  if (rules.max_position_pct != null && rules.account_size) {
    const pct = ((entry * qty * mult) / rules.account_size) * 100;
    add("max_position_pct", pct <= rules.max_position_pct, `Position is ${pct.toFixed(1)}% of account (limit ${rules.max_position_pct}%)`);
  }

  if (rules.blocked_emotions?.length) {
    const blocked = trade.emotion && rules.blocked_emotions.includes(trade.emotion);
    add("blocked_emotions", !blocked, trade.emotion ? `Feeling: ${trade.emotion}` : "No emotion tagged");
  }

  if (rules.min_reward_risk != null) {
    if (!stop || !target) add("min_reward_risk", false, "Needs both a stop and a target");
    else {
      const rr = Math.abs(target - entry) / Math.abs(entry - stop);
      add("min_reward_risk", rr >= rules.min_reward_risk, `Reward:risk is ${rr.toFixed(2)} (minimum ${rules.min_reward_risk})`);
    }
  }

  if (rules.no_earnings_within_days != null && trade.ticker && trade.instrument !== "crypto") {
    const ev = await getEventData(String(trade.ticker).toUpperCase()).catch(() => null);
    const next = ev?.next_earnings?.date;
    const gap = next ? (Date.parse(next) - Date.parse(entryDate)) / 86_400_000 : Infinity;
    add("no_earnings_within_days", !(gap >= 0 && gap <= rules.no_earnings_within_days), next ? `Earnings on ${next} (${Math.round(gap)} days away)` : "No earnings date found in the next 90 days");
  }

  const failed = checks.filter((c) => !c.passed);
  return { ok: !failed.length, failed: failed.length, checks };
}
