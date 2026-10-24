import { useState } from "react";
import { Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "@/src/api";
import { Badge, Btn, Card, Chip, T, inputStyle } from "@/src/components/ui";
import { inr } from "@/src/format";
import { useCategories } from "@/src/use-categories";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export type Preview = {
  body: string;
  sender: string;
  received_at: number | null;
  status: "parsed" | "unparsed" | "ignored";
  duplicate: boolean;
  amount: number | null;
  direction: "debit" | "credit";
  merchant: string | null;
  category: string;
  business: boolean;
  learned?: boolean;
  bank?: string | null;
  card_last4?: string | null;
  vpa?: string | null;
  ts: string;
};

// Parse-confirmation step: shows what we read from the SMS, every field correctable in one tap, then saves.
export function PastePreviewCard({ item, index }: { item: Preview; index: number }) {
  const styles = useStyles();
  const inp = inputStyle();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const catList = useCategories();
  const [forceAdd, setForceAdd] = useState(false);
  const [amount, setAmount] = useState(item.amount ? String(item.amount) : "");
  const [merchant, setMerchant] = useState(item.merchant ?? "");
  const [direction, setDirection] = useState(item.direction);
  const [category, setCategory] = useState(item.category);
  const [business, setBusiness] = useState(item.business);
  const [learn, setLearn] = useState(true);
  const [editing, setEditing] = useState<"amount" | "merchant" | null>(item.status === "parsed" ? null : "amount");
  const [saved, setSaved] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api<{ status: string; learned_others: number; alerts: { title: string }[] }>("/sms/confirm", {
        method: "POST",
        body: {
          body: item.body,
          sender: item.sender,
          received_at: item.received_at,
          amount: Number(amount),
          direction,
          merchant: merchant.trim(),
          category,
          business: direction === "debit" && business,
          learn,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      const msg = `${r.status === "merged" ? "Merged with matching card/UPI SMS" : "Saved"}${r.learned_others ? ` · ${r.learned_others} past ${merchant.toUpperCase()} updated` : ""}`;
      setSaved(msg);
      toast(r.alerts?.[0]?.title ?? msg, "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const tid = `preview-${index}`;
  if (item.duplicate) {
    return (
      <Card testID={`${tid}-duplicate`} style={{ gap: 6 }}>
        <Badge label="Already added" tone="muted" />
        <T v="caption" numberOfLines={3}>{item.body}</T>
      </Card>
    );
  }
  if (item.status === "ignored" && !forceAdd) {
    return (
      <Card testID={`${tid}-ignored`} style={{ gap: 8 }}>
        <T v="label">Not a transaction</T>
        <T v="caption">Looks like an OTP, promotion or reminder, so nothing will be saved.</T>
        <T v="caption" numberOfLines={3} style={styles.raw}>{item.body}</T>
        <Btn testID={`${tid}-add-anyway`} title="It is a transaction — add it" kind="ghost" onPress={() => setForceAdd(true)} />
      </Card>
    );
  }
  if (saved) {
    return (
      <Card testID={`${tid}-saved`} style={{ flexDirection: "row", gap: 8, alignItems: "center", borderColor: colors.success }}>
        <T v="label" style={{ color: colors.success, flex: 1 }}>✓ {merchant.toUpperCase()} · {inr(Number(amount), true)} · {category}</T>
        <T v="caption">{saved}</T>
      </Card>
    );
  }

  const cats = direction === "credit" ? catList.income : catList.debit;
  const valid = Number(amount) > 0 && merchant.trim().length > 0;

  return (
    <Card testID={tid} style={[{ gap: 12 }, item.status !== "parsed" && { borderColor: colors.warning }]}>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {item.status === "parsed" ? <Badge label="Read automatically" /> : <Badge label="Couldn't read — please fill in" tone="warning" />}
        {item.learned && <Badge label="Using your saved category" tone="muted" />}
        {[item.bank, item.card_last4 && `••${item.card_last4}`, item.vpa].filter(Boolean).map((x) => (
          <Badge key={x as string} label={x as string} tone="muted" />
        ))}
      </View>

      <View style={styles.seg}>
        {(["debit", "credit"] as const).map((k) => (
          <Pressable
            key={k}
            testID={`${tid}-dir-${k}`}
            onPress={() => {
              setDirection(k);
              setCategory(k === "credit" ? "Income" : "Other");
            }}
            style={[styles.segItem, direction === k && styles.segOn]}
          >
            <T v="label" style={{ color: direction === k ? colors.onSurface : colors.muted }}>{k === "debit" ? "Expense" : "Income"}</T>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="caption">Amount</T>
          {editing === "amount" ? (
            <TextInput
              testID={`${tid}-amount-input`}
              style={inp.input}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              autoFocus={item.status === "parsed"}
              onBlur={() => item.status === "parsed" && setEditing(null)}
              placeholder="0"
              placeholderTextColor={colors.muted}
            />
          ) : (
            <Pressable testID={`${tid}-amount`} onPress={() => setEditing("amount")} style={styles.field}>
              <T v="title" numberOfLines={1}>{amount ? inr(Number(amount), true) : "—"}</T>
              <T v="caption" style={{ color: colors.brandPrimary }}>Edit</T>
            </Pressable>
          )}
        </View>
        <View style={{ flex: 1.3, minWidth: 0 }}>
          <T v="caption">{direction === "credit" ? "From" : "Merchant"}</T>
          {editing === "merchant" || !item.merchant ? (
            <TextInput
              testID={`${tid}-merchant-input`}
              style={inp.input}
              value={merchant}
              onChangeText={setMerchant}
              autoCapitalize="characters"
              autoFocus={editing === "merchant"}
              onBlur={() => item.merchant && setEditing(null)}
              placeholder="e.g. SWIGGY"
              placeholderTextColor={colors.muted}
            />
          ) : (
            <Pressable testID={`${tid}-merchant`} onPress={() => setEditing("merchant")} style={styles.field}>
              <T v="h2" numberOfLines={1}>{merchant}</T>
              <T v="caption" style={{ color: colors.brandPrimary }}>Edit</T>
            </Pressable>
          )}
        </View>
      </View>

      <View>
        <T v="caption" style={{ marginBottom: 6 }}>Category</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
          {cats.map((c) => (
            <Chip key={c} testID={`${tid}-cat-${c}`} label={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
      </View>

      {direction === "debit" && (
        <View style={styles.seg}>
          {([false, true] as const).map((b) => (
            <Pressable key={String(b)} testID={`${tid}-tag-${b ? "business" : "personal"}`} onPress={() => setBusiness(b)} style={[styles.segItem, business === b && styles.segOn]}>
              <T v="label" style={{ color: business === b ? colors.onSurface : colors.muted }}>{b ? "Business" : "Personal"}</T>
            </Pressable>
          ))}
        </View>
      )}

      {direction === "debit" && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <T v="caption" style={{ flex: 1 }}>Remember this category & tag for {merchant.trim() ? merchant.toUpperCase() : "this merchant"}</T>
          <Switch testID={`${tid}-learn-switch`} value={learn} onValueChange={setLearn} trackColor={{ true: colors.brandPrimary, false: colors.border }} />
        </View>
      )}

      <T v="caption" numberOfLines={2} style={styles.raw}>{dayjs(item.ts).format("D MMM, h:mm A")} · {item.body}</T>

      <Btn testID={`${tid}-save`} title="Looks right — save" disabled={!valid} loading={save.isPending} onPress={() => save.mutate()} />
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  seg: { flexDirection: "row", backgroundColor: c.surfaceTertiary, borderRadius: 999, padding: 4 },
  segItem: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  segOn: { backgroundColor: c.surfaceSecondary },
  field: { minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: c.border },
  raw: { backgroundColor: c.surfaceTertiary, padding: 10, borderRadius: 12, color: c.muted },
}));
