import { createElement, useMemo, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { makeStyles, useTheme } from "../theme";
import { Chip, SectionCard } from "./ui";

// Live interactive chart from TradingView's free Advanced Chart widget: intraday to weekly candles that
// update in real time, with drawing tools and indicators. We load TradingView's hosted widget page (the
// same URL their embed script creates), so their code runs on their own domain, isolated from this app
// and its session. Their terms require the attribution link shown under the chart.

const INTERVALS = [["1", "1m"], ["5", "5m"], ["15", "15m"], ["60", "1H"], ["D", "1D"], ["W", "1W"]];
const WIDGET = "https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#";

function widgetUrl({ symbol, interval, dark }) {
  const config = {
    autosize: true,
    width: "100%",
    height: "100%",
    symbol,
    interval,
    timezone: "America/New_York",
    theme: dark ? "dark" : "light",
    style: "1",
    allow_symbol_change: false,
    hide_side_toolbar: false,
    withdateranges: true,
    backgroundColor: dark ? "#0D111C" : "#FFFFFF",
    gridColor: dark ? "rgba(255,255,255,0.06)" : "rgba(10,15,30,0.06)",
    support_host: "https://www.tradingview.com",
    utm_source: Platform.OS === "web" && typeof window !== "undefined" ? window.location.host : "finsight.app",
    utm_medium: "widget_new",
    utm_campaign: "advanced-chart",
  };
  return WIDGET + encodeURIComponent(JSON.stringify(config));
}

export default function LiveChart({ ticker, height = 460 }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [interval, setInterval_] = useState("5");
  const url = useMemo(() => widgetUrl({ symbol: ticker, interval, dark: c.dark }), [ticker, interval, c.dark]);

  let frame;
  if (Platform.OS === "web") {
    frame = createElement("iframe", { key: url, src: url, title: `${ticker} live chart`, allow: "fullscreen", referrerPolicy: "origin", style: { border: 0, width: "100%", height: "100%" } });
  } else {
    const { WebView } = require("react-native-webview");
    frame = <WebView key={url} source={{ uri: url }} style={{ backgroundColor: "transparent" }} javaScriptEnabled setSupportMultipleWindows={false} />;
  }

  return (
    <SectionCard title="Live chart" subtitle="Real-time candles, drawing tools and indicators" section={sections.technicals}>
      <View style={s.chips}>
        {INTERVALS.map(([k, label]) => <Chip key={k} label={label} active={interval === k} onPress={() => setInterval_(k)} />)}
      </View>
      <View style={[s.frame, { height }]}>{frame}</View>
      <Text style={s.note}>
        <Text style={s.link} onPress={() => Linking.openURL(`https://www.tradingview.com/symbols/${encodeURIComponent(ticker)}/`)}>{ticker} chart by TradingView</Text>
        {" · Exchange data may be delayed for some markets."}
      </Text>
    </SectionCard>
  );
}

const useStyles = makeStyles((c) => ({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  frame: { borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  note: { color: c.muted, fontSize: 11, marginTop: 8 },
  link: { color: c.textSecondary, fontWeight: "600", textDecorationLine: "underline" },
}));
