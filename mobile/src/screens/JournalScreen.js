import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { formatMoney, makeStyles, useTheme } from "../theme";
import { Banner, Bullets, Button, Chip, Disclaimer, EmptyState, Input, Loading, PageHeader, SectionCard, Segmented, Stat, TickerAvatar } from "../components/ui";
import LineChart from "../components/LineChart";
import { ErrorNotice } from "../components/Upgrade";
import RulesSheet from "../components/RulesSheet";
import OptionPnlSheet from "../components/OptionPnlSheet";
import { shareLink } from "../lib/share";

const CSV_EXAMPLE = "Symbol,Side,Qty,Entry Price,Exit Price,Entry Date,Exit Date,Setup\nAAPL,long,10,180,192,2026-09-02,2026-09-10,breakout";
const EMOTION_ICONS = { calm: "leaf-outline", confident: "thumbs-up-outline", fomo: "flash-outline", fearful: "alert-outline", revenge: "flame-outline", bored: "cafe-outline", greedy: "cash-outline", impulsive: "rocket-outline" };
const today = () => new Date().toISOString().slice(0, 10);
const signed = (v) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${formatMoney(Math.abs(v))}`);

/** Trade journal: log trades, see win rate / expectancy / drawdown, emotion and setup breakdowns, wash sales, and an AI coach. */
export default function JournalScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.journal;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(null); // { mode: "new" } | { mode: "close", trade }
  const [importOpen, setImportOpen] = useState(false);
  const [coach, setCoach] = useState(null);
  const [coaching, setCoaching] = useState(false);
  const [coachError, setCoachError] = useState(null);
  const [breakdown, setBreakdown] = useState("by_emotion");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [explain, setExplain] = useState(null); // option trade to explain
  const [toast, setToast] = useState(null);

  async function share() {
    try {
      const { url } = await api.shareJournal();
      const how = await shareLink({ title: "My trading stats", message: "My trading, measured by FinSight:", url });
      if (how === "copied") setToast("Link copied to the clipboard");
    } catch (e) {
      setError(e);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.journal());
      setError(null);
    } catch (e) {
      setError(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runCoach() {
    setCoaching(true);
    setCoachError(null);
    try {
      setCoach(await api.journalCoach());
    } catch (e) {
      setCoachError(e);
    }
    setCoaching(false);
  }

  async function remove(id) {
    await api.deleteTrade(id).catch((e) => setError(e));
    load();
  }

  const t = data?.stats?.totals;
  const trades = data?.trades ?? [];
  const open = trades.filter((x) => x.exit_price == null);
  const closed = trades.filter((x) => x.exit_price != null).sort((a, b) => String(b.exit_date).localeCompare(String(a.exit_date)));
  const groups = data?.stats?.[breakdown] ?? [];
  const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(g.pnl)));
  const afterLoss = data?.stats?.after_loss;

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader
        eyebrow="Trade journal"
        title={t?.closed ? signed(t.net_pnl) : "Your trading, measured"}
        subtitle={t?.closed ? `${t.closed} closed · ${t.open} open · realized ${data.stats.realized.year}: ${signed(data.stats.realized.ytd_pnl)}` : "Log trades with your setup and emotion. See what actually makes and loses you money, and get coached on it."}
        right={
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Rules" icon="list-outline" variant="ghost" size="sm" onPress={() => setRulesOpen(true)} />
            <Button title="Import" icon="cloud-upload-outline" variant="secondary" size="sm" onPress={() => setImportOpen(true)} />
            <Button title="Log trade" icon="add" size="sm" onPress={() => setSheet({ mode: "new" })} />
          </View>
        }
      />
      <ErrorNotice error={error} />
      {toast && <Banner tone="success">{toast}</Banner>}
      {loading && !data && <Loading text="Loading your journal…" />}

      {data && !trades.length && (
        <EmptyState
          icon="journal-outline"
          title="No trades yet"
          text="Log your first trade, or import a CSV from your broker. Tagging the setup and how you felt is what makes the coaching useful."
          action={<Button title="Log a trade" icon="add" onPress={() => setSheet({ mode: "new" })} />}
        />
      )}

      {t?.closed > 0 && (
        <>
          <View style={s.stats}>
            <Stat label="Win rate" value={t.win_rate != null ? `${t.win_rate}%` : "–"} icon="trophy-outline" />
            <Stat label="Profit factor" value={t.profit_factor ?? "–"} icon="scale-outline" color={t.profit_factor == null ? undefined : t.profit_factor >= 1 ? c.gain : c.loss} />
            <Stat label="Expectancy" value={signed(t.expectancy)} hint="per trade" color={t.expectancy >= 0 ? c.gain : c.loss} />
            <Stat label="Avg R" value={t.avg_r != null ? `${t.avg_r}R` : "–"} hint={t.trades_with_stop_pct != null ? `${t.trades_with_stop_pct}% had a stop` : null} />
          </View>
          <View style={[s.stats, { marginTop: 8 }]}>
            <Stat label="Avg win / loss" value={`${signed(t.avg_win)} / ${signed(t.avg_loss)}`} />
            <Stat label="Max drawdown" value={signed(t.max_drawdown)} color={c.loss} />
            <Stat label="Hold: wins vs losses" value={`${t.avg_hold_days_wins ?? "–"}d / ${t.avg_hold_days_losses ?? "–"}d`} />
          </View>

          {data.stats.equity_curve.length > 1 && (
            <SectionCard title="Equity curve" subtitle="Cumulative realized P/L" section={sec}>
              <LineChart data={data.stats.equity_curve.map((p) => ({ ...p, x: `${p.date} · ${p.ticker}` }))} series={[{ key: "equity", label: "P/L", color: sec.color, fill: true }]} format={(v) => signed(v)} zero height={180} />
            </SectionCard>
          )}

          {afterLoss?.trades > 0 && (
            <Banner tone={afterLoss.pnl < 0 ? "warn" : "info"} icon="flame-outline">
              Trades opened within 2 days of a loss: {afterLoss.trades}, win rate {afterLoss.win_rate}%, P/L {signed(afterLoss.pnl)}.{afterLoss.pnl < 0 ? " That's a revenge-trading pattern to watch." : ""}
            </Banner>
          )}

          <SectionCard
            title="AI coach"
            subtitle="Finds the patterns behind your numbers"
            section={sections.coach}
            right={<Button title={coach ? "Re-run" : "Coach me"} icon="sparkles" size="sm" onPress={runCoach} loading={coaching} disabled={t.closed < 3} />}
          >
            {t.closed < 3 && <Text style={s.muted}>Close at least 3 trades to get coaching.</Text>}
            <ErrorNotice error={coachError} />
            {!coach && !coaching && t.closed >= 3 && <Text style={s.muted}>Get a breakdown of your strengths, your most costly habits, and rules that target them.</Text>}
            {coaching && <Loading text="Reading your trades…" />}
            {coach && (
              <View>
                <Text style={s.coachHeadline}>{coach.headline}</Text>
                <Text style={s.subhead}>Strengths</Text>
                <Bullets items={coach.strengths} color={c.gain} />
                <Text style={s.subhead}>Leaks</Text>
                {coach.leaks?.map((l, i) => (
                  <View key={i} style={s.leak}>
                    <Text style={s.leakTitle}>{l.pattern}</Text>
                    <Text style={s.leakText}>{l.evidence}</Text>
                    <Text style={[s.leakText, { color: c.loss, fontWeight: "700" }]}>{l.impact}</Text>
                  </View>
                ))}
                <Text style={s.subhead}>Rules to consider</Text>
                <Bullets items={coach.rules_to_consider} color={sections.coach.color} />
                <Button title="Turn these into checklist rules" icon="list" size="sm" variant="secondary" onPress={() => setRulesOpen(true)} style={{ alignSelf: "flex-start", marginTop: 4 }} />
                <View style={s.focus}>
                  <Ionicons name="locate-outline" size={17} color={c.primary} />
                  <Text style={s.focusText}>{coach.next_focus}</Text>
                </View>
              </View>
            )}
          </SectionCard>

          <SectionCard title="Where the money comes from" section={sections.benchmark} right={<Button title="Share stats" icon="share-social-outline" size="sm" variant="ghost" onPress={share} />}>
            <Segmented
              options={[["by_emotion", "Emotion"], ["by_setup", "Setup"], ["by_ticker", "Ticker"], ["by_weekday", "Day"]]}
              value={breakdown}
              onChange={setBreakdown}
            />
            {!groups.length && <Text style={[s.muted, { marginTop: 12 }]}>Tag your trades to see this breakdown.</Text>}
            {groups.map((g) => (
              <View key={g.key} style={s.groupRow}>
                <View style={s.groupLabel}>
                  {breakdown === "by_emotion" && <Ionicons name={EMOTION_ICONS[g.key] ?? "ellipse-outline"} size={14} color={c.textSecondary} />}
                  <Text style={s.groupKey} numberOfLines={1}>{g.key}</Text>
                </View>
                <View style={s.barTrack}>
                  <View style={[s.bar, { width: `${(Math.abs(g.pnl) / maxAbs) * 100}%`, backgroundColor: g.pnl >= 0 ? c.gain : c.loss }]} />
                </View>
                <View style={{ width: 92, alignItems: "flex-end" }}>
                  <Text style={[s.groupPnl, { color: g.pnl >= 0 ? c.gain : c.loss }]}>{signed(g.pnl)}</Text>
                  <Text style={s.muted}>{g.trades} · {g.win_rate}% win</Text>
                </View>
              </View>
            ))}
          </SectionCard>
        </>
      )}

      {data?.stats?.wash_sales?.length > 0 && (
        <SectionCard title="Possible wash sales" subtitle="Loss sold, then rebought within 30 days" section={sections.redflags}>
          {data.stats.wash_sales.map((w, i) => (
            <Text key={i} style={s.washText}>
              <Text style={{ fontWeight: "800" }}>{w.ticker}</Text>: sold {w.sold} for {signed(w.loss)}, rebought {w.rebought}. The loss may be disallowed for taxes this year.
            </Text>
          ))}
          <Text style={[s.muted, { marginTop: 6 }]}>A heads-up from your journal entries, not tax advice. Your broker's 1099-B is the official record.</Text>
        </SectionCard>
      )}

      {open.length > 0 && (
        <SectionCard title="Open trades" subtitle={`${open.length} position${open.length > 1 ? "s" : ""}`} section={sections.portfolio}>
          {open.map((x) => (
            <TradeRow key={x.id} trade={x} onOpenStock={onOpenStock} onRemove={() => remove(x.id)} onExplain={setExplain} action={<Button title="Close" size="sm" variant="secondary" onPress={() => setSheet({ mode: "close", trade: x })} />} />
          ))}
        </SectionCard>
      )}

      {closed.length > 0 && (
        <SectionCard title="Closed trades" subtitle="Most recent first" section={sec}>
          {closed.slice(0, 50).map((x) => (
            <TradeRow key={x.id} trade={x} onOpenStock={onOpenStock} onRemove={() => remove(x.id)} onExplain={setExplain} />
          ))}
        </SectionCard>
      )}

      <Disclaimer>Journal statistics are based on the trades you enter. Educational, not investment or tax advice.</Disclaimer>

      <TradeSheet sheet={sheet} emotions={data?.emotions ?? Object.keys(EMOTION_ICONS)} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />
      <RulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} suggestions={coach?.rules_to_consider ?? []} onSaved={() => setToast("Rules saved. New trades are checked against them.")} />
      <OptionPnlSheet
        visible={!!explain}
        onClose={() => setExplain(null)}
        preset={explain && { ticker: explain.ticker, side: explain.side, contracts: explain.quantity, entry_date: explain.entry_date, entry_price: explain.entry_price, exit_date: explain.exit_date, exit_price: explain.exit_price }}
      />
      <ImportSheet visible={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />
    </ScrollView>
  );
}

function TradeRow({ trade: x, action, onOpenStock, onRemove, onExplain }) {
  const { c } = useTheme();
  const s = useStyles();
  const r = x.result;
  return (
    <View style={s.tradeRow}>
      <Pressable onPress={() => onOpenStock?.(x.ticker)}>
        <TickerAvatar ticker={x.ticker} size={38} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.tradeTitle} numberOfLines={1}>
          {x.ticker} <Text style={s.tradeSide}>{x.side === "short" ? "SHORT" : "LONG"}{x.instrument !== "stock" ? ` · ${x.instrument}` : ""}</Text>
        </Text>
        <Text style={s.muted} numberOfLines={1}>
          {x.quantity} @ ${x.entry_price}{x.exit_price != null ? ` → $${x.exit_price}` : ""} · {x.exit_date ?? x.entry_date}
          {x.setup ? ` · ${x.setup}` : ""}{x.emotion ? ` · ${x.emotion}` : ""}
        </Text>
      </View>
      {r ? (
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.tradePnl, { color: r.pnl >= 0 ? c.gain : c.loss }]}>{signed(r.pnl)}</Text>
          <Text style={s.muted}>{r.return_pct > 0 ? "+" : ""}{r.return_pct}%{r.r_multiple != null ? ` · ${r.r_multiple}R` : ""}</Text>
        </View>
      ) : (
        action
      )}
      {x.instrument === "option" && onExplain && (
        <Pressable onPress={() => onExplain(x)} hitSlop={8} accessibilityLabel={`Explain ${x.ticker} option P/L`}>
          <Ionicons name="help-circle-outline" size={18} color={c.primary} />
        </Pressable>
      )}
      <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Delete ${x.ticker} trade`}>
        <Ionicons name="trash-outline" size={16} color={c.muted} />
      </Pressable>
    </View>
  );
}

