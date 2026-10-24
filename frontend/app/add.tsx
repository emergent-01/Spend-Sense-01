import { useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import dayjs from "dayjs";
import { api } from "@/src/api";
import { Btn, Card, Chip, Page, ScreenHeader, T, inputStyle } from "@/src/components/ui";
import { useCategories } from "@/src/use-categories";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { PastePreviewCard, type Preview } from "@/src/components/PastePreview";
import { useLoadSample } from "@/src/use-sample";

export default function Add() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const inp = inputStyle();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const sample = useLoadSample();
  const [tab, setTab] = useState<"paste" | "manual">("paste");
  const catList = useCategories();
  const [sms, setSms] = useState("");
  const [sender, setSender] = useState("");
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [batch, setBatch] = useState(0);

  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("Food");
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [reimb, setReimb] = useState(false);
  const [business, setBusiness] = useState(false);
  const [note, setNote] = useState("");

  const paste = useMutation({
    mutationFn: () => {
      // allow several SMS separated by blank lines
      const parts = sms.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
      return api<{ items: Preview[] }>("/sms/preview", { method: "POST", body: { messages: parts.map((body) => ({ body, sender: sender.trim() })) } });
    },
    onSuccess: (r) => {
      setPreviews(r.items);
      setBatch((b) => b + 1);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const manual = useMutation({
    mutationFn: () =>
      api("/transactions", {
        method: "POST",
        body: {
          amount: Number(amount),
          direction,
          merchant: merchant.trim(),
          category,
          date: dayjs(date).isValid() ? dayjs(date).hour(12).toISOString() : undefined,
          note,
          reimbursable: reimb,
          business: direction === "debit" && business,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast(direction === "credit" ? "Income added" : "Expense added", "success");
      router.back();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const cats = direction === "credit" ? catList.income : catList.debit;
  const canManual = Number(amount) > 0 && merchant.trim().length > 0;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Add transaction" onBack={() => router.back()} topInset={insets.top} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Page style={{ padding: 16, gap: 16, maxWidth: 640 }}>
          <View style={styles.seg}>
            {(["paste", "manual"] as const).map((k) => (
              <Pressable key={k} testID={`add-tab-${k}`} onPress={() => setTab(k)} style={[styles.segItem, tab === k && styles.segOn]}>
                <T v="label" style={{ color: tab === k ? colors.onSurface : colors.muted }}>{k === "paste" ? "Paste SMS" : "Enter manually"}</T>
              </Pressable>
            ))}
          </View>

          {tab === "paste" ? (
            <>
              <Card style={{ gap: 12 }}>
                <T v="caption">
                  Paste one or more bank / card / UPI SMS (separate with a blank line). We detect amount, merchant, card, UPI ID and category.
                </T>
                <TextInput
                  testID="paste-sms-input"
                  style={[inp.input, { minHeight: 140, paddingTop: 12, textAlignVertical: "top" }]}
                  multiline
                  value={sms}
                  onChangeText={setSms}
                  placeholder="Rs.450.00 spent on HDFC Bank Card x1234 at SWIGGY on 12-06-26…"
                  placeholderTextColor={colors.muted}
                />
                <View>
                  <T style={inp.label}>Sender ID (optional)</T>
                  <TextInput
                    testID="paste-sender-input"
                    style={inp.input}
                    value={sender}
                    onChangeText={setSender}
                    autoCapitalize="characters"
                    placeholder="e.g. AD-HDFCBK"
                    placeholderTextColor={colors.muted}
                  />
                </View>
                <Btn testID="paste-submit-button" title="Read SMS" icon="scan-outline" disabled={!sms.trim()} loading={paste.isPending} onPress={() => paste.mutate()} />
              </Card>
              {previews && previews.length === 0 && <T v="caption">Nothing to read — paste an SMS first.</T>}
              {previews?.map((p, i) => (
                <PastePreviewCard key={`${batch}-${i}`} item={p} index={i} />
              ))}
              <Btn testID="add-load-sample-button" title="Load sample bank messages" kind="ghost" loading={sample.isPending} onPress={() => sample.mutate()} />
            </>
          ) : (
            <Card style={{ gap: 12 }}>
              <View style={styles.seg}>
                {(["debit", "credit"] as const).map((k) => (
                  <Pressable
                    key={k}
                    testID={`manual-direction-${k}`}
                    onPress={() => {
                      setDirection(k);
                      setCategory(k === "credit" ? "Income" : "Food");
                    }}
                    style={[styles.segItem, direction === k && styles.segOn]}
                  >
                    <T v="label" style={{ color: direction === k ? colors.onSurface : colors.muted }}>{k === "debit" ? "Expense" : "Income"}</T>
                  </Pressable>
                ))}
              </View>
              <View>
                <T style={inp.label}>Amount (₹)</T>
                <TextInput
                  testID="manual-amount-input"
                  style={inp.input}
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                />
              </View>
              <View>
                <T style={inp.label}>{direction === "credit" ? "From" : "Merchant / payee"}</T>
                <TextInput
                  testID="manual-merchant-input"
                  style={inp.input}
                  value={merchant}
                  onChangeText={setMerchant}
                  placeholder={direction === "credit" ? "e.g. Freelance project" : "e.g. Swiggy"}
                  placeholderTextColor={colors.muted}
                />
              </View>
              <View>
                <T style={inp.label}>Date (YYYY-MM-DD)</T>
                <TextInput testID="manual-date-input" style={inp.input} value={date} onChangeText={setDate} placeholderTextColor={colors.muted} />
              </View>
              <T style={inp.label}>Category</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {cats.map((c) => (
                  <Chip key={c} testID={`manual-category-${c}`} label={c} selected={category === c} onPress={() => setCategory(c)} />
                ))}
              </View>
              {direction === "debit" && (
                <View style={styles.seg}>
                  {([false, true] as const).map((b) => (
                    <Pressable key={String(b)} testID={`manual-tag-${b ? "business" : "personal"}`} onPress={() => setBusiness(b)} style={[styles.segItem, business === b && styles.segOn]}>
                      <T v="label" style={{ color: business === b ? colors.onSurface : colors.muted }}>{b ? "Business" : "Personal"}</T>
                    </Pressable>
                  ))}
                </View>
              )}
              {direction === "debit" && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <T v="label" style={{ flex: 1 }}>Reimbursable</T>
                  <Switch testID="manual-reimbursable-switch" value={reimb} onValueChange={setReimb} trackColor={{ true: colors.brandPrimary, false: colors.border }} />
                </View>
              )}
              <View>
                <T style={inp.label}>Note (optional)</T>
                <TextInput testID="manual-note-input" style={inp.input} value={note} onChangeText={setNote} placeholderTextColor={colors.muted} />
              </View>
              <Btn testID="manual-save-button" title="Save" disabled={!canManual} loading={manual.isPending} onPress={() => manual.mutate()} />
            </Card>
          )}
        </Page>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  seg: { flexDirection: "row", backgroundColor: c.surfaceTertiary, borderRadius: 999, padding: 4 },
  segItem: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  segOn: { backgroundColor: c.surfaceSecondary },
}));
