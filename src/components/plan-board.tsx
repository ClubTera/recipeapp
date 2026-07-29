"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, MessageCircle, Plus, ShoppingCart, ThumbsUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { SlotDetail } from "@/components/slot-detail";
import { ShoppingGenerateSheet } from "@/components/shopping-generate-sheet";
import { PushSoftPrompt } from "@/components/push-soft-prompt";
import {
  MEAL_SLOTS,
  SLOT_SHORT,
  addDays,
  cn,
  formatShortDate,
  isToday,
  parseDate,
  toDateString,
  weekdayLabel,
} from "@/lib/utils";
import type { MealComment, MealPlan, MealPlanEntry, MealSlot, MealVote, Recipe } from "@/lib/types";

type SlimRecipe = Pick<Recipe, "id" | "title" | "image_url">;

/**
 * 週の献立ボード（設計書 2.3 / 6.3）。
 * 1スロットに複数の候補を積み、家族が投票とコメントで相談して1つに確定させる。
 */
export function PlanBoard({
  plan,
  weekStart,
  entries,
  votes,
  comments,
  recipes,
}: {
  plan: MealPlan;
  weekStart: string;
  entries: MealPlanEntry[];
  votes: MealVote[];
  comments: MealComment[];
  recipes: SlimRecipe[];
}) {
  const router = useRouter();
  const { user } = useSession();
  const [openSlot, setOpenSlot] = useState<{ date: string; slot: MealSlot } | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => toDateString(addDays(parseDate(weekStart), i))),
    [weekStart],
  );

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  // Realtime: 家族の操作を全員の画面へ即時反映する。
  // 差分をローカルで組み立てるより、サーバー再取得の方が状態がずれない。
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => router.refresh();
    const channel = supabase
      .channel(`plan:${plan?.id ?? "none"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_plan_entries" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_votes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_comments" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [plan?.id, router]);

  const entriesFor = (date: string, slot: MealSlot) =>
    entries.filter((e) => e.date === date && e.meal_slot === slot);

  const votesFor = (entryId: string) => votes.filter((v) => v.entry_id === entryId);
  const commentsFor = (entryId: string) => comments.filter((c) => c.entry_id === entryId);

  const confirmedCount = entries.filter((e) => e.status === "confirmed").length;

  const goWeek = (delta: number) => {
    const next = toDateString(addDays(parseDate(weekStart), delta * 7));
    router.push(`/plan?week=${next}`);
  };

  const label = (entry: MealPlanEntry) =>
    entry.recipe_id ? (recipeById.get(entry.recipe_id)?.title ?? "レシピ") : (entry.free_text ?? "");

  return (
    <div className="px-4 py-4">
      <PushSoftPrompt />

      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" aria-label="前の週" onClick={() => goWeek(-1)}>
          <ChevronLeft className="size-5" />
        </Button>
        <p className="text-sm font-semibold">
          {formatShortDate(days[0])}（{weekdayLabel(days[0])}）〜 {formatShortDate(days[6])}（
          {weekdayLabel(days[6])}）
        </p>
        <Button variant="ghost" size="icon" aria-label="次の週" onClick={() => goWeek(1)}>
          <ChevronRight className="size-5" />
        </Button>
      </div>

      {/* モバイルは日付ごとの縦積み、PCは7列の週グリッド */}
      <div className="grid gap-3 lg:grid-cols-7">
        {days.map((date) => (
          <section
            key={date}
            className={cn(
              "overflow-hidden rounded-lg border bg-card",
              isToday(date) ? "border-primary" : "border-border",
            )}
          >
            <header
              className={cn(
                "flex items-baseline gap-2 px-3 py-2",
                isToday(date) ? "bg-accent text-accent-foreground" : "bg-muted",
              )}
            >
              <span className="text-sm font-bold">{formatShortDate(date)}</span>
              <span className="text-xs">{weekdayLabel(date)}</span>
              {isToday(date) ? <span className="ml-auto text-[10px] font-bold">今日</span> : null}
            </header>

            <div className="divide-y divide-border">
              {MEAL_SLOTS.map((slot) => {
                const slotEntries = entriesFor(date, slot);
                const confirmed = slotEntries.find((e) => e.status === "confirmed");
                const candidates = slotEntries.filter((e) => e.status === "candidate");

                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setOpenSlot({ date, slot })}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-muted/60"
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">
                      {SLOT_SHORT[slot]}
                    </span>

                    <span className="min-w-0 flex-1">
                      {confirmed ? (
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="text-success">✓</span>
                          <span className="truncate">{label(confirmed)}</span>
                        </span>
                      ) : candidates.length ? (
                        <span className="space-y-1">
                          <span className="block text-[11px] font-medium text-primary">
                            候補{candidates.length}件
                          </span>
                          {candidates.slice(0, 3).map((entry) => {
                            const want = votesFor(entry.id).filter((v) => v.value === "want").length;
                            const pass = votesFor(entry.id).filter((v) => v.value === "pass").length;
                            const cc = commentsFor(entry.id).length;
                            return (
                              <span
                                key={entry.id}
                                className="flex items-center gap-1.5 text-xs text-foreground"
                              >
                                <span className="min-w-0 flex-1 truncate">・{label(entry)}</span>
                                {want > 0 ? (
                                  <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                                    <ThumbsUp className="size-3" />
                                    {want}
                                  </span>
                                ) : null}
                                {pass > 0 ? (
                                  <span className="shrink-0 text-muted-foreground">🙅{pass}</span>
                                ) : null}
                                {cc > 0 ? (
                                  <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                                    <MessageCircle className="size-3" />
                                    {cc}
                                  </span>
                                ) : null}
                              </span>
                            );
                          })}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Plus className="size-3.5" />
                          候補を追加
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Button
        size="lg"
        className="mt-6 w-full"
        onClick={() => setGenerateOpen(true)}
        disabled={confirmedCount === 0}
      >
        <ShoppingCart className="size-5" />
        確定した献立から買い物リストを作る
        {confirmedCount > 0 ? `（${confirmedCount}件）` : ""}
      </Button>
      {confirmedCount === 0 ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          候補を「これにする」で確定させると、材料をまとめて買い物リストにできます。
        </p>
      ) : null}

      <Sheet
        open={openSlot !== null}
        onClose={() => setOpenSlot(null)}
        title={
          openSlot
            ? `${formatShortDate(openSlot.date)}（${weekdayLabel(openSlot.date)}）の${
                { breakfast: "朝食", lunch: "昼食", dinner: "夕食" }[openSlot.slot]
              }`
            : ""
        }
      >
        {openSlot ? (
          <SlotDetail
            plan={plan}
            date={openSlot.date}
            slot={openSlot.slot}
            entries={entriesFor(openSlot.date, openSlot.slot)}
            votes={votes}
            comments={comments}
            recipes={recipes}
            currentUserId={user.id}
          />
        ) : null}
      </Sheet>

      <ShoppingGenerateSheet
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        plan={plan}
        weekStart={weekStart}
        confirmedEntries={entries.filter((e) => e.status === "confirmed")}
      />
    </div>
  );
}
