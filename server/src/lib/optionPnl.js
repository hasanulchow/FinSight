import { blackScholes, impliedVol } from "./optionsMath.js";
import { getDailyBars, pricesEnabled } from "../tools/prices.js";
import { getQuoteLite } from "../tools/quote.js";

// "Why did my option lose money when the stock went up?"
// Splits an option position's P/L into the stock's move (delta/gamma), time decay (theta) and the
// change in implied volatility (vega), by re-pricing with Black-Scholes one factor at a time.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const DAY = 86_400_000;
const yearsBetween = (from, to) => Math.max(0, (Date.parse(`${to}T21:00:00Z`) - Date.parse(`${from}T21:00:00Z`)) / (365 * DAY));

/** Underlying close on (or just before) a date, from cached daily bars. */
async function closeOn(ticker, date) {
  if (!pricesEnabled()) return null;
  const bars = await getDailyBars(ticker).catch(() => null);
  if (!bars?.length) return null;
  const target = Date.parse(`${date}T23:59:59Z`);
  const bar = [...bars].reverse().find((b) => b.t <= target);
  return bar?.c ?? null;
}

/**
 * input: { ticker, type: call|put, strike, expiration, side: long|short, contracts,
 *          entry_date, entry_price, entry_underlying?, exit_date?, exit_price, exit_underlying? }
 * Prices are per share (as quoted); P/L uses 100 shares per contract.
 */
export async function explainOptionPnl(input) {
  const ticker = String(input.ticker ?? "").trim().toUpperCase();
  const type = input.type === "put" ? "put" : "call";
  const K = Number(input.strike), entryPrice = Number(input.entry_price), exitPrice = Number(input.exit_price);
  const contracts = Number(input.contracts) || 1;
  const side = input.side === "short" ? -1 : 1;
  const today = new Date().toISOString().slice(0, 10);
  const entryDate = input.entry_date, exitDate = input.exit_date || today, expiration = input.expiration;
  if (!ticker || !(K > 0) || !(entryPrice > 0) || !(exitPrice >= 0) || !entryDate || !expiration) throw bad("Need ticker, strike, expiration, entry date, entry price and current/exit price");
  if (exitDate < entryDate) throw bad("Exit date is before the entry date");

  let S0 = Number(input.entry_underlying) || (await closeOn(ticker, entryDate));
  let S1 = Number(input.exit_underlying) || (exitDate === today ? (await getQuoteLite(ticker).catch(() => null))?.price : await closeOn(ticker, exitDate));
  if (!(S0 > 0) || !(S1 > 0)) throw bad("Couldn't find the stock price for those dates. Enter the stock price at entry and exit.");

  const T0 = yearsBetween(entryDate, expiration), T1 = yearsBetween(exitDate, expiration);
  if (T0 <= 0) throw bad("The option had already expired at entry");
  const iv0 = impliedVol({ type, price: entryPrice, S: S0, K, T: T0 });
  // At or after expiry there's no time value left, so volatility no longer matters
  const iv1 = T1 > 0 ? impliedVol({ type, price: exitPrice, S: S1, K, T: T1 }) : iv0;
  if (iv0 == null) throw bad("The entry price is below the option's intrinsic value, so implied volatility can't be solved. Check the prices.");
  const sigma1 = iv1 ?? iv0;
  const bs = (S, T, sigma) => blackScholes({ type, S, K, T, sigma }).price;

  // Sequential attribution: stock move first, then time passing, then volatility; leftover = model residual
  const p0 = bs(S0, T0, iv0);
  const pStock = bs(S1, T0, iv0);
  const pTime = bs(S1, T1, iv0);
  const pVol = bs(S1, T1, sigma1);
  const mult = 100 * contracts * side;
  const total = (exitPrice - entryPrice) * mult;
  const parts = {
    stock_move: (pStock - p0) * mult,
    time_decay: (pTime - pStock) * mult,
    volatility: (pVol - pTime) * mult,
  };
  parts.other = total - parts.stock_move - parts.time_decay - parts.volatility; // pricing difference vs the model (spreads, dividends)

  const greeks0 = blackScholes({ type, S: S0, K, T: T0, sigma: iv0 });
  const breakeven = type === "call" ? K + entryPrice : K - entryPrice;
  const stockPct = ((S1 - S0) / S0) * 100;
  const days = Math.round((Date.parse(exitDate) - Date.parse(entryDate)) / DAY);
  const ivChange = iv1 != null ? (iv1 - iv0) * 100 : null;
  const money = (x) => `${x < 0 ? "-" : "+"}$${Math.abs(x).toFixed(0)}`;

  // Plain-English explanation built from the numbers (deterministic, no AI needed)
  const lines = [];
  lines.push(`The stock moved ${stockPct >= 0 ? "up" : "down"} ${Math.abs(stockPct).toFixed(1)}% ($${S0.toFixed(2)} → $${S1.toFixed(2)}), worth ${money(parts.stock_move)} to this position.`);
  lines.push(`${days} day${days === 1 ? "" : "s"} passed. Time decay ${parts.time_decay < 0 ? "cost" : "added"} $${Math.abs(parts.time_decay).toFixed(0)}${side < 0 ? " (short options earn decay)" : ""}.`);
  if (ivChange != null) lines.push(`Implied volatility went from ${(iv0 * 100).toFixed(0)}% to ${(iv1 * 100).toFixed(0)}% (${ivChange >= 0 ? "+" : ""}${ivChange.toFixed(0)} pts), worth ${money(parts.volatility)}.${ivChange < -5 ? " A volatility drop like this often follows earnings (\"IV crush\")." : ""}`);
  const LABEL = { stock_move: "the stock move", time_decay: "time decay", volatility: "the change in volatility" };
  const factors = Object.entries(parts).filter(([k]) => k !== "other");
  const biggest = [...factors].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const drags = factors.filter(([k, v]) => k !== "stock_move" && v < 0).sort((a, b) => a[1] - b[1]).map(([k]) => LABEL[k]);
  const why = total < 0 && parts.stock_move > 0
    ? `You were right on direction, but ${drags.join(" and ") || "pricing effects"} cost more than the stock move earned.`
    : `The biggest driver was ${LABEL[biggest[0]]}.`;

  return {
    ticker, type, strike: K, expiration, side: side > 0 ? "long" : "short", contracts,
    entry: { date: entryDate, option_price: entryPrice, stock_price: round(S0), iv_pct: round(iv0 * 100, 1), days_to_expiry: Math.round(T0 * 365) },
    exit: { date: exitDate, option_price: exitPrice, stock_price: round(S1), iv_pct: iv1 != null ? round(iv1 * 100, 1) : null, days_to_expiry: Math.round(T1 * 365) },
    total_pnl: round(total),
    attribution: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])),
    greeks_at_entry: { delta: round(greeks0.delta * side, 3), theta_per_day: round(greeks0.theta * 100 * contracts * side), vega_per_iv_point: round(greeks0.vega * 100 * contracts * side) },
    breakeven_at_expiry: round(breakeven),
    headline: `${total >= 0 ? "Made" : "Lost"} $${Math.abs(total).toFixed(0)} on ${contracts} ${ticker} ${K} ${type}${contracts > 1 ? "s" : ""}. ${why}`,
    explanation: lines,
    note: "Estimated with Black-Scholes from the prices you entered. 'Other' is the gap between the model and real prices (bid/ask spreads, dividends, early exercise).",
  };
}
