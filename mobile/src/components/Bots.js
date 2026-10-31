import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Polygon } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, Chip, Input, Loading, Pill, Segmented, Stat } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";

// Trading bots in the Trade tab: rule-based strategies (bull flag, bear flag, new highs, pullbacks,
// oversold bounces, squeezes) that find a setup and act on it. Paper bots trade the practice account on
// their own (the bear flag bot sells short); alert bots send the exact plan for the user to place.

const STATUS = { watching: ["Watching", "eye-outline"], alerted: ["Alert sent", "notifications-outline"], pending_entry: ["Entering", "time-outline"], entered: ["In trade", "trending-up"], exited: ["Closed", "flag-outline"], skipped: ["Skipped", "remove-circle-outline"] };
const ORDER = ["bull_flag_breakout", "bear_flag_breakdown", "high_breakout", "trend_pullback", "rsi2_reversion", "squeeze_breakout"];
const strategyOf = (cfg) => cfg?.strategy ?? "bull_flag_breakout";

/** A small sketch of each strategy's setup: price path, entry level, stop, and the move it trades. */
export function StrategyDiagram({ strategy = "bull_flag_breakout", height = 96 }) {
  const { c } = useTheme();
  if (strategy === "bull_flag_breakout" || strategy === "bear_flag_breakdown") return <FlagDiagram height={height} bear={strategy === "bear_flag_breakdown"} />;
  const v = c.hue("violet");
  const arrow = (d, tip) => (
    <>
      <Path d={d} stroke={c.gain} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Polygon points={tip} fill={c.gain} />
    </>
  );
  const line = (d, color = c.text, w = 2) => <Path d={d} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  return (
    <Svg width="100%" height={height} viewBox="0 0 220 100" preserveAspectRatio="xMidYMid meet">
      <Line x1="8" y1="92" x2="212" y2="92" stroke={c.border} strokeWidth="1" />
      {strategy === "high_breakout" && (
        <>
          <Line x1="60" y1="30" x2="212" y2="30" stroke={c.primary} strokeWidth="1" strokeDasharray="4 3" />
          {line("M12 82 L30 62 L45 72 L65 46 L80 56 L100 31 L115 44 L135 31 L150 40 L165 31")}
          {arrow("M165 31 L185 15 L200 10", "200,10 191,9 196,17")}
        </>
      )}
      {strategy === "trend_pullback" && (
        <>
          {line("M10 86 Q110 66 212 34", v, 1.5)}
          {line("M10 76 L40 58 L70 48 L95 30 L115 50 L132 62 L150 46")}
          <Circle cx="132" cy="62" r="4" fill={c.surface} stroke={c.primary} strokeWidth="2" />
          {arrow("M150 46 L175 26 L196 14", "196,14 187,13 192,21")}
        </>
      )}
      {strategy === "rsi2_reversion" && (
        <>
          {line("M10 32 L95 31 L132 48 L180 46", v, 1.5)}
          {line("M10 30 L40 34 L70 27 L95 32 L115 55 L132 78")}
          <Circle cx="132" cy="78" r="4" fill={c.surface} stroke={c.primary} strokeWidth="2" />
          {arrow("M132 78 L155 58 L180 40", "180,40 171,41 177,48")}
        </>
      )}
      {strategy === "squeeze_breakout" && (
        <>
          {line("M10 14 Q90 40 140 42 Q180 40 212 10", v, 1.5)}
          {line("M10 90 Q90 64 140 60 Q180 62 212 88", v, 1.5)}
          {line("M12 56 L30 40 L50 66 L70 44 L90 56 L110 48 L128 53 L140 50")}
          {arrow("M140 50 L172 26 L196 16", "196,16 187,15 192,23")}
        </>
      )}
    </Svg>
  );
}

