import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Tx } from "@/src/api";
import { Chip, ChipRow, Empty, ErrorState, Icon, IconBtn, Loading, Page, T, TxRow } from "@/src/components/ui";
import { currentMonth, dayLabel, inr, monthLabel, P2P, shiftMonth } from "@/src/format";
import { useCategories } from "@/src/use-categories";
import { useToast } from "@/src/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";

const FILTERS = [
  ["all", "All"],
  ["review", "Needs review"],
  ["reimbursable", "Reimbursable"],
  ["personal", "Personal"],
  ["business", "Business"],
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
  const key = ["transactions", month, filter, category, q];
  const qc = useQueryClient();
  const toast = useToast();
  const catList = useCategories();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = (query.data ?? []).filter((t) => t.direction === "debit");
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };
  const toggleSelect = (t: Tx) => {
    if (t.direction !== "debit") return toast("Only expenses can be tagged Personal or Business");
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t.id)) n.delete(t.id);
      else n.add(t.id);
      return n;
    });
  };
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.id)));

  // One-tap flip: optimistic, and remembered for this merchant's future transactions.
  const flip = useMutation({
    mutationFn: (t: Tx) =>
      api(`/transactions/${t.id}`, { method: "PATCH", body: { business: !t.business, learn_business: true } }),
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Tx[]>(key);
      qc.setQueryData<Tx[]>(key, (d) => d?.map((x) => (x.id === t.id ? { ...x, business: !t.business } : x)));
      return { prev };
    },
    onError: (e: Error, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast(e.message, "error");
    },
    onSuccess: (_r, t) => toast(`${t.merchant} → ${t.business ? "Personal" : "Business"} · future ones too`, "success"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
  const batch = useMutation({
    mutationFn: (business: boolean) =>
      api<{ updated: number; merchants_learned: number }>("/transactions/batch-tag", {
        method: "POST",
        body: { ids: [...selected], business, learn: true },
      }),
    onSuccess: (r, business) => {
      toast(`${selected.size} tagged ${business ? "Business" : "Personal"} · ${r.merchants_learned} merchant${r.merchants_learned === 1 ? "" : "s"} remembered`, "success");
      exitSelect();
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, "error"),
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
      total: data.filter((t) => t.direction === "debit" && t.category !== P2P).reduce((s, t) => s + t.amount, 0),
      data,
    }));
  }, [query.data]);

  const totals = useMemo(() => {
    const d = query.data ?? [];
    const spend = d.filter((t) => t.direction === "debit" && t.category !== P2P);
    return {
      out: spend.reduce((s, t) => s + t.amount, 0),
      business: spend.filter((t) => t.business).reduce((s, t) => s + t.amount, 0),
      inn: d.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0),
    };
  }, [query.data]);

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Page>
          {selectMode ? (
            <View style={styles.titleRow}>
              <T v="title" style={{ flex: 1 }}>Select</T>
              <Pressable testID="activity-select-all" onPress={selectAll} hitSlop={6} style={styles.textBtn}>
                <T v="label" style={{ color: colors.brandPrimary }}>{allSelected ? "Clear" : "Select all"}</T>
              </Pressable>
              <Pressable testID="activity-select-cancel" onPress={exitSelect} hitSlop={6} style={styles.textBtn}>
                <T v="label">Done</T>
              </Pressable>
            </View>
          ) : (
          <View style={styles.titleRow}>
            <T v="title" style={{ flex: 1 }}>Activity</T>
            <IconBtn testID="activity-select-mode" icon="checkmark-circle-outline" onPress={() => setSelectMode(true)} />
            <IconBtn testID="activity-prev-month" icon="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} />
            <T testID="activity-month-label" v="label" style={{ minWidth: 110, textAlign: "center" }}>{monthLabel(month)}</T>
            <IconBtn
              testID="activity-next-month"
              icon="chevron-forward"
              onPress={() => month < currentMonth() && setMonth(shiftMonth(month, 1))}
            />
          </View>
          )}
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
            {[...catList.spend, P2P].map((c) => (
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
            <T v="caption" testID="activity-total-out">Spent {inr(totals.out)}</T>
            {filter !== "business" && <T v="caption" testID="activity-total-personal">Personal {inr(totals.out - totals.business)}</T>}
            {filter !== "personal" && (
              <T v="caption" testID="activity-total-business" style={{ color: colors.warning }}>Business {inr(totals.business)}</T>
            )}
            {filter !== "personal" && filter !== "business" && (
              <T v="caption" testID="activity-total-in" style={{ color: colors.success }}>In {inr(totals.inn)}</T>
            )}
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
          contentContainerStyle={{ paddingBottom: bottomChrome + (selectMode ? 96 : 24) }}
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
              <TxRow
                tx={item}
                selectMode={selectMode}
                selected={selected.has(item.id)}
                onPress={() => (selectMode ? toggleSelect(item) : router.push(`/transaction/${item.id}`))}
                onLongPress={() => {
                  if (item.direction !== "debit") return;
                  setSelectMode(true);
                  setSelected(new Set([item.id]));
                }}
                onToggleBusiness={() => flip.mutate(item)}
              />
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
      {selectMode && (
        <View style={[styles.batchBar, { bottom: bottomChrome + 16 }]} testID="batch-bar">
          <T v="label" style={{ color: colors.onSurfaceInverse }} testID="batch-count">
            {selected.size} selected
          </T>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              testID="batch-tag-personal"
              disabled={!selected.size || batch.isPending}
              onPress={() => batch.mutate(false)}
              style={[styles.batchBtn, !selected.size && { opacity: 0.5 }]}
            >
              <Icon name="person-outline" size={16} color={colors.onBrandTertiary} />
              <T v="label" style={{ color: colors.onBrandTertiary }}>Personal</T>
            </Pressable>
            <Pressable
              testID="batch-tag-business"
              disabled={!selected.size || batch.isPending}
              onPress={() => batch.mutate(true)}
              style={[styles.batchBtn, styles.batchBiz, !selected.size && { opacity: 0.5 }]}
            >
              <Icon name="briefcase-outline" size={16} color={colors.onWarning} />
              <T v="label" style={{ color: colors.onWarning }}>Business</T>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  titleRow: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 4, minHeight: 48 },
  textBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  batchBar: {
    position: "absolute",
    left: 16,
    right: 16,
    maxWidth: 560,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: c.surfaceInverse,
    borderRadius: 20,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
    shadowColor: c.surfaceInverse,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  batchBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.brandTertiary },
  batchBiz: { backgroundColor: c.warning },
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
  totals: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 2, paddingHorizontal: 16, paddingBottom: 8 },
  sectionHeader: { backgroundColor: c.surfaceTertiary, paddingVertical: 6 },
}));
