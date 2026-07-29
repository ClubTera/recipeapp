import { createClient } from "@/lib/supabase/server";
import { PlanBoard } from "@/components/plan-board";
import { addDays, startOfWeek, toDateString, parseDate } from "@/lib/utils";
import type { MealComment, MealPlan, MealPlanEntry, MealVote, Recipe } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const supabase = await createClient();

  const base = week ? parseDate(week) : new Date();
  const weekStart = startOfWeek(base);
  const weekStartStr = toDateString(weekStart);
  const weekEndStr = toDateString(addDays(weekStart, 6));

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .limit(1)
    .maybeSingle();
  const householdId = (membership as { household_id: string }).household_id;

  // その週の meal_plan を用意する（無ければ作る）
  let { data: plan } = await supabase
    .from("meal_plans")
    .select("*")
    .eq("household_id", householdId)
    .eq("week_start_date", weekStartStr)
    .maybeSingle();

  if (!plan) {
    const { data: created } = await supabase
      .from("meal_plans")
      .insert({ household_id: householdId, week_start_date: weekStartStr })
      .select("*")
      .maybeSingle();
    plan = created;

    // 同時アクセスで一意制約に当たった場合は、相手が作った行を読み直す
    if (!plan) {
      const { data: existing } = await supabase
        .from("meal_plans")
        .select("*")
        .eq("household_id", householdId)
        .eq("week_start_date", weekStartStr)
        .maybeSingle();
      plan = existing;
    }
  }

  const planId = (plan as MealPlan | null)?.id;

  const [{ data: entries }, { data: recipes }] = await Promise.all([
    planId
      ? supabase
          .from("meal_plan_entries")
          .select("*")
          .eq("meal_plan_id", planId)
          .neq("status", "archived")
          .gte("date", weekStartStr)
          .lte("date", weekEndStr)
          .order("sort_order")
      : Promise.resolve({ data: [] as MealPlanEntry[] }),
    supabase.from("recipes").select("id, title, image_url").order("created_at", { ascending: false }),
  ]);

  const entryIds = ((entries ?? []) as MealPlanEntry[]).map((e) => e.id);

  const [{ data: votes }, { data: comments }] = await Promise.all([
    entryIds.length
      ? supabase.from("meal_votes").select("*").in("entry_id", entryIds)
      : Promise.resolve({ data: [] as MealVote[] }),
    entryIds.length
      ? supabase.from("meal_comments").select("*").in("entry_id", entryIds).order("created_at")
      : Promise.resolve({ data: [] as MealComment[] }),
  ]);

  return (
    <PlanBoard
      plan={plan as MealPlan}
      weekStart={weekStartStr}
      entries={(entries ?? []) as MealPlanEntry[]}
      votes={(votes ?? []) as MealVote[]}
      comments={(comments ?? []) as MealComment[]}
      recipes={(recipes ?? []) as Pick<Recipe, "id" | "title" | "image_url">[]}
    />
  );
}
