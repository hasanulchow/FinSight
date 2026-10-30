import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import Svg, { Line, Path, Polygon } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, Chip, Input, Loading, Pill, Segmented, Stat } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";

// Trading bots in the Trade tab: rule-based strategies that find a chart pattern and act on it.
// Paper bots trade the practice account on their own; alert bots send the exact plan for the user to place.

const FILTERS = [["not_bear", "SPY above 200-day"], ["bull", "Strong uptrend"], ["off", "Any market"]];
const TARGETS = [["measured_move", "Measured move"], ["r2", "2R"], ["r3", "3R"]];
const STATUS = { watching: ["Watching", "eye-outline"], alerted: ["Alert sent", "notifications-outline"], pending_entry: ["Entering", "time-outline"], entered: ["In trade", "trending-up"], exited: ["Closed", "flag-outline"], skipped: ["Skipped", "remove-circle-outline"] };

/** Bull flag sketch: pole, flag channel, breakout arrow, stop and target lines. */
export function FlagDiagram({ height = 96 }) {
  const { c } = useTheme();
  return (
    <Svg width="100%" height={height} viewBox="0 0 220 100" preserveAspectRatio="xMidYMid meet">
      <Line x1="8" y1="88" x2="212" y2="88" stroke={c.border} strokeWidth="1" />
      <Path d="M14 84 L36 80 L48 70 L58 46 L66 38 L74 22" stroke={c.muted} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Polygon points="76,20 128,32 128,50 76,38" fill={c.soft(c.hue("violet"))} stroke={c.hue("violet")} strokeWidth="1.5" />
      <Path d="M76 24 L86 34 L96 28 L106 38 L116 33 L126 42" stroke={c.text} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M126 42 L150 18 L176 10" stroke={c.gain} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Polygon points="176,10 167,8 172,17" fill={c.gain} />
      <Line x1="76" y1="22" x2="212" y2="22" stroke={c.primary} strokeWidth="1" strokeDasharray="4 3" />
      <Line x1="76" y1="52" x2="212" y2="52" stroke={c.loss} strokeWidth="1" strokeDasharray="4 3" />
    </Svg>
  );
}

function summary(cfg) {
  const u = cfg.universe.type === "custom" ? `${cfg.universe.tickers.length} tickers` : cfg.universe.type === "large_caps" ? "Large caps" : "Your watchlist";
  return [
    u,
    FILTERS.find(([k]) => k === cfg.market_filter)?.[1],
    cfg.entry.trigger === "intraday" ? "Buy the break of the flag high" : "Buy after a close above the flag",
    cfg.exit.stop === "atr" ? `Stop ${cfg.exit.atr_mult}× ATR` : "Stop under the flag",
    `Target ${TARGETS.find(([k]) => k === cfg.exit.target)?.[1].toLowerCase()}`,
    `${cfg.sizing.risk_pct}% risk`,
  ].join(" · ");
}

