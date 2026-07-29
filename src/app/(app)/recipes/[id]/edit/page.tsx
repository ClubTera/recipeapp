import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecipeForm } from "@/components/recipe-form";
import type { Recipe, RecipeIngredient, RecipeStep, Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: recipe }, { data: ingredients }, { data: steps }, { data: tags }, { data: recipeTags }] =
    await Promise.all([
      supabase.from("recipes").select("*").eq("id", id).maybeSingle(),
      supabase.from("recipe_ingredients").select("*").eq("recipe_id", id).order("sort_order"),
      supabase.from("recipe_steps").select("*").eq("recipe_id", id).order("step_no"),
      supabase.from("tags").select("*").order("name"),
      supabase.from("recipe_tags").select("tag_id").eq("recipe_id", id),
    ]);

  if (!recipe) notFound();

  return (
    <RecipeForm
      tags={(tags ?? []) as Tag[]}
      initial={{
        recipe: recipe as Recipe,
        ingredients: (ingredients ?? []) as RecipeIngredient[],
        steps: (steps ?? []) as RecipeStep[],
        tagIds: ((recipeTags ?? []) as { tag_id: string }[]).map((t) => t.tag_id),
      }}
    />
  );
}
