import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "@/src/api";
import { Btn, Card, CatIcon, Chip, Empty, Icon, Page, ScreenHeader, T, inputStyle } from "@/src/components/ui";
import { AddCategoryChip } from "@/src/components/AddCategory";
import { useCategories } from "@/src/use-categories";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const cats = useCategories();
  return (
    <View style={styles.root}>
      <ScreenHeader title="Categories" onBack={() => router.back()} topInset={insets.top} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Page style={{ padding: 16, gap: 16, maxWidth: 640 }}>
          <Card style={{ gap: 12 }} testID="custom-categories-card">
            <T v="h2">Your categories</T>
            <T v="caption">Custom categories show up everywhere you pick a category and on the Budgets tab.</T>
            {cats.custom.length === 0 ? (
              <Empty icon="pricetags-outline" title="No custom categories yet" body="Add one like Pets, Kids or Gifts." />
            ) : (
              cats.custom.map((c) => <CustomRow key={c.id} id={c.id} name={c.name} />)
            )}
            <View style={{ flexDirection: "row" }}>
              <AddCategoryChip testID="categories-add" />
            </View>
          </Card>
          <Card style={{ gap: 12 }}>
            <T v="h2">Built-in</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[...(cats.data?.builtin ?? []), ...(cats.data?.excluded ?? [])].map((c) => (
                <Chip key={c} label={c} />
              ))}
            </View>
            <T v="caption">“Transfer / P2P” covers payments to people and is left out of spending and budgets.</T>
          </Card>
        </Page>
      </KeyboardAwareScrollView>
    </View>
  );
}

function CustomRow({ id, name }: { id: string; name: string }) {
  const styles = useStyles();
  const inp = inputStyle();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [value, setValue] = useState(name);
  const done = () => {
    qc.invalidateQueries();
    setMode("view");
  };
  const rename = useMutation({
    mutationFn: () => api(`/categories/${id}`, { method: "PATCH", body: { name: value } }),
    onSuccess: () => {
      toast(`Renamed to “${value.trim()}” everywhere`, "success");
      done();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: () => api<{ moved_to_other: number }>(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: (r) => {
      toast(`Deleted “${name}”${r.moved_to_other ? ` · ${r.moved_to_other} transaction${r.moved_to_other === 1 ? "" : "s"} moved to Other` : ""}`, "success");
      done();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (mode === "edit") {
    return (
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput
          testID={`category-rename-input-${id}`}
          style={[inp.input, { flex: 1, minWidth: 0 }]}
          value={value}
          onChangeText={setValue}
          autoFocus
          maxLength={30}
          placeholderTextColor={colors.muted}
        />
        <Btn testID={`category-rename-save-${id}`} title="Save" disabled={!value.trim() || value.trim() === name} loading={rename.isPending} onPress={() => rename.mutate()} />
        <Pressable testID={`category-rename-cancel-${id}`} onPress={() => { setValue(name); setMode("view"); }} hitSlop={8} style={styles.iconBtn}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
    );
  }
  if (mode === "delete") {
    return (
      <View style={[styles.confirm, { borderColor: colors.error }]}>
        <T v="label">Delete “{name}”?</T>
        <T v="caption">Its transactions move to Other and its budget is removed.</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn testID={`category-delete-cancel-${id}`} title="Cancel" kind="secondary" style={{ flex: 1 }} onPress={() => setMode("view")} />
          <Btn testID={`category-delete-confirm-${id}`} title="Delete" kind="danger" style={{ flex: 1 }} loading={del.isPending} onPress={() => del.mutate()} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.row} testID={`custom-category-${id}`}>
      <CatIcon category={name} size={36} />
      <T v="label" style={{ flex: 1 }} numberOfLines={1}>{name}</T>
      <Pressable testID={`category-rename-${id}`} onPress={() => setMode("edit")} hitSlop={6} style={styles.iconBtn}>
        <Icon name="create-outline" size={20} color={colors.brandPrimary} />
      </Pressable>
      <Pressable testID={`category-delete-${id}`} onPress={() => setMode("delete")} hitSlop={6} style={styles.iconBtn}>
        <Icon name="trash-outline" size={20} color={colors.error} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  confirm: { gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
}));