/** Bull flag sketch: pole, flag channel, breakout arrow, stop and target lines. The bear flag is its mirror image. */
export function FlagDiagram({ height = 96, bear = false }) {
  const { c } = useTheme();
  return (
    <Svg width="100%" height={height} viewBox="0 0 220 100" preserveAspectRatio="xMidYMid meet">
      <G transform={bear ? "translate(0 100) scale(1 -1)" : undefined}>
      <Line x1="8" y1="88" x2="212" y2="88" stroke={c.border} strokeWidth="1" />
      <Path d="M14 84 L36 80 L48 70 L58 46 L66 38 L74 22" stroke={c.muted} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Polygon points="76,20 128,32 128,50 76,38" fill={c.soft(c.hue("violet"))} stroke={c.hue("violet")} strokeWidth="1.5" />
      <Path d="M76 24 L86 34 L96 28 L106 38 L116 33 L126 42" stroke={c.text} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M126 42 L150 18 L176 10" stroke={bear ? c.loss : c.gain} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Polygon points="176,10 167,8 172,17" fill={bear ? c.loss : c.gain} />
      <Line x1="76" y1="22" x2="212" y2="22" stroke={c.primary} strokeWidth="1" strokeDasharray="4 3" />
      <Line x1="76" y1="52" x2="212" y2="52" stroke={bear ? c.gain : c.loss} strokeWidth="1" strokeDasharray="4 3" />
      </G>
    </Svg>
  );
}

/** "Buy the break of the flag high", "Short after a close below the flag low", "Buy at the next open...". */
function entryText(tpl, trigger) {
  const act = tpl.direction === "short" ? "Short" : "Buy";
  if (tpl.entry_type === "close") return `${act} at the next open after the signal`;
  return trigger === "intraday" ? `${act} the break of ${tpl.level_name}` : `${act} after a close ${tpl.direction === "short" ? "below" : "above"} ${tpl.level_name}`;
}

function summary(cfg, tpl) {
  const u = cfg.universe.type === "custom" ? `${cfg.universe.tickers.length} tickers` : cfg.universe.type === "large_caps" ? "Large caps" : "Your watchlist";
  if (!tpl) return u;
  const target = tpl.targets.find(([k]) => k === (cfg.exit.target === "measured_move" ? "pattern" : cfg.exit.target))?.[1];
  return [
    u,
    tpl.filters.find(([k]) => k === cfg.market_filter)?.[1],
    entryText(tpl, cfg.entry.trigger),
    cfg.exit.stop === "atr" ? `Stop ${cfg.exit.atr_mult}× ATR` : tpl.stop_label,
    target && (/^\dR$/.test(target) ? `Target ${target}` : `Exit: ${target.toLowerCase()}`),
    `${cfg.sizing.risk_pct}% risk`,
  ].filter(Boolean).join(" · ");
}

