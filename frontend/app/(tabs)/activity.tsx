import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Tx } from "@/src/api";
import { Chip, ChipRow, Empty, ErrorState, Icon, IconBtn, Loading, Page, T, TxRow } from "@/src/components/ui";
import { currentMonth, dayLabel, inr, monthLabel, shiftMonth, SPEND_CATEGORIES } from "@/src/format";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";

const FILTERS = [
  ["all", "All"],
  ["review", "Needs review"],
  ["reimbursable", "Reimbursable"],
  ["income", "Income"],
] as const;

export default function Activity() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ category?: string; filter?: string }>();
  const [month, setMonth] = useState(currentMonth());
  const [filter, setFilter] = useState<string>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (params.category) {
      setCategory(params.category);
      setFilter("all");
    }
    if (params.filter) setFilter(params.filter);
  }, [params.category, params.filter]);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ["transactions", month, filter, category, q],
    queryFn: () => {
      const p = new URLSearchParams({ month, filter });
      if (category) p.set("category", category);
      if (q) p.set("q", q);
      return api<Tx[]>(`/transactions?${p.toString()}`);
    },
  });

  const sections = useMemo(() => {
    const map = new Map<string, Tx[]>();
    (query.data ?? []).forEach((t) => {
      const k = t.ts.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    });
    return [...map.entries()].map(([k, data]) => ({
      title: dayLabel(data[0].ts),
      key: k,
      total: data.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amount, 0),
      data,
    }));
  }, [query.data]);

  const totals = useMemo(() => {
    const d = query.data ?? [];
    return {
      out: d.filter((t) => t.direction === "debit" && t.category !== "Transfer").reduce((s, t) => s + t.amount, 0),
      inn: d.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0),
    };
  }, [query.data]);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Page>
          <View style={styles.titleRow}>
            <T v="title" style={{ flex: 1 }}>Activity</T>
            <IconBtn testID="activity-prev-month" icon="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} />
            <T testID="activity-month-label" v="label" style={{ minWidth: 110, textAlign: "center" }}>{monthLabel(month)}</T>
            <IconBtn
              testID="activity-next-month"
              icon="chevron-forward"
              onPress={() => month < currentMonth() && setMonth(shiftMonth(month, 1))}
            />
          </View>
          <View style={styles.search}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              testID="activity-search-input"
              value={search}
              onChangeText={setSearch}
              placeholder="Search merchant, UPI ID, amount"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {!!search && (
              <Pressable testID="activity-search-clear" onPress={() => setSearch("")} hitSlop={10}>
                <Icon name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>
          <ChipRow>
            {FILTERS.map(([k, label]) => (
              <Chip
                key={k}
                testID={`activity-filter-${k}`}
                label={label}
                selected={filter === k && !category}
                onPress={() => {
                  setFilter(k);
                  setCategory(null);
                }}
              />
            ))}
            {SPEND_CATEGORIES.map((c) => (
              <Chip
                key={c}
                testID={`activity-cat-${c}`}
                label={c}
                selected={category === c}
                onPress={() => {
                  setCategory(category === c ? null : c);
                  setFilter("all");
                }}
              />
            ))}
          </ChipRow>
          <View style={styles.totals}>
            <T v="caption" testID="activity-total-out">Out {inr(totals.out)}</T>
            <T v="caption" testID="activity-total-in" style={{ color: colors.success }}>In {inr(totals.inn)}</T>
            <T v="caption">{query.data?.length ?? 0} transactions</T>
          </View>
        </Page>
      </View>
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : (
        <SectionList
          testID="activity-list"
          sections={sections}
          keyExtractor={(t) => t.id}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: bottomChrome + 24 }}
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.brandPrimary} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Page style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16 }}>
                <T v="caption" style={{ fontWeight: "500" }}>{section.title}</T>
                {section.total > 0 && <T v="caption">−{inr(section.total)}</T>}
              </Page>
            </View>
          )}
          renderItem={({ item }) => (
            <Page>
              <TxRow tx={item} onPress={() => router.push(`/transaction/${item.id}`)} />
            </Page>
          )}
          ListEmptyComponent={
            <Empty
              testID="activity-empty"
              icon="receipt-outline"
              title="No transactions here"
              body={q || category || filter !== "all" ? "Try another filter or month." : "New transaction SMS will appear here automatically."}
            />
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  titleRow: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 4 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.surfaceTertiary,
  },
  searchInput: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, height: 44, outlineStyle: "none" } as any,
  totals: { flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingBottom: 8 },
  sectionHeader: { backgroundColor: c.surfaceTertiary, paddingVertical: 6 },
}));
