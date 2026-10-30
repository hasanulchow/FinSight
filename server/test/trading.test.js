import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFill, applyFill, marketStatus } from "../src/lib/paper.js";
import { fifoRoundTrips } from "../src/lib/broker.js";
import { historicalMoves } from "../src/lib/earnings.js";
import { explainOptionPnl } from "../src/lib/optionPnl.js";
import { positionSize } from "../src/lib/risk.js";

const OPEN = { open: true }, CLOSED = { open: false };

test("market orders fill at the last price only while the market is open", () => {
  assert.equal(shouldFill({ type: "market", side: "buy" }, 100, OPEN), 100);
  assert.equal(shouldFill({ type: "market", side: "buy" }, 100, CLOSED), null);
});

test("limit orders fill at the limit or better", () => {
  assert.equal(shouldFill({ type: "limit", side: "buy", limit_price: 100 }, 101, OPEN), null);
  assert.equal(shouldFill({ type: "limit", side: "buy", limit_price: 100 }, 99, OPEN), 99);
  assert.equal(shouldFill({ type: "limit", side: "sell", limit_price: 100 }, 99, OPEN), null);
  assert.equal(shouldFill({ type: "limit", side: "sell", limit_price: 100 }, 102, OPEN), 102);
});

test("stop orders trigger when the price crosses the stop", () => {
  assert.equal(shouldFill({ type: "stop", side: "sell", stop_price: 90 }, 91, OPEN), null);
  assert.equal(shouldFill({ type: "stop", side: "sell", stop_price: 90 }, 89.5, OPEN), 89.5);
  assert.equal(shouldFill({ type: "stop", side: "buy", stop_price: 110 }, 111, OPEN), 111);
});

test("fills keep a weighted average cost and realize P/L on sells", () => {
  let { position } = applyFill(null, { side: "buy", qty: 10, price: 100 });
  ({ position } = applyFill(position, { side: "buy", qty: 10, price: 110 }));
  assert.equal(position.qty, 20);
  assert.equal(position.avg_cost, 105);
  const sell = applyFill(position, { side: "sell", qty: 5, price: 120 });
  assert.equal(sell.position.qty, 15);
  assert.equal(sell.realized, 75);
  assert.throws(() => applyFill(sell.position, { side: "sell", qty: 16, price: 120 }), /only have 15/);
});

test("market hours follow New York time", () => {
  assert.equal(marketStatus(new Date("2026-10-27T15:00:00Z")).open, true); // Tue 11:00 ET
  assert.equal(marketStatus(new Date("2026-10-27T12:00:00Z")).open, false); // Tue 08:00 ET
  assert.equal(marketStatus(new Date("2026-10-31T15:00:00Z")).label, "Weekend"); // Saturday
});

test("broker fills pair into FIFO round trips with stable ids", () => {
  const trips = fifoRoundTrips([
    { id: "b1", ticker: "AAPL", side: "buy", qty: 10, price: 100, date: "2026-01-02" },
    { id: "b2", ticker: "AAPL", side: "buy", qty: 5, price: 110, date: "2026-01-05" },
    { id: "s1", ticker: "AAPL", side: "sell", qty: 12, price: 120, date: "2026-02-01" },
  ]);
  const closed = trips.filter((t) => t.exit_price);
  assert.deepEqual(closed.map((t) => [t.quantity, t.entry_price]), [[10, 100], [2, 110]]);
  const open = trips.filter((t) => !t.exit_price);
  assert.deepEqual(open.map((t) => [t.quantity, t.entry_price]), [[3, 110]]);
  assert.equal(new Set(trips.map((t) => t.external_id)).size, trips.length);
});

test("post-earnings moves use the right session for before-open and after-close reports", () => {
  const day = (d, c) => ({ t: Date.parse(`${d}T20:00:00Z`), c });
  const bars = [day("2026-01-05", 100), day("2026-01-06", 110), day("2026-01-07", 99), day("2026-01-08", 100)];
  const moves = historicalMoves([{ date: "2026-01-06", hour: "bmo" }, { date: "2026-01-07", hour: "amc" }], bars);
  assert.deepEqual(moves.map((m) => m.move_pct), [10, 1.01]);
});

test("option P/L attribution adds up to the total", async () => {
  const r = await explainOptionPnl({ ticker: "AAPL", type: "call", strike: 250, expiration: "2026-11-20", contracts: 2, entry_date: "2026-10-20", entry_price: 9, entry_underlying: 245, exit_date: "2026-10-27", exit_price: 7.2, exit_underlying: 249 });
  const sum = Object.values(r.attribution).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - r.total_pnl) < 0.05);
  assert.equal(r.total_pnl, -360);
  assert.ok(r.attribution.stock_move > 0 && r.attribution.time_decay < 0 && r.attribution.volatility < 0);
});

test("position size risks the chosen percent of the account", () => {
  const r = positionSize({ account: 25000, riskPct: 1, entry: 100, stop: 95, side: "long" });
  assert.equal(r.shares, 50);
  assert.equal(r.risk_dollars, 250);
  assert.equal(r.targets["2R"], 110);
});
