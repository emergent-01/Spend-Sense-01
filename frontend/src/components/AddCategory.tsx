import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api";
import { Btn, Icon, T, inputStyle } from "@/src/components/ui";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

// "+ Add category" chip that expands into a name field; calls onCreated with the new name.
export function AddCategoryChip({ onCreated, testID = "add-category" }: { onCreated?: (name: string) => void; testID?: string }) {
  const { colors } = useTheme();
  const inp = inputStyle();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ id: string; name: string }>("/categories", { method: "POST", body: { name } }),
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast(`“${c.name}” added — it's now in every category list and Budgets`, "success");
      setName("");
      setOpen(false);
      onCreated?.(c.name);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (!open) {
    return (
      <Pressable
        testID={`${testID}-chip`}
        onPress={() => setOpen(true)}
        style={{
          height: 36,
          flexShrink: 0,
          paddingHorizontal: 14,
          borderRadius: 999,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: colors.brandPrimary,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Icon name="add" size={16} color={colors.brandPrimary} />
        <T v="label" style={{ color: colors.brandPrimary, fontSize: 13 }}>Add category</T>
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: "row", gap: 8, width: "100%", alignItems: "center" }}>
      <TextInput
        testID={`${testID}-input`}
        style={[inp.input, { flex: 1, minWidth: 0 }]}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Pets, Kids, Gifts"
        placeholderTextColor={colors.muted}
        autoFocus
        maxLength={30}
        onSubmitEditing={() => name.trim() && create.mutate()}
        returnKeyType="done"
      />
      <Btn testID={`${testID}-save`} title="Add" disabled={!name.trim()} loading={create.isPending} onPress={() => create.mutate()} />
      <Pressable testID={`${testID}-cancel`} onPress={() => setOpen(false)} hitSlop={8} style={{ width: 36, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}
