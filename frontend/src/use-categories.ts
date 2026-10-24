import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api";
import { INCOME_CATEGORIES, P2P, SPEND_CATEGORIES } from "@/src/format";

export type Categories = {
  spend: string[];
  builtin: string[];
  excluded: string[];
  income: string[];
  custom: { id: string; name: string }[];
};

// Built-in + user's custom categories (custom ones are reusable and budgetable).
export function useCategories() {
  const q = useQuery({ queryKey: ["categories"], queryFn: () => api<Categories>("/categories"), staleTime: 60_000 });
  const spend = q.data?.spend ?? SPEND_CATEGORIES;
  return {
    ...q,
    spend,
    debit: [...spend, P2P],
    income: q.data?.income ?? INCOME_CATEGORIES,
    custom: q.data?.custom ?? [],
  };
}