export function BotsPanel({ onOpenStock }) {
  const { c } = useTheme();
  const s = useStyles();
  const [bots, setBots] = useState(null);
  const [regime, setRegime] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // {} = new
  const [busy, setBusy] = useState(null);
  const [results, setResults] = useState({}); // botId -> { run | backtest }
  const [signals, setSignals] = useState({});

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([api.bots(), api.marketRegime().catch(() => null)]);
      setBots(b);
      setRegime(r);
      const sig = {};
      await Promise.all(b.map(async (bot) => (sig[bot.id] = await api.botSignals(bot.id).catch(() => []))));
      setSignals(sig);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(bot, kind) {
    setBusy(`${bot.id}:${kind}`);
    setError(null);
    try {
      if (kind === "toggle") await api.updateBot(bot.id, { enabled: !bot.enabled });
      if (kind === "run") {
        const run = await api.runBot(bot.id);
        setResults((r) => ({ ...r, [bot.id]: { ...r[bot.id], run } }));
      }
      if (kind === "backtest") {
        const bt = await api.backtestBot(bot.id);
        setResults((r) => ({ ...r, [bot.id]: { ...r[bot.id], backtest: bt } }));
      }
      await load();
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  const regimeColor = regime?.state === "bear" ? c.loss : regime?.state === "bull" ? c.gain : c.warn;

  return (
    <View>
      {regime && (
        <View style={s.regime}>
          <View style={[s.dot, { backgroundColor: regimeColor }]} />
          <Text style={s.regimeText}>
            Market: <Text style={s.strong}>{regime.state === "bull" ? "strong uptrend" : regime.state === "bear" ? "below its 200-day" : regime.state === "neutral" ? "above its 200-day, not trending" : "unknown"}</Text>
          </Text>
          {regime.sma200 && <Text style={s.muted}>SPY {regime.close} · 200-day {regime.sma200}</Text>}
        </View>
      )}
      <ErrorNotice error={error} />
      {!bots && !error && <Loading text="Loading your bots…" />}

      {bots && !bots.length && (
        <View style={s.hero}>
          <FlagDiagram height={110} />
          <Text style={s.heroTitle}>Bull flag breakout bot</Text>
          <Text style={s.heroText}>
            Scans your stocks for a sharp rally followed by a tight pullback (the flag). When the market is healthy and price breaks above the flag, it buys in your practice account with a stop under the flag and a measured-move target, sized to your risk. Or it can just alert you.
          </Text>
          <Button title="Create this bot" icon="add" size="lg" onPress={() => setEditing({})} style={{ marginTop: 16, alignSelf: "stretch" }} />
        </View>
      )}

      {bots?.map((bot) => {
        const res = results[bot.id] ?? {};
        const log = res.run ?? bot.state?.last_log;
        const sig = signals[bot.id] ?? [];
        const open = sig.filter((x) => ["entered", "pending_entry"].includes(x.status));
        const closed = sig.filter((x) => x.status === "exited");
        return (
          <View key={bot.id} style={s.card}>
            <View style={s.cardHead}>
              <View style={[s.botIcon, { backgroundColor: c.soft(c.hue("violet")) }]}>
                <Ionicons name="hardware-chip-outline" size={20} color={c.hue("violet")} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.botName}>{bot.name}</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <Pill text={bot.config.mode === "paper" ? "Auto-trades practice" : "Alerts only"} color={bot.config.mode === "paper" ? c.primary : c.warn} icon={bot.config.mode === "paper" ? "school-outline" : "notifications-outline"} />
                  <Pill text={bot.enabled ? "On" : "Off"} color={bot.enabled ? c.gain : c.muted} />
                </View>
              </View>
              <Switch value={bot.enabled} onValueChange={() => act(bot, "toggle")} trackColor={{ true: c.primary, false: c.borderStrong }} />
            </View>
            <Text style={s.rules}>{summary(bot.config)}</Text>
            {log && (
              <Text style={s.muted}>
                Last run {new Date(log.at).toLocaleString()} · scanned {log.scanned} · {log.setups} setup{log.setups === 1 ? "" : "s"}{log.entered ? ` · entered ${log.entered}` : ""}{log.alerted ? ` · alerted ${log.alerted}` : ""}{log.regime_ok === false ? " · market filter blocked entries" : ""}
              </Text>
            )}
            {closed.length > 0 && (
              <Text style={[s.muted, { marginTop: 4 }]}>
                Closed {closed.length} · {closed.filter((x) => x.r_multiple > 0).length} winners · {closed.reduce((a, x) => a + Number(x.r_multiple ?? 0), 0).toFixed(1)}R total
              </Text>
            )}
            <View style={s.actions}>
              <Button title="Run now" icon="play" size="sm" variant="secondary" onPress={() => act(bot, "run")} loading={busy === `${bot.id}:run`} />
              <Button title="Backtest" icon="flask-outline" size="sm" variant="secondary" onPress={() => act(bot, "backtest")} loading={busy === `${bot.id}:backtest`} />
              <Button title="Edit" icon="create-outline" size="sm" variant="ghost" onPress={() => setEditing(bot)} />
            </View>
            {res.run?.setups?.length > 0 && (
              <View style={s.setups}>
                {res.run.setups.slice(0, 6).map((x) => (
                  <Pressable key={x.ticker} onPress={() => onOpenStock?.(x.ticker)} style={s.setupRow}>
                    <Text style={s.ticker}>{x.ticker}</Text>
                    <Text style={[s.muted, { flex: 1 }]}>{x.status === "breakout" ? `Broke out at $${x.breakout_close}` : `Flag forming · breakout above $${x.breakout_level} (${x.distance_to_breakout_pct}% away)`}</Text>
                    <Ionicons name="chevron-forward" size={14} color={c.muted} />
                  </Pressable>
                ))}
              </View>
            )}
            {res.backtest && <BacktestView data={res.backtest} />}
            {sig.length > 0 && (
              <View style={s.signals}>
                <Text style={s.subhead}>{open.length ? `${open.length} open · ` : ""}Recent signals</Text>
                {sig.slice(0, 6).map((x) => {
                  const [label, icon] = STATUS[x.status] ?? [x.status, "ellipse-outline"];
                  return (
                    <Pressable key={x.id} onPress={() => onOpenStock?.(x.ticker)} style={s.sigRow}>
                      <Ionicons name={icon} size={15} color={x.status === "exited" ? (x.r_multiple > 0 ? c.gain : c.loss) : c.textSecondary} />
                      <Text style={s.ticker}>{x.ticker}</Text>
                      <Text style={[s.muted, { flex: 1 }]} numberOfLines={1}>
                        {label}
                        {x.plan ? ` · ${x.plan.shares} sh, stop $${x.plan.stop}, target $${x.plan.target}` : x.setup ? ` · breakout above $${x.setup.breakout_level}` : ""}
                        {x.status === "exited" && x.r_multiple != null ? ` · ${x.r_multiple > 0 ? "+" : ""}${x.r_multiple}R (${x.exit_reason})` : ""}
                        {x.reason ? ` · ${x.reason}` : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
      {bots?.length > 0 && <Button title="New bot" icon="add" variant="ghost" onPress={() => setEditing({})} style={{ marginTop: 12, alignSelf: "flex-start" }} />}
      <Banner tone="info" icon="shield-checkmark-outline">Bots only trade your practice account. For real money, set a bot to Alerts and place the order yourself, so every real trade is your decision.</Banner>
      <BotSheet bot={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </View>
  );
}

export function BacktestView({ data }) {
  const { c } = useTheme();
  const s = useStyles();
  const maxAbs = Math.max(1, ...data.curve.map((p) => Math.abs(p.r)));
  return (
    <View style={s.bt}>
      <Text style={s.subhead}>Backtest · {data.tickers.length} stocks · {data.period.from ?? "–"} to {data.period.to}</Text>
      {data.trades === 0 ? (
        <Text style={s.muted}>No trades matched these rules in the test period. Try a larger universe or a looser market filter.</Text>
      ) : (
        <>
          <View style={s.btStats}>
            <Stat label="Trades" value={data.trades} />
            <Stat label="Win rate" value={`${data.win_rate}%`} />
            <Stat label="Avg per trade" value={`${data.avg_r > 0 ? "+" : ""}${data.avg_r}R`} color={data.avg_r >= 0 ? c.gain : c.loss} />
            <Stat label="Total" value={`${data.total_r > 0 ? "+" : ""}${data.total_r}R`} hint={`≈ ${data.account_return_pct}% of account`} color={data.total_r >= 0 ? c.gain : c.loss} />
          </View>
          <View style={s.curve}>
            {/* Cumulative R after each trade: up from the center line when ahead, down when behind */}
            {data.curve.slice(-60).map((p, i) => (
              <View key={i} style={s.curveCol}>
                <View style={s.curveHalf}>{p.r > 0 && <View style={[s.curveBar, { height: `${(p.r / maxAbs) * 100}%`, backgroundColor: c.gain }]} />}</View>
                <View style={[s.curveHalf, { justifyContent: "flex-start" }]}>{p.r < 0 && <View style={[s.curveBar, { height: `${(-p.r / maxAbs) * 100}%`, backgroundColor: c.loss }]} />}</View>
              </View>
            ))}
          </View>
          <Text style={s.muted}>Exits: {data.exits.target} target · {data.exits.stop} stop · {data.exits.time} time · max drawdown {data.max_drawdown_r}R · profit factor {data.profit_factor ?? "–"}</Text>
        </>
      )}
      <Text style={[s.muted, { marginTop: 6 }]}>{data.note}</Text>
    </View>
  );
}

function BotSheet({ bot, onClose, onSaved }) {
  const { c } = useTheme();
  const s = useStyles();
  const isNew = !bot?.id;
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState(null);
  const [tickers, setTickers] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [bt, setBt] = useState(null);

  useEffect(() => {
    if (!bot) return;
    setError(null);
    setBt(null);
    if (bot.id) {
      setName(bot.name);
      setCfg(bot.config);
      setTickers(bot.config.universe.tickers.join(", "));
    } else {
      api.botTemplates().then((t) => {
        const tpl = t.find((x) => x.key === "bull_flag_breakout");
        setName(tpl.name);
        setCfg(tpl.config);
        setTickers("");
      }).catch(setError);
    }
  }, [bot]);

  const set = (path, value) => {
    setBt(null);
    setCfg((x) => {
      const next = JSON.parse(JSON.stringify(x));
      const keys = path.split(".");
      let o = next;
      keys.slice(0, -1).forEach((k) => (o = o[k]));
      o[keys[keys.length - 1]] = value;
      return next;
    });
  };
  const config = () => ({ ...cfg, universe: { ...cfg.universe, tickers: tickers.split(/[\s,]+/).filter(Boolean) } });

  async function save(enable) {
    setBusy("save");
    setError(null);
    try {
      if (isNew) {
        const row = await api.createBot({ name, config: config() });
        if (enable) await api.updateBot(row.id, { enabled: true });
      } else await api.updateBot(bot.id, { name, config: config(), ...(enable && { enabled: true }) });
      onSaved();
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  async function test() {
    setBusy("test");
    setError(null);
    try {
      setBt(await api.backtestConfig(config()));
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  async function remove() {
    await api.deleteBot(bot.id).catch(() => {});
    onSaved();
  }

  return (
    <Sheet visible={!!bot} onClose={onClose} eyebrow="Trading bot" title={isNew ? "New bull flag bot" : "Edit bot"} maxWidth={640}>
      {!cfg ? (
        <Loading />
      ) : (
        <>
          <FlagDiagram />
          <Text style={s.label}>Name</Text>
          <Input value={name} onChangeText={setName} />

          <Text style={s.label}>Stocks to scan</Text>
          <Segmented options={[["watchlist", "Watchlist"], ["large_caps", "Large caps"], ["custom", "Custom"]]} value={cfg.universe.type} onChange={(v) => set("universe.type", v)} />
          {cfg.universe.type === "custom" && <Input value={tickers} onChangeText={(v) => { setTickers(v); setBt(null); }} placeholder="NVDA, AMD, META" autoCapitalize="characters" style={{ marginTop: 8 }} />}
          {cfg.universe.type === "large_caps" && <Text style={s.hint}>About 100 large US stocks, scanned 25 at a time.</Text>}

          <Text style={s.label}>Only trade when the market is…</Text>
          <View style={s.chips}>{FILTERS.map(([k, l]) => <Chip key={k} label={l} active={cfg.market_filter === k} onPress={() => set("market_filter", k)} />)}</View>

          <Text style={s.label}>Entry</Text>
          <Segmented options={[["intraday", "Break of flag high"], ["close", "Close above flag"]]} value={cfg.entry.trigger} onChange={(v) => set("entry.trigger", v)} />
          <View style={s.switchRow}>
            <Text style={[s.hint, { flex: 1, marginTop: 0 }]}>Require breakout volume of {cfg.entry.volume_mult}× average (close entries)</Text>
            <Switch value={cfg.entry.require_volume} onValueChange={(v) => set("entry.require_volume", v)} trackColor={{ true: c.primary, false: c.borderStrong }} />
          </View>

          <Text style={s.label}>Exit</Text>
          <View style={s.chips}>
            <Chip label="Stop under flag" active={cfg.exit.stop === "flag_low"} onPress={() => set("exit.stop", "flag_low")} />
            <Chip label="Stop 2× ATR" active={cfg.exit.stop === "atr"} onPress={() => set("exit.stop", "atr")} />
          </View>
          <View style={[s.chips, { marginTop: 8 }]}>{TARGETS.map(([k, l]) => <Chip key={k} label={`Target ${l}`} active={cfg.exit.target === k} onPress={() => set("exit.target", k)} />)}</View>
          <View style={[s.chips, { marginTop: 8 }]}>{[[10, "Exit after 10 days"], [15, "15 days"], [0, "No time stop"]].map(([d, l]) => <Chip key={d} label={l} active={cfg.exit.time_stop_days === d} onPress={() => set("exit.time_stop_days", d)} />)}</View>

          <Text style={s.label}>Risk per trade</Text>
          <View style={s.chips}>{[0.5, 1, 2].map((r) => <Chip key={r} label={`${r}% of account`} active={cfg.sizing.risk_pct === r} onPress={() => set("sizing.risk_pct", r)} />)}</View>
          <View style={[s.chips, { marginTop: 8 }]}>{[1, 3, 5].map((n) => <Chip key={n} label={`Max ${n} open`} active={cfg.sizing.max_positions === n} onPress={() => set("sizing.max_positions", n)} />)}</View>

          <Text style={s.label}>When it triggers</Text>
          <Segmented options={[["paper", "Auto-trade practice"], ["alert", "Alert me"]]} value={cfg.mode} onChange={(v) => set("mode", v)} />
          <Text style={s.hint}>{cfg.mode === "paper" ? "Buys in your practice account, places the stop, sells at the target or time stop." : "Sends a notification with entry, stop, target and shares. You place the order."}</Text>

          {bt && <BacktestView data={bt} />}
          <ErrorNotice error={error} />
          <Button title="Backtest these rules" icon="flask-outline" variant="secondary" onPress={test} loading={busy === "test"} style={{ marginTop: 16 }} />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Button title="Save" variant="ghost" onPress={() => save(false)} loading={busy === "save"} style={{ flex: 1 }} />
            <Button title={isNew ? "Save and turn on" : "Save and turn on"} icon="power" onPress={() => save(true)} loading={busy === "save"} style={{ flex: 1.4 }} />
          </View>
          {!isNew && <Button title="Delete bot" variant="danger" icon="trash-outline" onPress={remove} style={{ marginTop: 10 }} />}
        </>
      )}
    </Sheet>
  );
}

/** Stock page card: today's bull flag status for one ticker. */
export function PatternCard({ ticker }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [data, setData] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    api.patterns(ticker).then(setData).catch(() => setData({ bull_flag: null }));
  }, [ticker]);

  const f = data?.bull_flag;
  if (!f) return null;
  async function alertMe() {
    try {
      await api.createAlert({ ticker, type: "price_above", threshold: f.breakout_level });
      setNote(`Alert set: you'll hear when ${ticker} trades above $${f.breakout_level}.`);
    } catch (e) {
      setNote(e.message);
    }
  }
  return (
    <View style={[s.card, { marginTop: 14 }]}>
      <View style={s.cardHead}>
        <View style={[s.botIcon, { backgroundColor: sections.markets.soft }]}><Ionicons name="flag-outline" size={19} color={sections.markets.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.botName}>Bull flag {f.status === "breakout" ? "breakout" : "forming"}</Text>
          <Text style={s.muted}>Pole +{f.pole.gain_pct}% · {f.flag.bars}-day flag · gave back {f.flag.retrace_pct}% · {f.quality} quality</Text>
        </View>
        <Pill text={f.status === "breakout" ? "Breaking out" : `${f.distance_to_breakout_pct}% to trigger`} color={f.status === "breakout" ? c.gain : c.primary} />
      </View>
      <FlagDiagram height={80} />
      <View style={s.btStats}>
        <Stat label="Breakout above" value={`$${f.breakout_level}`} />
        <Stat label="Stop under" value={`$${f.stop_level}`} color={c.loss} />
        <Stat label="Measured move" value={`$${f.target_measured_move}`} color={c.gain} />
      </View>
      {f.status === "forming" && <Button title={`Alert me above $${f.breakout_level}`} icon="notifications-outline" size="sm" variant="secondary" onPress={alertMe} style={{ marginTop: 12, alignSelf: "flex-start" }} />}
      {note && <Text style={[s.muted, { marginTop: 8 }]}>{note}</Text>}
      <Text style={[s.muted, { marginTop: 8 }]}>Rule-based pattern detection on daily bars. Not a recommendation.</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  regime: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  regimeText: { color: c.text, fontSize: 14 },
  strong: { fontWeight: "700" },
  hero: { marginTop: 14, padding: 20, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  heroTitle: { color: c.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4, marginTop: 10 },
  heroText: { color: c.textSecondary, fontSize: 14.5, lineHeight: 22, marginTop: 6 },
  card: { marginTop: 14, padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  botIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  botName: { color: c.text, fontSize: 16, fontWeight: "700" },
  rules: { color: c.text, fontSize: 13, lineHeight: 19, marginTop: 12 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  setups: { marginTop: 12, gap: 6 },
  setupRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: c.surfaceAlt },
  ticker: { color: c.text, fontWeight: "800", fontSize: 13, minWidth: 48 },
  signals: { marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
  subhead: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  sigRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  bt: { marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: c.surfaceAlt },
  btStats: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 },
  curve: { flexDirection: "row", height: 60, gap: 2, marginVertical: 10 },
  curveCol: { flex: 1 },
  curveHalf: { flex: 1, justifyContent: "flex-end" },
  curveBar: { borderRadius: 2, minHeight: 2 },
  label: { fontWeight: "700", color: c.text, fontSize: 13, marginTop: 16, marginBottom: 8 },
  hint: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
}));
