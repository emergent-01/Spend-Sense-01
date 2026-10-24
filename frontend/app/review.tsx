import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import dayjs from "dayjs";
import { api, type Tx } from "@/src/api";
import { Btn, Card, Chip, Empty, ErrorState, Loading, Page, ScreenHeader, SectionTitle, T, TxRow, inputStyle } from "@/src/components/ui";
import { DEBIT_CATEGORIES, INCOME_CATEGORIES } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Unparsed = { id: string; ts: string; body: string; sender?: string; reason?: string };

export default function Review() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const q = useQuery({ queryKey: ["review"], queryFn: () => api<{ unparsed: Unparsed[]; uncategorized: Tx[]; count: number }>("/review") });
  const d = q.data;
  return (
    <View style={styles.root}>
      <ScreenHeader title="Needs review" onBack={() => router.back()} topInset={insets.top} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !d ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : d.count === 0 ? (
        <Empty testID="review-empty" icon="checkmark-done-outline" title="All caught up" body="Every transaction SMS has been read and categorised." />
      ) : (
        <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <Page style={{ padding: 16, gap: 16 }}>
            {d.uncategorized.length > 0 && (
              <Card style={{ paddingHorizontal: 0 }} testID="review-uncategorized">
                <View style={{ paddingHorizontal: 16 }}>
                  <SectionTitle title={`Uncategorised (${d.uncategorized.length})`} />
                  <T v="caption" style={{ marginTop: -8, marginBottom: 8 }}>
                    Pick a category once and SpendSense remembers it for that merchant.
                  </T>
                </View>
                {d.uncategorized.map((t) => (
                  <QuickCategorize key={t.id} tx={t} />
                ))}
              </Card>
            )}
            {d.unparsed.length > 0 && (
              <View style={{ gap: 12 }}>
                <SectionTitle title={`Couldn't read (${d.unparsed.length})`} />
                {d.unparsed.map((u) => (
                  <UnparsedCard key={u.id} item={u} />
                ))}
              </View>
            )}
          </Page>
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function QuickCategorize({ tx }: { tx: Tx }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (category: string) => api<{ updated_others: number }>(`/transactions/${tx.id}`, { method: "PATCH", body: { category, apply_to_merchant: true } }),
    onSuccess: (r, c) => {
      qc.invalidateQueries();
      toast(`${tx.merchant} → ${c}${r.updated_others ? ` (+${r.updated_others} more)` : ""}`, "success");
    },
  });
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: "transparent" }}>
      <TxRow tx={tx} onPress={() => router.push(`/transaction/${tx.id}`)} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 48, flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: "center" }}>
        {(tx.direction === "credit" ? INCOME_CATEGORIES : DEBIT_CATEGORIES).map((c) => (
          <Chip key={c} testID={`review-quick-${tx.id}-${c}`} label={c} onPress={() => m.mutate(c)} />
        ))}
      </ScrollView>
    </View>
  );
}

function UnparsedCard({ item }: { item: Unparsed }) {
  const inp = inputStyle();
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const guess = item.body.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1]?.replace(/,/g, "") ?? "";
  const [amount, setAmount] = useState(guess);
  const [merchant, setMerchant] = useState("");
  const [direction, setDirection] = useState<"debit" | "credit">(/credited|received/i.test(item.body) ? "credit" : "debit");
  const [category, setCategory] = useState(direction === "credit" ? "Income" : "Other");
  const resolve = useMutation({
    mutationFn: () => api(`/review/${item.id}/resolve`, { method: "POST", body: { amount: Number(amount), merchant, direction, category } }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast("Saved as transaction", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const dismiss = useMutation({
    mutationFn: () => api(`/review/${item.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast("Dismissed");
    },
  });
  return (
    <Card testID={`unparsed-${item.id}`} style={{ gap: 12, borderColor: colors.warning }}>
      <T v="caption">
        {item.sender || "Unknown sender"} · {dayjs(item.ts).format("D MMM, h:mm A")}
      </T>
      <T style={styles.raw}>{item.body}</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["debit", "credit"] as const).map((k) => (
          <Chip
            key={k}
            testID={`unparsed-dir-${item.id}-${k}`}
            label={k === "debit" ? "Expense" : "Income"}
            selected={direction === k}
            onPress={() => {
              setDirection(k);
              setCategory(k === "credit" ? "Income" : "Other");
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          testID={`unparsed-amount-${item.id}`}
          style={[inp.input, { flex: 1, minWidth: 0 }]}
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
          keyboardType="decimal-pad"
          placeholder="Amount"
          placeholderTextColor={colors.muted}
        />
        <TextInput
          testID={`unparsed-merchant-${item.id}`}
          style={[inp.input, { flex: 1.4, minWidth: 0 }]}
          value={merchant}
          onChangeText={setMerchant}
          placeholder="Merchant"
          placeholderTextColor={colors.muted}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
        {(direction === "credit" ? INCOME_CATEGORIES : DEBIT_CATEGORIES).map((c) => (
          <Chip key={c} testID={`unparsed-cat-${item.id}-${c}`} label={c} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={{ display: "none" }} />
        <Btn testID={`unparsed-dismiss-${item.id}`} title="Not a transaction" kind="ghost" style={{ flex: 1 }} loading={dismiss.isPending} onPress={() => dismiss.mutate()} />
        <Btn
          testID={`unparsed-save-${item.id}`}
          title="Save"
          style={{ flex: 1 }}
          disabled={!(Number(amount) > 0) || !merchant.trim()}
          loading={resolve.isPending}
          onPress={() => resolve.mutate()}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  raw: { backgroundColor: c.surfaceTertiary, padding: 12, borderRadius: 12, fontSize: 13 },
}));
