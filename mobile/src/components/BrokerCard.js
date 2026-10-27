import { useEffect, useState } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Button, Pill, SectionCard } from "./ui";
import { ErrorNotice } from "./Upgrade";

/** Connect a brokerage (read-only, via SnapTrade) and import positions + trades. Hidden when the server has no SnapTrade keys. */
export default function BrokerCard({ onSynced }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const load = () => api.broker().then(setStatus).catch(() => setStatus({ enabled: false }));
  useEffect(() => {
    load();
    // After returning from the connection portal (native), refresh the status
    const sub = AppState.addEventListener("change", (st) => st === "active" && load());
    return () => sub.remove();
  }, []);

  async function act(kind, fn) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  const connect = () => act("connect", async () => {
    const returnUrl = Platform.OS === "web" ? window.location.origin + window.location.pathname : undefined;
    const { url } = await api.brokerConnect(returnUrl);
    if (Platform.OS === "web") window.location.assign(url);
    else await Linking.openURL(url);
  });
  const sync = () => act("sync", async () => {
    const r = await api.brokerSync();
    setResult(r);
    await load();
    onSynced?.();
  });
  const disconnect = () => act("disconnect", async () => {
    await api.brokerDisconnect();
    setResult(null);
    await load();
  });

  if (!status?.enabled) return null;
  return (
    <SectionCard
      title="Broker sync"
      subtitle="Robinhood, Schwab, Fidelity, IBKR, Webull and more · read-only"
      section={{ ...sections.portfolio, icon: "link-outline" }}
      right={status.connected ? <Pill text="Connected" color={c.gain} icon="checkmark-circle" /> : null}
    >
      {!status.connected ? (
        <>
          <Text style={s.text}>Link your brokerage to import holdings and trades automatically. FinSight can only read: it can never place trades or move money.</Text>
          <Button title="Connect a broker" icon="link" onPress={connect} loading={busy === "connect"} style={{ marginTop: 12, alignSelf: "flex-start" }} />
        </>
      ) : (
        <>
          <Text style={s.text}>
            {status.last_sync_at ? `Last synced ${new Date(status.last_sync_at).toLocaleString()}.` : "Connected. Sync to import your holdings and trades."}
            {result ? ` Imported ${result.positions} positions and ${result.trades_imported} new trades from ${result.accounts} account${result.accounts === 1 ? "" : "s"}.` : ""}
          </Text>
          <View style={s.row}>
            <Button title="Sync now" icon="sync" size="sm" onPress={sync} loading={busy === "sync"} />
            <Button title="Add account" icon="add" size="sm" variant="secondary" onPress={connect} loading={busy === "connect"} />
            <Button title="Disconnect" size="sm" variant="ghost" onPress={disconnect} loading={busy === "disconnect"} />
          </View>
        </>
      )}
      <ErrorNotice error={error} />
    </SectionCard>
  );
}

const useStyles = makeStyles((c) => ({
  text: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
}));
