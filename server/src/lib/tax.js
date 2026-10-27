import { listTrades, tradeResult, washSales } from "./journal.js";
import { computeXray } from "./portfolio.js";

// Tax helpers (educational): realized gains this year split short/long-term, possible wash sales,
// and tax-loss harvesting candidates among current holdings with wash-sale-safe dates.
// US rules of thumb only; not tax advice.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const DAY = 86_400_000;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export async function taxSummary(userId, { year = new Date().getUTCFullYear() } = {}) {
  const y = String(year);
  const trades = await listTrades(userId);
  const closed = trades.map((t) => ({ ...t, result: tradeResult(t) })).filter((t) => t.result && t.exit_date?.startsWith(y));

  // Long-term = held more than one year
  const bucket = { short_term: { gains: 0, losses: 0, trades: 0 }, long_term: { gains: 0, losses: 0, trades: 0 } };
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pnl: 0 }));
  for (const t of closed) {
    const held = (Date.parse(t.exit_date) - Date.parse(t.entry_date)) / DAY;
    const b = held > 365 ? bucket.long_term : bucket.short_term;
    b.trades++;
    if (t.result.pnl >= 0) b.gains += t.result.pnl;
    else b.losses += t.result.pnl;
    byMonth[Number(t.exit_date.slice(5, 7)) - 1].pnl += t.result.pnl;
  }
  for (const b of Object.values(bucket)) Object.assign(b, { gains: round(b.gains), losses: round(b.losses), net: round(b.gains + b.losses) });
  const net = round(bucket.short_term.net + bucket.long_term.net);
  const wash = washSales(trades).filter((w) => w.sold.startsWith(y));
  const washDisallowed = round(wash.reduce((s, w) => s + Math.abs(w.loss), 0));

  // Harvest candidates: holdings below cost basis
  const today = new Date().toISOString().slice(0, 10);
  const xray = await computeXray(userId, { technicals: false }).catch(() => null);
  const recentBuys = (ticker) => trades.filter((t) => t.ticker === ticker && t.side !== "short" && t.entry_date >= addDays(today, -30)).map((t) => t.entry_date).sort();
  const harvest = (xray?.positions ?? [])
    .filter((p) => !p.error && p.cost_basis != null && p.price < p.cost_basis)
    .map((p) => {
      const loss = (p.price - p.cost_basis) * p.shares;
      const buys = recentBuys(p.ticker);
      const lastBuy = buys[buys.length - 1];
      return {
        ticker: p.ticker,
        shares: p.shares,
        cost_basis: p.cost_basis,
        price: p.price,
        unrealized_loss: round(loss),
        loss_pct: round(((p.price - p.cost_basis) / p.cost_basis) * 100),
        // Selling now and buying back before this date could make the loss a wash sale
        rebuy_safe_after: addDays(today, 30),
        recent_buy_warning: lastBuy ? `You bought ${p.ticker} on ${lastBuy}. Selling at a loss before ${addDays(lastBuy, 31)} may count as a wash sale.` : null,
      };
    })
    .sort((a, b) => a.unrealized_loss - b.unrealized_loss);

  const harvestable = round(harvest.reduce((s, h) => s + h.unrealized_loss, 0));
  const notes = [];
  if (net > 0 && harvest.length) notes.push(`You have ${fmt(net)} of net realized gains and ${fmt(harvestable)} of unrealized losses. Realizing losses can offset gains, subject to wash-sale rules.`);
  if (net < -3000) notes.push("US filers can deduct up to $3,000 of net capital losses against ordinary income per year; the rest carries forward.");
  if (wash.length) notes.push(`${wash.length} possible wash sale${wash.length > 1 ? "s" : ""} this year: about ${fmt(washDisallowed)} of losses may be disallowed for now (added to the new lot's cost basis instead).`);
  if (bucket.short_term.net > 0) notes.push("Short-term gains (held a year or less) are usually taxed at ordinary income rates; long-term gains at lower rates.");

  return {
    year: Number(y),
    realized: { ...bucket, net, trades: closed.length },
    by_month: byMonth.map((m) => ({ ...m, pnl: round(m.pnl) })),
    wash_sales: wash,
    wash_disallowed_estimate: washDisallowed,
    harvest_candidates: harvest,
    harvestable_losses: harvestable,
    notes,
    disclaimer: "Based on the trades and holdings in FinSight, which may be incomplete. Educational only, not tax advice. Your broker's 1099-B is the official record; check with a tax professional.",
  };
}

const fmt = (x) => `${x < 0 ? "-" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
