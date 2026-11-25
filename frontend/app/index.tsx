import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  if (loading) {
    return (
      <View style={[styles.c, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/auth" />;
  if (!user.profile.onboarded) return <Redirect href={{ pathname: "/profile", params: { onboarding: "1" } }} />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({ c: { flex: 1, alignItems: "center", justifyContent: "center" } });
