import Ionicons from "@react-native-vector-icons/ionicons";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import React from "react";
import { Platform } from "react-native";

import { usesNativeTabs } from "@/src/navigation";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();

  if (usesNativeTabs) {
    return (
      <NativeTabs tintColor={colors.brandPrimary}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="house.fill" />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="pantry">
          <NativeTabs.Trigger.Icon sf="refrigerator.fill" />
          <NativeTabs.Trigger.Label>Pantry</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="plan">
          <NativeTabs.Trigger.Icon sf="calendar" />
          <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="shopping">
          <NativeTabs.Trigger.Icon sf="cart.fill" />
          <NativeTabs.Trigger.Label>Shop</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  const icon = (on: React.ComponentProps<typeof Ionicons>["name"], off: React.ComponentProps<typeof Ionicons>["name"]) => {
    const TabIcon = ({ focused, color }: { focused: boolean; color: string }) => <Ionicons name={focused ? on : off} size={24} color={color} />;
    return TabIcon;
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.text, fontWeight: "800", fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, ...(Platform.OS === "web" ? { height: 64 } : {}) },
        tabBarItemStyle: { alignSelf: "center" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarButtonTestID: "tab-home", tabBarIcon: icon("home", "home-outline") }} />
      <Tabs.Screen name="pantry" options={{ title: "Pantry", tabBarButtonTestID: "tab-pantry", tabBarIcon: icon("file-tray-stacked", "file-tray-stacked-outline") }} />
      <Tabs.Screen name="plan" options={{ title: "Plan", tabBarButtonTestID: "tab-plan", tabBarIcon: icon("calendar", "calendar-outline") }} />
      <Tabs.Screen name="shopping" options={{ title: "Shop", tabBarButtonTestID: "tab-shopping", tabBarIcon: icon("cart", "cart-outline") }} />
    </Tabs>
  );
}
