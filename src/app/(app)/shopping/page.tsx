import { createClient } from "@/lib/supabase/server";
import { ShoppingView } from "@/components/shopping-view";
import type { ShoppingList, ShoppingListItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const supabase = await createClient();

  const { data: lists } = await supabase
    .from("shopping_lists")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  const all = (lists ?? []) as ShoppingList[];
  const active = all.find((l) => l.status === "active") ?? all[0] ?? null;

  const { data: items } = active
    ? await supabase
        .from("shopping_list_items")
        .select("*")
        .eq("list_id", active.id)
        .order("sort_order")
        .order("created_at")
    : { data: [] };

  return (
    <ShoppingView
      list={active}
      items={(items ?? []) as ShoppingListItem[]}
      pastLists={all.filter((l) => l.id !== active?.id)}
    />
  );
}
