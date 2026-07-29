import { createClient } from "@/lib/supabase/server";
import { RecipeList } from "@/components/recipe-list";
import type { Recipe, Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const supabase = await createClient();

  const [{ data: recipes }, { data: tags }, { data: recipeTags }, { data: logs }] =
    await Promise.all([
      supabase.from("recipes").select("*").order("created_at", { ascending: false }),
      supabase.from("tags").select("*").order("name"),
      supabase.from("recipe_tags").select("recipe_id, tag_id"),
      supabase.from("cooking_logs").select("recipe_id, cooked_on"),
    ]);

  // 「作った回数」「最後に作った日」でのソート用に集計しておく
  const cookStats = new Map<string, { count: number; last: string | null }>();
  for (const log of (logs ?? []) as { recipe_id: string; cooked_on: string }[]) {
    const cur = cookStats.get(log.recipe_id) ?? { count: 0, last: null };
    cur.count += 1;
    if (!cur.last || log.cooked_on > cur.last) cur.last = log.cooked_on;
    cookStats.set(log.recipe_id, cur);
  }

  return (
    <RecipeList
      recipes={(recipes ?? []) as Recipe[]}
      tags={(tags ?? []) as Tag[]}
      recipeTags={(recipeTags ?? []) as { recipe_id: string; tag_id: string }[]}
      cookStats={Object.fromEntries(cookStats)}
    />
  );
}
