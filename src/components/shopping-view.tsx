"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useMemberName, useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/card";
import { parseIngredientLine } from "@/lib/ingredients";
import { fetchAliasMap, getOrCreateActiveList } from "@/lib/shopping";
import { CATEGORY_LABELS, CATEGORY_ORDER, cn, formatRelativeTime } from "@/lib/utils";
import type { ShoppingList, ShoppingListItem } from "@/lib/types";

/**
 * 買い物リスト。家族全員でリアルタイムに共有し、買った人がチェックする。
 * 「誰がチェックしたか」を出すのは、店で分担して買うときに効く（設計書 2.4）。
 */
export function ShoppingView({
  list,
  items: initialItems,
  pastLists,
}: {
  list: ShoppingList | null;
  items: ShoppingListItem[];
  pastLists: ShoppingList[];
}) {
  const router = useRouter();
  const { household, user } = useSession();
  const memberName = useMemberName();

  const [items, setItems] = useState(initialItems);
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [showChecked, setShowChecked] = useState(true);

  useEffect(() => setItems(initialItems), [initialItems]);

  // Realtime: 家族が店でチェックした結果が数百msで手元に反映される
  useEffect(() => {
    if (!list) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`shopping:${list.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shopping_list_items",
          filter: `list_id=eq.${list.id}`,
        },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as ShoppingListItem;
              return prev.some((i) => i.id === row.id) ? prev : [...prev, row];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as ShoppingListItem;
              return prev.map((i) => (i.id === row.id ? row : i));
            }
            const old = payload.old as { id: string };
            return prev.filter((i) => i.id !== old.id);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [list]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShoppingListItem[]>();
    for (const item of items) {
      if (!showChecked && item.is_checked) continue;
      map.set(item.category, [...(map.get(item.category) ?? []), item]);
    }
    return CATEGORY_ORDER.map((c) => ({ category: c, items: map.get(c) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [items, showChecked]);

  const remaining = items.filter((i) => !i.is_checked).length;

  const toggle = async (item: ShoppingListItem) => {
    const next = !item.is_checked;
    // 楽観更新。店の中は電波が悪いことが多いので、待たせない。
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              is_checked: next,
              checked_by: next ? user.id : null,
              checked_at: next ? new Date().toISOString() : null,
            }
          : i,
      ),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("shopping_list_items")
      .update({
        is_checked: next,
        checked_by: next ? user.id : null,
        checked_at: next ? new Date().toISOString() : null,
      })
      .eq("id", item.id);
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  };

  const removeItem = async (item: ShoppingListItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    const supabase = createClient();
    await supabase.from("shopping_list_items").delete().eq("id", item.id);
  };

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newItem.trim();
    if (!text) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const target = list ?? (await getOrCreateActiveList(supabase, household.id, user.id));
      const parsed = parseIngredientLine(text);
      const aliases = await fetchAliasMap(supabase);
      const resolved = parsed.name ? aliases.get(parsed.name) : undefined;

      const { error } = await supabase.from("shopping_list_items").insert({
        list_id: target.id,
        name: resolved?.canonical_name ?? parsed.name ?? text,
        quantity: parsed.quantity,
        unit: parsed.unit,
        display_text: text,
        category: resolved?.category ?? "other",
        added_by: user.id,
        sort_order: CATEGORY_ORDER.indexOf(resolved?.category ?? "other"),
      });
      if (error) throw error;
      setNewItem("");
      if (!list) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const finishList = async () => {
    if (!list) return;
    const supabase = createClient();
    await supabase.from("shopping_lists").update({ status: "done" }).eq("id", list.id);
    router.refresh();
  };

  return (
    <div className="px-4 py-4">
      {list ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{list.name}</h2>
            <p className="text-xs text-muted-foreground">
              残り{remaining}品 / 全{items.length}品
              {list.status === "done" ? "・完了済み" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowChecked((v) => !v)}
            className="shrink-0 text-xs text-muted-foreground underline"
          >
            {showChecked ? "買った物を隠す" : "買った物も表示"}
          </button>
        </div>
      ) : null}

      <form onSubmit={addItem} className="mb-4 flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="牛乳 1本"
          aria-label="品目を追加"
        />
        <Button type="submit" size="icon" aria-label="追加" disabled={busy || !newItem.trim()}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="size-10" />}
          title="買う物がありません"
          description="上の欄から追加するか、献立ボードで確定した献立からまとめて作れます。"
        />
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section key={group.category}>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                {CATEGORY_LABELS[group.category]}
              </h3>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      className="flex flex-1 items-center gap-3 px-3 py-3 text-left"
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition",
                          item.is_checked
                            ? "border-success bg-success text-white"
                            : "border-border",
                        )}
                      >
                        {item.is_checked ? <Check className="size-4" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm",
                            item.is_checked && "text-muted-foreground line-through",
                          )}
                        >
                          {item.display_text}
                        </span>
                        {item.is_checked && item.checked_by ? (
                          <span className="text-[11px] text-muted-foreground">
                            {memberName(item.checked_by)}が
                            {item.checked_at ? formatRelativeTime(item.checked_at) : ""}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item)}
                      aria-label={`${item.display_text}を削除`}
                      className="px-3 py-3 text-muted-foreground"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {list && list.status === "active" && items.length > 0 ? (
        <Button variant="outline" className="mt-6 w-full" onClick={finishList}>
          この買い物を終わりにする
        </Button>
      ) : null}

      {pastLists.length ? (
        <section className="mt-8">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">これまでのリスト</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {pastLists.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 rounded-md bg-muted px-3 py-2">
                <span className="truncate">{l.name}</span>
                <span className="shrink-0 text-xs">{formatRelativeTime(l.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
