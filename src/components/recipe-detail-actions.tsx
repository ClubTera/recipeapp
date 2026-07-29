"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChefHat, Loader2, ShoppingCart, Star, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { addIngredientsToList } from "@/lib/shopping";
import { cn, isToday } from "@/lib/utils";
import type { CookingLog, Recipe, RecipeIngredient } from "@/lib/types";

export function RecipeDetailActions({
  recipe,
  ingredients,
  logs,
}: {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  logs: CookingLog[];
}) {
  const router = useRouter();
  const { household, user } = useSession();
  const [favorite, setFavorite] = useState(recipe.is_favorite);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(ingredients.map((i) => i.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cookedToday = logs.some((l) => isToday(l.cooked_on));

  const toggleFavorite = async () => {
    const next = !favorite;
    setFavorite(next); // 楽観更新。失敗したら戻す。
    const supabase = createClient();
    const { error } = await supabase
      .from("recipes")
      .update({ is_favorite: next })
      .eq("id", recipe.id);
    if (error) setFavorite(!next);
    else router.refresh();
  };

  const logCooking = async () => {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.from("cooking_logs").insert({
        recipe_id: recipe.id,
        cooked_by: user.id,
      });
      setMessage("「作った」を記録しました");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const addToShopping = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const chosen = ingredients.filter((i) => selected.includes(i.id));
      const { count } = await addIngredientsToList(supabase, {
        householdId: household.id,
        userId: user.id,
        recipeId: recipe.id,
        ingredients: chosen,
      });
      setSheetOpen(false);
      setMessage(`買い物リストに${count}品を追加しました`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("このレシピを削除しますか？（元に戻せません）")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("recipes").delete().eq("id", recipe.id);
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant={ingredients.length ? "default" : "outline"}
          onClick={() => setSheetOpen(true)}
          disabled={ingredients.length === 0}
        >
          <ShoppingCart className="size-4" />
          買い物リストへ
        </Button>
        <Button variant="outline" onClick={logCooking} disabled={busy}>
          <ChefHat className="size-4" />
          {cookedToday ? "今日も作った" : "作った！"}
        </Button>
        <Button variant="outline" size="icon" aria-label="お気に入り" onClick={toggleFavorite}>
          <Star className={cn("size-5", favorite && "fill-primary text-primary")} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="削除" onClick={remove} disabled={busy}>
          <Trash2 className="size-5 text-destructive" />
        </Button>
      </div>

      {message ? (
        <p className="mt-2 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {message}
        </p>
      ) : null}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="買い物リストに追加">
        <p className="mb-3 text-sm text-muted-foreground">
          家にあるものはチェックを外してください。
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ingredients.map((ing) => {
            const checked = selected.includes(ing.id);
            return (
              <li key={ing.id}>
                <button
                  type="button"
                  onClick={() =>
                    setSelected((s) =>
                      checked ? s.filter((id) => id !== ing.id) : [...s, ing.id],
                    )
                  }
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm"
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded border",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {checked ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className={cn(!checked && "text-muted-foreground line-through")}>
                    {ing.raw_text}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={addToShopping} disabled={busy || selected.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {selected.length}品を追加
          </Button>
          <Button variant="outline" onClick={() => setSheetOpen(false)}>
            やめる
          </Button>
        </div>
      </Sheet>
    </>
  );
}
