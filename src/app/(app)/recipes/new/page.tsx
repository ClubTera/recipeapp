import { createClient } from "@/lib/supabase/server";
import { RecipeForm } from "@/components/recipe-form";
import type { Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewRecipePage() {
  const supabase = await createClient();
  const { data: tags } = await supabase.from("tags").select("*").order("name");

  return <RecipeForm tags={(tags ?? []) as Tag[]} />;
}
