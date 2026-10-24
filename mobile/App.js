import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "./src/lib/supabase";
import { colors } from "./src/theme";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import BriefingScreen from "./src/screens/BriefingScreen";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [openBriefingId, setOpenBriefingId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  let screen;
  if (session === undefined) {
    screen = (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (!session) {
    screen = <LoginScreen />;
  } else if (openBriefingId) {
    screen = <BriefingScreen id={openBriefingId} onBack={() => setOpenBriefingId(null)} />;
  } else {
    screen = <HomeScreen email={session.user.email} onOpen={setOpenBriefingId} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        {screen}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
