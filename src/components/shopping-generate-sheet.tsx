"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { aggregateIngredients, type AggregatedItem } from "@/lib/ingredients";
import { fetchAliasMap, insertItems } from "@/lib/shopping";
import { CATEGORY_LABELS, CATEGORY_ORDER, addDays, cn, formatShortDate, parseDate } from "@/lib/utils";
import type { MealPlan, MealPlanEntry, RecipeIngredient } from "@/lib/types";

/**
 * 確定した献立から買い物リストを作る（設計書 6.4）。
 * 必ずプレビューを挟む。自動生成をそのまま押し付けると調味料だらけのリストになり、使われなくなる。
 * そのため調味料カテゴリは既定でチェックを外しておく。
 */
export function ShoppingGenerateSheet({
  open,
  onClose,
  plan,
  weekStart,
  confirmedEntries,
}: {
  open: boolean;
  onClose: () => void;
  plan: MealPlan;
  weekStart: string;
  confirmedEntries: MealPlanEntry[];
}) {
  const router = useRouter();
  const { household, user } = useSession();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<AggregatedItem[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = createClient();
        const recipeIds = [
          ...new Set(confirmedEntries.map((e) => e.recipe_id).filter(Boolean) as string[]),
        ];
        setSkippedCount(confirmedEntries.filter((e) => !e.recipe_id).length);

        if (recipeIds.length === 0) {
          if (!cancelled) setItems([]);
          return;
        }

        const [{ data: ingredients }, aliases] = await Promise.all([
          supabase.from("recipe_ingredients").select("*").in("recipe_id", recipeIds),
          fetchAliasMap(supabase),
        ]);

        const aggregated = aggregateIngredients(
          (ingredients ?? []) as (RecipeIngredient & { recipe_id: string })[],
          aliases,
        );
        if (cancelled) return;

        setItems(aggregated);
        // 調味料は家にあることが多いので、最初から外しておく
        setExcluded(
          new Set(
            aggregated
              .filter((i) => i.category === "seasoning")
              .map((i) => i.display_text),
          ),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "材料の取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, confirmedEntries]);

  const selected = items.filter((i) => !excluded.has(i.display_text));

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const end = addDays(parseDate(weekStart), 6);
      const name = `${formatShortDate(weekStart)}〜${formatShortDate(end)}の買い物`;

      const { data: list, error: listError } = await supabase
        .from("shopping_lists")
        .insert({
          household_id: household.id,
          name,
          source_meal_plan_id: plan.id,
          created_by: user.id,
        })
        .select("*")
        .single();
      if (listError) throw listError;

      await insertItems(supabase, (list as { id: string }).id, selected, user.id);

      // 品目数を含めた通知は、行を入れ終えてから出す（設計書 N6）
      await supabase.rpc("notify_shopping_list_created", {
        p_list_id: (list as { id: string }).id,
      });

      onClose();
      router.push("/shopping");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
      setSaving(false);
    }
  };

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <Sheet open={open} onClose={onClose} title="買い物リストを作る">
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            合算結果はこうなります。家にあるものはチェックを外してください。
          </p>

          {skippedCount > 0 ? (
            <p className="mb-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              レシピが紐づいていない献立が{skippedCount}件あります（外食・残り物など）。材料は含まれません。
            </p>
          ) : null}

          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              確定した献立に材料が登録されていません。
            </p>
          ) : (
            <div className="space-y-4">
              {grouped.map((group) => (
                <section key={group.category}>
                  <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    {CATEGORY_LABELS[group.category]}
                  </h4>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {group.items.map((item) => {
                      const checked = !excluded.has(item.display_text);
                      const fromMultiple = item.source_recipe_ids.length > 1;
                      return (
                        <li key={item.display_text}>
                          <button
                            type="button"
                            onClick={() =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(item.display_text);
                                else next.delete(item.display_text);
                                return next;
                              })
                            }
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm"
                          >
                            <span
                              className={cn(
                                "flex size-5 shrink-0 items-center justify-center rounded border",
                                checked
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border",
                              )}
                            >
                              {checked ? <Check className="size-3.5" /> : null}
                            </span>
                            <span
                              className={cn(
                                "flex-1",
                                !checked && "text-muted-foreground line-through",
                              )}
                            >
                              {item.display_text}
                            </span>
                            {fromMultiple ? (
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {item.source_recipe_ids.length}品から
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {error ? (
            <p className="mt-3 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button
              className="flex-1"
              onClick={create}
              disabled={saving || selected.length === 0}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {selected.length}品でリストを作る
            </Button>
            <Button variant="outline" onClick={onClose}>
              やめる
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
