import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api";
import { useToast } from "@/src/toast";

export function useLoadSample() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => api<{ created: number; merged: number; review: number }>("/sms/sample", { method: "POST" }),
    onSuccess: (r) => {
      toast(`${r.created} transactions added, ${r.merged} duplicate merged, ${r.review} to review`, "success");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
}