/** One line for a scanned setup: what formed and where it triggers. */
function setupText(x) {
  const lvl = x.level ?? x.breakout_level;
  const dir = x.direction === "short" ? "below" : "above";
  if (x.status === "triggered" || x.status === "breakout") return `${x.summary ?? "Breakout"} · triggered at ${x.trigger_close ?? x.breakout_close}`;
  const away = x.distance_pct ?? x.distance_to_breakout_pct;
  return `${x.summary ?? "Flag forming"} · triggers ${dir} ${lvl}${away != null ? ` (${away}% away)` : ""}`;
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
  const [templates, setTemplates] = useState({});

  const load = useCallback(async () => {
    try {
      const [b, r, t] = await Promise.all([api.bots(), api.marketRegime().catch(() => null), api.botTemplates().catch(() => [])]);
      setBots(b);
      setRegime(r);
      if (t.length) setTemplates(Object.fromEntries(t.map((x) => [x.key, x])));
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
          <Text style={s.heroTitle}>Pick a strategy</Text>
          <Text style={s.heroText}>
            Each bot scans your stocks for one setup. When the market filter allows it and the entry rule triggers, it trades your practice account with a stop, a target and position sizing from your risk, or it just alerts you. Backtest any of them before turning it on.
          </Text>
          <StrategyGrid templates={templates} onPick={(key) => setEditing({ template: key })} />
        </View>
      )}

      {bots?.map((bot) => {
        const res = results[bot.id] ?? {};
        const log = res.run ?? bot.state?.last_log;
        const sig = signals[bot.id] ?? [];
        const open = sig.filter((x) => ["entered", "pending_entry"].includes(x.status));
        const closed = sig.filter((x) => x.status === "exited");
        const tpl = templates[strategyOf(bot.config)];
        return (
          <View key={bot.id} style={s.card}>
            <View style={s.cardHead}>
              <View style={[s.botIcon, { backgroundColor: c.soft(tpl?.direction === "short" ? c.loss : c.hue("violet")) }]}>
                <Ionicons name={tpl?.direction === "short" ? "trending-down" : "hardware-chip-outline"} size={20} color={tpl?.direction === "short" ? c.loss : c.hue("violet")} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.botName}>{bot.name}</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <Pill text={bot.config.mode === "paper" ? "Auto-trades practice" : "Alerts only"} color={bot.config.mode === "paper" ? c.primary : c.warn} icon={bot.config.mode === "paper" ? "school-outline" : "notifications-outline"} />
                  {tpl?.direction === "short" && <Pill text="Sells short" color={c.loss} icon="trending-down" />}
                  <Pill text={bot.enabled ? "On" : "Off"} color={bot.enabled ? c.gain : c.muted} />
                </View>
              </View>
              <Switch value={bot.enabled} onValueChange={() => act(bot, "toggle")} trackColor={{ true: c.primary, false: c.borderStrong }} />
            </View>
            {tpl && bot.name !== tpl.name && <Text style={[s.muted, { marginTop: 10 }]}>{tpl.name}</Text>}
            <Text style={s.rules}>{summary(bot.config, tpl)}</Text>
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
                    <Text style={[s.muted, { flex: 1 }]}>{setupText(x)}</Text>
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
                        {x.plan ? ` · ${x.plan.side === "short" ? "short " : ""}${x.plan.shares} sh, stop ${x.plan.stop}${x.plan.target != null ? `, target ${x.plan.target}` : ""}` : x.setup ? ` · triggers ${x.setup.direction === "short" ? "below" : "above"} ${x.setup.level ?? x.setup.breakout_level}` : ""}
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
      <BotSheet bot={editing} templates={templates} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
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
          <Text style={s.muted}>Exits: {data.exits.target} target · {data.exits.stop} stop · {data.exits.time} time{data.exits.rule ? ` · ${data.exits.rule} by rule` : ""} · max drawdown {data.max_drawdown_r}R · profit factor {data.profit_factor ?? "–"}</Text>
        </>
      )}
      <Text style={[s.muted, { marginTop: 6 }]}>{data.note}</Text>
    </View>
  );
}

/** Cards for every strategy: sketch, name, long or short, what it does. */
function StrategyGrid({ templates, onPick }) {
  const { c } = useTheme();
  const s = useStyles();
  const keys = ORDER.filter((k) => templates[k]);
  if (!keys.length) return <Loading />;
  return (
    <View style={s.grid}>
      {keys.map((k) => {
        const t = templates[k];
        return (
          <Pressable key={k} onPress={() => onPick(k)} style={({ hovered }) => [s.stratCard, hovered && { borderColor: c.primary }]}>
            <StrategyDiagram strategy={k} height={64} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <Text style={s.stratName}>{t.name}</Text>
              <Pill text={t.direction === "short" ? "Short" : "Long"} color={t.direction === "short" ? c.loss : c.gain} />
            </View>
            <Text style={s.stratText} numberOfLines={4}>{t.description}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function BotSheet({ bot, templates, onClose, onSaved }) {
  const { c } = useTheme();
  const s = useStyles();
  const isNew = !bot?.id;
  const [name, setName] = useState("");
  const [cfg, setCfg] = useState(null);
  const [tickers, setTickers] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [bt, setBt] = useState(null);
  const [key, setKey] = useState(null);
  const tpl = templates[key];

  useEffect(() => {
    if (!bot) return;
    setError(null);
    setBt(null);
    if (bot.id) {
      setKey(strategyOf(bot.config));
      setName(bot.name);
      // Older bull flag bots stored "flag_low" / "measured_move"
      setCfg({ ...bot.config, strategy: strategyOf(bot.config), exit: { ...bot.config.exit, stop: bot.config.exit.stop === "atr" ? "atr" : "pattern", target: bot.config.exit.target === "measured_move" ? "pattern" : bot.config.exit.target } });
      setTickers(bot.config.universe.tickers.join(", "));
    } else {
      setKey(bot.template ?? null);
      setCfg(null);
      setTickers("");
    }
  }, [bot]);

  useEffect(() => {
    if (bot && !bot.id && key && templates[key]) {
      setName(templates[key].name);
      setCfg(templates[key].config);
      setBt(null);
    }
  }, [bot, key, templates]);

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
        const row = await api.createBot({ name, template: key, config: config() });
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
    <Sheet visible={!!bot} onClose={onClose} eyebrow="Trading bot" title={isNew ? (tpl ? `New ${tpl.name.toLowerCase()} bot` : "Choose a strategy") : "Edit bot"} maxWidth={640}>
      {isNew && !key ? (
        <StrategyGrid templates={templates} onPick={setKey} />
      ) : !cfg || !tpl ? (
        <Loading />
      ) : (
        <>
          <StrategyDiagram strategy={key} />
          <Text style={s.hint}>{tpl.description}</Text>
          {isNew && <Button title="Change strategy" icon="swap-horizontal" size="sm" variant="ghost" onPress={() => setKey(null)} style={{ alignSelf: "flex-start", marginTop: 6 }} />}
          <Text style={s.label}>Name</Text>
          <Input value={name} onChangeText={setName} />

          <Text style={s.label}>Stocks to scan</Text>
          <Segmented options={[["watchlist", "Watchlist"], ["large_caps", "Large caps"], ["custom", "Custom"]]} value={cfg.universe.type} onChange={(v) => set("universe.type", v)} />
          {cfg.universe.type === "custom" && <Input value={tickers} onChangeText={(v) => { setTickers(v); setBt(null); }} placeholder="NVDA, AMD, META" autoCapitalize="characters" style={{ marginTop: 8 }} />}
          {cfg.universe.type === "large_caps" && <Text style={s.hint}>About 100 large US stocks, scanned 25 at a time.</Text>}

          <Text style={s.label}>Only trade when the market is…</Text>
          <View style={s.chips}>{tpl.filters.map(([k, l]) => <Chip key={k} label={l} active={cfg.market_filter === k} onPress={() => set("market_filter", k)} />)}</View>

          {tpl.params.length > 0 && <Text style={s.label}>Setup</Text>}
          {tpl.params.map((p) => (
            <View key={p.key} style={s.paramRow}>
              <Text style={[s.hint, { marginTop: 0, minWidth: 150 }]}>{p.label}</Text>
              <View style={s.chips}>{p.options.map((o) => <Chip key={o} label={`${o}${p.suffix}`} active={cfg.pattern_params[p.key] === o} onPress={() => set(`pattern_params.${p.key}`, o)} />)}</View>
            </View>
          ))}

          <Text style={s.label}>Entry</Text>
          {tpl.entry_type === "close" ? (
            <Text style={[s.hint, { marginTop: 0 }]}>{entryText(tpl, "close")}: the signal is the day's close.</Text>
          ) : (
            <>
              <Segmented options={[["intraday", `Break of ${tpl.level_name.replace(/^the /, "")}`], ["close", tpl.direction === "short" ? "Close below" : "Close above"]]} value={cfg.entry.trigger} onChange={(v) => set("entry.trigger", v)} />
              <View style={s.switchRow}>
                <Text style={[s.hint, { flex: 1, marginTop: 0 }]}>Require volume of {cfg.entry.volume_mult}× average on the trigger day (close entries)</Text>
                <Switch value={cfg.entry.require_volume} onValueChange={(v) => set("entry.require_volume", v)} trackColor={{ true: c.primary, false: c.borderStrong }} />
              </View>
            </>
          )}

          <Text style={s.label}>Exit</Text>
          <View style={s.chips}>
            <Chip label={tpl.stop_label} active={cfg.exit.stop === "pattern"} onPress={() => set("exit.stop", "pattern")} />
            <Chip label="Stop 2× ATR" active={cfg.exit.stop === "atr"} onPress={() => set("exit.stop", "atr")} />
          </View>
          <View style={[s.chips, { marginTop: 8 }]}>{tpl.targets.map(([k, l]) => <Chip key={k} label={/^\dR$/.test(l) ? `Target ${l}` : l} active={cfg.exit.target === k} onPress={() => set("exit.target", k)} />)}</View>
          <View style={[s.chips, { marginTop: 8 }]}>{[[10, "Exit after 10 days"], [15, "15 days"], [0, "No time stop"]].map(([d, l]) => <Chip key={d} label={l} active={cfg.exit.time_stop_days === d} onPress={() => set("exit.time_stop_days", d)} />)}</View>

          <Text style={s.label}>Risk per trade</Text>
          <View style={s.chips}>{[0.5, 1, 2].map((r) => <Chip key={r} label={`${r}% of account`} active={cfg.sizing.risk_pct === r} onPress={() => set("sizing.risk_pct", r)} />)}</View>
          <View style={[s.chips, { marginTop: 8 }]}>{[1, 3, 5].map((n) => <Chip key={n} label={`Max ${n} open`} active={cfg.sizing.max_positions === n} onPress={() => set("sizing.max_positions", n)} />)}</View>

          <Text style={s.label}>When it triggers</Text>
          <Segmented options={[["paper", "Auto-trade practice"], ["alert", "Alert me"]]} value={cfg.mode} onChange={(v) => set("mode", v)} />
          <Text style={s.hint}>{cfg.mode === "paper" ? (tpl.direction === "short" ? "Sells short in your practice account, places a buy stop above, covers at the target or time stop." : "Buys in your practice account, places the stop, sells at the target, exit rule or time stop.") : "Sends a notification with entry, stop, target and shares. You place the order."}</Text>

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

/** Stock page card: a bull or bear flag on this chart, plus any other bot strategy setups. */
export function PatternCard({ ticker }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [data, setData] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    setNote(null);
    api.patterns(ticker).then(setData).catch(() => setData({ bull_flag: null }));
  }, [ticker]);

  const bear = !data?.bull_flag && data?.bear_flag ? data.bear_flag : null;
  const f = data?.bull_flag ?? bear;
  const others = data?.setups ?? [];
  if (!f && !others.length) return null;
  const level = f && (bear ? f.breakdown_level : f.breakout_level);
  const triggered = f && ["breakout", "breakdown"].includes(f.status);
  async function alertMe() {
    try {
      await api.createAlert({ ticker, type: bear ? "price_below" : "price_above", threshold: level });
      setNote(`Alert set: you'll hear when ${ticker} trades ${bear ? "below" : "above"} $${level}.`);
    } catch (e) {
      setNote(e.message);
    }
  }
  return (
    <View style={[s.card, { marginTop: 14 }]}>
      {f && (
        <>
          <View style={s.cardHead}>
            <View style={[s.botIcon, { backgroundColor: sections.markets.soft }]}><Ionicons name="flag-outline" size={19} color={sections.markets.color} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.botName}>{bear ? "Bear" : "Bull"} flag {triggered ? (bear ? "breakdown" : "breakout") : "forming"}</Text>
              <Text style={s.muted}>{bear ? `Drop −${f.pole.drop_pct}%` : `Pole +${f.pole.gain_pct}%`} · {f.flag.bars}-day flag · gave back {f.flag.retrace_pct}% · {f.quality} quality</Text>
            </View>
            <Pill text={triggered ? (bear ? "Breaking down" : "Breaking out") : `${bear ? f.distance_to_breakdown_pct : f.distance_to_breakout_pct}% to trigger`} color={triggered ? (bear ? c.loss : c.gain) : c.primary} />
          </View>
          <FlagDiagram height={80} bear={!!bear} />
          <View style={s.btStats}>
            <Stat label={bear ? "Breakdown below" : "Breakout above"} value={`$${level}`} />
            <Stat label={bear ? "Stop above" : "Stop under"} value={`$${f.stop_level}`} color={bear ? c.gain : c.loss} />
            <Stat label="Measured move" value={`$${f.target_measured_move}`} color={bear ? c.loss : c.gain} />
          </View>
          {f.status === "forming" && <Button title={`Alert me ${bear ? "below" : "above"} $${level}`} icon="notifications-outline" size="sm" variant="secondary" onPress={alertMe} style={{ marginTop: 12, alignSelf: "flex-start" }} />}
          {note && <Text style={[s.muted, { marginTop: 8 }]}>{note}</Text>}
        </>
      )}
      {others.length > 0 && (
        <View style={f ? s.signals : null}>
          <Text style={s.subhead}>Bot strategy setups</Text>
          {others.map((x) => (
            <View key={x.strategy} style={s.sigRow}>
              <Ionicons name={x.status === "triggered" ? "flash" : "eye-outline"} size={15} color={x.status === "triggered" ? c.gain : c.textSecondary} />
              <Text style={[s.botName, { fontSize: 13 }]}>{x.name}</Text>
              <Text style={[s.muted, { flex: 1, marginTop: 0 }]} numberOfLines={2}>
                {x.summary} · {x.status === "triggered" ? "signal on the last close" : `triggers above $${x.level}`}
              </Text>
            </View>
          ))}
        </View>
      )}
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
  paramRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  stratCard: { flexGrow: 1, flexBasis: 240, padding: 12, borderRadius: 16, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  stratName: { color: c.text, fontSize: 14.5, fontWeight: "700" },
  stratText: { color: c.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
}));