function TradeSheet({ sheet, emotions, onClose, onSaved }) {
  const { c } = useTheme();
  const s = useStyles();
  const closing = sheet?.mode === "close";
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [checks, setChecks] = useState(null); // pre-trade checklist result, shown before saving a rule-breaking trade
  const set = (k) => (v) => {
    setF((x) => ({ ...x, [k]: v }));
    setChecks(null);
  };

  useEffect(() => {
    setF({ side: "long", instrument: "stock", entry_date: today(), exit_date: closing ? today() : "" });
    setError(null);
    setChecks(null);
  }, [sheet, closing]);

  async function save() {
    setBusy(true);
    setError(null);
    const num = (v) => (v === "" || v == null ? undefined : Number(v));
    try {
      if (closing) {
        await api.updateTrade(sheet.trade.id, { exit_price: num(f.exit_price), exit_date: f.exit_date || today(), ...(f.emotion && { emotion: f.emotion }), ...(f.notes && { notes: f.notes }) });
      } else {
        const trade = {
          ticker: (f.ticker ?? "").trim().toUpperCase(),
          side: f.side,
          instrument: f.instrument,
          quantity: num(f.quantity),
          entry_price: num(f.entry_price),
          entry_date: f.entry_date || today(),
          exit_price: num(f.exit_price),
          exit_date: f.exit_price ? f.exit_date || today() : undefined,
          stop_price: num(f.stop_price),
          target_price: num(f.target_price),
          setup: f.setup?.trim() || undefined,
          emotion: f.emotion,
          notes: f.notes?.trim() || undefined,
        };
        // Check the user's rules first; a broken rule shows the checklist and needs a second tap
        if (!checks) {
          const pre = await api.precheck(trade).catch(() => null);
          if (pre && !pre.ok) {
            setChecks(pre);
            setBusy(false);
            return;
          }
        }
        await api.addTrade(trade);
      }
      onSaved();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <Modal supportedOrientations={["portrait", "landscape"]} visible={!!sheet} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.sheetHeader}>
            <View>
              <Text style={s.eyebrow}>{closing ? "Close trade" : "Log a trade"}</Text>
              <Text style={s.sheetTitle}>{closing ? `${sheet.trade.ticker} · ${sheet.trade.quantity} @ $${sheet.trade.entry_price}` : "New journal entry"}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8} style={s.close}>
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
            {!closing && (
              <>
                <View style={s.row2}>
                  <Field label="Ticker" style={{ flex: 1.2 }}>
                    <Input value={f.ticker} onChangeText={set("ticker")} placeholder="AAPL" autoCapitalize="characters" />
                  </Field>
                  <Field label="Side" style={{ flex: 1 }}>
                    <Segmented options={[["long", "Long"], ["short", "Short"]]} value={f.side} onChange={set("side")} />
                  </Field>
                </View>
                <View style={s.chips}>
                  {["stock", "option", "etf", "crypto", "future"].map((k) => (
                    <Chip key={k} label={k} active={f.instrument === k} onPress={() => set("instrument")(k)} />
                  ))}
                </View>
                <View style={s.row2}>
                  <Field label={f.instrument === "option" ? "Contracts" : "Quantity"} style={{ flex: 1 }}>
                    <Input value={f.quantity} onChangeText={set("quantity")} keyboardType="decimal-pad" placeholder="10" />
                  </Field>
                  <Field label="Entry price" style={{ flex: 1 }}>
                    <Input value={f.entry_price} onChangeText={set("entry_price")} keyboardType="decimal-pad" placeholder="0.00" />
                  </Field>
                  <Field label="Entry date" style={{ flex: 1.2 }}>
                    <Input value={f.entry_date} onChangeText={set("entry_date")} placeholder="YYYY-MM-DD" />
                  </Field>
                </View>
                <View style={s.row2}>
                  <Field label="Stop (for R)" style={{ flex: 1 }}>
                    <Input value={f.stop_price} onChangeText={set("stop_price")} keyboardType="decimal-pad" placeholder="optional" />
                  </Field>
                  <Field label="Target" style={{ flex: 1 }}>
                    <Input value={f.target_price} onChangeText={set("target_price")} keyboardType="decimal-pad" placeholder="optional" />
                  </Field>
                </View>
              </>
            )}
            <View style={s.row2}>
              <Field label={closing ? "Exit price" : "Exit price (if closed)"} style={{ flex: 1 }}>
                <Input value={f.exit_price} onChangeText={set("exit_price")} keyboardType="decimal-pad" placeholder={closing ? "0.00" : "leave empty if open"} />
              </Field>
              <Field label="Exit date" style={{ flex: 1 }}>
                <Input value={f.exit_date} onChangeText={set("exit_date")} placeholder="YYYY-MM-DD" />
              </Field>
            </View>
            {!closing && (
              <Field label="Setup">
                <Input value={f.setup} onChangeText={set("setup")} placeholder="breakout, pullback, earnings…" />
              </Field>
            )}
            <Text style={s.label}>How did you feel?</Text>
            <View style={s.chips}>
              {emotions.map((e) => (
                <Chip key={e} label={e} icon={EMOTION_ICONS[e]} active={f.emotion === e} onPress={() => set("emotion")(f.emotion === e ? undefined : e)} />
              ))}
            </View>
            <Field label="Notes">
              <Input value={f.notes} onChangeText={set("notes")} placeholder="Why you took it, what you'd do differently" multiline />
            </Field>
          </ScrollView>
          <ErrorNotice error={error} />
          {checks && (
            <View style={s.checklist}>
              <Text style={s.checkTitle}>This trade breaks {checks.failed} of your rule{checks.failed > 1 ? "s" : ""}</Text>
              {checks.checks.map((ck) => (
                <View key={ck.rule} style={s.checkRow}>
                  <Ionicons name={ck.passed ? "checkmark-circle" : "close-circle"} size={16} color={ck.passed ? c.gain : c.loss} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.checkLabel}>{ck.label}</Text>
                    <Text style={s.muted}>{ck.message}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
          <Button title={closing ? "Close trade" : checks ? "Log it anyway" : "Save trade"} icon={checks ? "warning" : "checkmark"} variant={checks ? "danger" : "primary"} onPress={save} loading={busy} size="lg" style={{ marginTop: 14 }} />
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children, style }) {
  const s = useStyles();
  return (
    <View style={[{ marginTop: 12 }, style]}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

function ImportSheet({ visible, onClose, onDone }) {
  const { c } = useTheme();
  const s = useStyles();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.importTrades(csv);
      setCsv("");
      onDone();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <Modal supportedOrientations={["portrait", "landscape"]} visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.sheetHeader}>
            <View>
              <Text style={s.eyebrow}>Import trades</Text>
              <Text style={s.sheetTitle}>Paste a CSV</Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8} style={s.close}>
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </Pressable>
          </View>
          <Text style={s.muted}>Columns are matched by name: symbol, side, quantity, entry/exit price and date, setup, emotion, notes. Example:</Text>
          <Text style={s.code}>{CSV_EXAMPLE}</Text>
          <TextInput value={csv} onChangeText={setCsv} multiline placeholder="Paste CSV here" placeholderTextColor={c.muted} style={s.textarea} />
          <ErrorNotice error={error} />
          <Button title="Import" icon="cloud-upload" onPress={run} loading={busy} disabled={!csv.trim()} size="lg" style={{ marginTop: 14 }} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  stats: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
  coachHeadline: { color: c.text, fontSize: 16, fontWeight: "700", lineHeight: 23 },
  subhead: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  leak: { backgroundColor: c.lossSoft, borderRadius: 12, padding: 12, marginBottom: 8 },
  leakTitle: { color: c.text, fontWeight: "800", fontSize: 14 },
  leakText: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
  focus: { flexDirection: "row", gap: 10, backgroundColor: c.primarySoft, borderRadius: 12, padding: 12, marginTop: 12, alignItems: "flex-start" },
  focusText: { flex: 1, color: c.text, fontWeight: "700", fontSize: 14, lineHeight: 20 },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  groupLabel: { width: 96, flexDirection: "row", alignItems: "center", gap: 6 },
  groupKey: { color: c.text, fontWeight: "600", fontSize: 13, textTransform: "capitalize", flexShrink: 1 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  bar: { height: 10, borderRadius: 5 },
  groupPnl: { fontWeight: "800", fontSize: 14, fontVariant: ["tabular-nums"] },
  washText: { color: c.text, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  tradeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  tradeTitle: { color: c.text, fontWeight: "800", fontSize: 15 },
  tradeSide: { color: c.muted, fontWeight: "700", fontSize: 11 },
  tradePnl: { fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] },
  wrap: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay },
  sheet: { width: "100%", maxWidth: 600, backgroundColor: c.elevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 30, borderWidth: 1, borderColor: c.border },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 },
  eyebrow: { color: c.primary, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: c.text, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  row2: { flexDirection: "row", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  label: { fontWeight: "700", color: c.text, marginBottom: 6, fontSize: 13, marginTop: 4 },
  code: { fontFamily: "monospace", fontSize: 11, color: c.textSecondary, backgroundColor: c.surfaceAlt, padding: 10, borderRadius: 10, marginTop: 8 },
  checklist: { backgroundColor: c.warnSoft, borderRadius: 14, padding: 12, marginTop: 12, gap: 8 },
  checkTitle: { color: c.text, fontWeight: "800", fontSize: 14 },
  checkRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  checkLabel: { color: c.text, fontWeight: "600", fontSize: 13 },
  textarea: { minHeight: 140, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, marginTop: 12, color: c.text, backgroundColor: c.surfaceAlt, fontFamily: "monospace", fontSize: 12, textAlignVertical: "top", outlineStyle: "none" },
}));
