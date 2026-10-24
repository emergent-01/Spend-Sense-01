import { Platform } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useAuth } from "@/src/auth";
import { usesNativeTabs } from "@/src/navigation";
import { Icon } from "@/src/components/ui";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  if (!loading && !user) return <Redirect href="/login" />;

  if (usesNativeTabs) {
    return (
      <NativeTabs tintColor={colors.brandPrimary}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="house.fill" />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="activity">
          <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" />
          <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="budgets">
          <NativeTabs.Trigger.Icon sf="chart.pie.fill" />
          <NativeTabs.Trigger.Label>Budgets</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="more">
          <NativeTabs.Trigger.Icon sf="ellipsis.circle" />
          <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  const tab = (name: string, title: string, icon: string, iconOn: string) => (
    <Tabs.Screen
      name={name}
      options={{
        title,
        tabBarButtonTestID: `tab-${name}`,
        tabBarIcon: ({ focused, color }) => <Icon name={(focused ? iconOn : icon) as any} size={22} color={color} />,
      }}
    />
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.text, fontSize: 11, fontWeight: "500" },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      {tab("index", "Home", "home-outline", "home")}
      {tab("activity", "Activity", "list-outline", "list")}
      {tab("budgets", "Budgets", "pie-chart-outline", "pie-chart")}
      {tab("more", "More", "ellipsis-horizontal-circle-outline", "ellipsis-horizontal-circle")}
    </Tabs>
  );
}
