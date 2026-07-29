import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SlotDetail } from "@/components/slot-detail";
import { SLOT_LABELS, formatDateLabel, parseDate, startOfWeek, toDateString } from "@/lib/utils";
import type { MealComment, MealPlan, MealPlanEntry, MealSlot, MealVote, Recipe } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 通知のリンク先（/plan/2026-07-30/dinner）。ボトムシートと同じ内容を単独ページで出す。 */
export default async function SlotPage({
  params,
}: {
  params: Promise<{ date: string; slot: string }>;
}) {
  const { date, slot } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  if (!["breakfast", "lunch", "dinner"].includes(slot)) notFound();

  const supabase = await createClient();
  const weekStart = toDateString(startOfWeek(parseDate(date)));

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .limit(1)
    .maybeSingle();
  const householdId = (membership as { household_id: string }).household_id;

  const { data: user } = await supabase.auth.getUser();

  let { data: plan } = await supabase
    .from("meal_plans")
    .select("*")
    .eq("household_id", householdId)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (!plan) {
    const { data: created } = await supabase
      .from("meal_plans")
      .insert({ household_id: householdId, week_start_date: weekStart })
      .select("*")
      .maybeSingle();
    plan = created;
  }
  if (!plan) notFound();

  const [{ data: entries }, { data: recipes }] = await Promise.all([
    supabase
      .from("meal_plan_entries")
      .select("*")
      .eq("meal_plan_id", (plan as MealPlan).id)
      .eq("date", date)
      .eq("meal_slot", slot)
      .neq("status", "archived")
      .order("sort_order"),
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
    <div className="px-4 py-4">
      <Link
        href={`/plan?week=${weekStart}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground"
      >
        <ChevronLeft className="size-4" />
        今週の献立へ
      </Link>

      <h2 className="mb-4 text-lg font-bold">
        {formatDateLabel(date)}の{SLOT_LABELS[slot]}
      </h2>

      <SlotDetail
        plan={plan as MealPlan}
        date={date}
        slot={slot as MealSlot}
        entries={(entries ?? []) as MealPlanEntry[]}
        votes={(votes ?? []) as MealVote[]}
        comments={(comments ?? []) as MealComment[]}
        recipes={(recipes ?? []) as Pick<Recipe, "id" | "title" | "image_url">[]}
        currentUserId={user.user!.id}
      />
    </div>
  );
}
