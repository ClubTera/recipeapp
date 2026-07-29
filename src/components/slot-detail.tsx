"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Search, Send, ThumbsUp, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useMemberName } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import { PROPOSED_KEY } from "@/components/push-soft-prompt";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { MealComment, MealPlan, MealPlanEntry, MealSlot, MealVote, Recipe } from "@/lib/types";

type SlimRecipe = Pick<Recipe, "id" | "title" | "image_url">;

/**
 * スロット（ある日の朝/昼/夕）の詳細。
 * 候補の一覧・投票・コメント・確定を1画面で扱う。
 * ボトムシートからも単独ページ（通知のリンク先）からも同じものを使う。
 */
export function SlotDetail({
  plan,
  date,
  slot,
  entries,
  votes,
  comments,
  recipes,
  currentUserId,
}: {
  plan: MealPlan;
  date: string;
  slot: MealSlot;
  entries: MealPlanEntry[];
  votes: MealVote[];
  comments: MealComment[];
  recipes: SlimRecipe[];
  currentUserId: string;
}) {
  const router = useRouter();
  const memberName = useMemberName();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [freeText, setFreeText] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const confirmed = entries.find((e) => e.status === "confirmed");
  const candidates = entries.filter((e) => e.status === "candidate");

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes.slice(0, 8);
    return recipes.filter((r) => r.title.toLowerCase().includes(q)).slice(0, 12);
  }, [query, recipes]);

  const label = (entry: MealPlanEntry) =>
    entry.recipe_id ? (recipeById.get(entry.recipe_id)?.title ?? "レシピ") : (entry.free_text ?? "");

  const addCandidate = async (payload: { recipeId?: string; freeText?: string }) => {
    setBusyId("new");
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("meal_plan_entries").insert({
        meal_plan_id: plan.id,
        date,
        meal_slot: slot,
        recipe_id: payload.recipeId ?? null,
        free_text: payload.freeText ?? null,
        added_by: currentUserId,
        sort_order: entries.length,
      });
      if (error) throw error;
      // 「提案した直後」は通知の価値が伝わる瞬間。ソフトプロンプトの出し時に使う。
      localStorage.setItem(PROPOSED_KEY, "1");
      setQuery("");
      setFreeText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  const vote = async (entryId: string, value: "want" | "pass") => {
    const current = votes.find((v) => v.entry_id === entryId && v.user_id === currentUserId);
    setBusyId(entryId);
    try {
      const supabase = createClient();
      if (current?.value === value) {
        // 同じボタンをもう一度押したら取り消し
        await supabase
          .from("meal_votes")
          .delete()
          .eq("entry_id", entryId)
          .eq("user_id", currentUserId);
      } else {
        await supabase
          .from("meal_votes")
          .upsert(
            { entry_id: entryId, user_id: currentUserId, value },
            { onConflict: "entry_id,user_id" },
          );
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const confirm = async (entry: MealPlanEntry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      const supabase = createClient();
      // 楽観ロック: 読み込んだ後に誰かが触っていたら 0 件更新になる（設計書 10章）
      const { data, error } = await supabase
        .from("meal_plan_entries")
        .update({ status: "confirmed" })
        .eq("id", entry.id)
        .eq("updated_at", entry.updated_at)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        setError("ほかの家族が先に操作しました。最新の状態を読み込みます。");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "確定に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  const unconfirm = async (entry: MealPlanEntry) => {
    setBusyId(entry.id);
    const supabase = createClient();
    await supabase.from("meal_plan_entries").update({ status: "candidate" }).eq("id", entry.id);
    router.refresh();
    setBusyId(null);
  };

  const removeEntry = async (entry: MealPlanEntry) => {
    setBusyId(entry.id);
    const supabase = createClient();
    await supabase.from("meal_plan_entries").delete().eq("id", entry.id);
    router.refresh();
    setBusyId(null);
  };

  const addComment = async (entryId: string) => {
    const body = (commentDrafts[entryId] ?? "").trim();
    if (!body) return;
    setBusyId(entryId);
    try {
      const supabase = createClient();
      await supabase.from("meal_comments").insert({
        entry_id: entryId,
        user_id: currentUserId,
        body,
      });
      setCommentDrafts((d) => ({ ...d, [entryId]: "" }));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const renderEntry = (entry: MealPlanEntry) => {
    const entryVotes = votes.filter((v) => v.entry_id === entry.id);
    const wants = entryVotes.filter((v) => v.value === "want");
    const passes = entryVotes.filter((v) => v.value === "pass");
    const myVote = entryVotes.find((v) => v.user_id === currentUserId)?.value;
    const entryComments = comments.filter((c) => c.entry_id === entry.id);
    const isConfirmed = entry.status === "confirmed";

    return (
      <li
        key={entry.id}
        className={cn(
          "rounded-lg border p-3",
          isConfirmed ? "border-success bg-success/5" : "border-border bg-card",
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">
              {isConfirmed ? <span className="mr-1 text-success">✓</span> : null}
              {entry.recipe_id ? (
                <Link href={`/recipes/${entry.recipe_id}`} className="underline-offset-2 hover:underline">
                  {label(entry)}
                </Link>
              ) : (
                label(entry)
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {memberName(entry.added_by)}が提案・{formatRelativeTime(entry.created_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => removeEntry(entry)}
            aria-label="この候補を削除"
            className="shrink-0 p-1 text-muted-foreground"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => vote(entry.id, "want")}
            disabled={busyId === entry.id}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition",
              myVote === "want"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            <ThumbsUp className="size-3.5" />
            食べたい {wants.length > 0 ? wants.length : ""}
          </button>
          <button
            type="button"
            onClick={() => vote(entry.id, "pass")}
            disabled={busyId === entry.id}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition",
              myVote === "pass" ? "border-foreground bg-muted" : "border-border text-muted-foreground",
            )}
          >
            🙅 今週はパス {passes.length > 0 ? passes.length : ""}
          </button>

          {isConfirmed ? (
            <Button variant="ghost" size="sm" onClick={() => unconfirm(entry)} className="ml-auto">
              確定を取り消す
            </Button>
          ) : (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => confirm(entry)}
              disabled={busyId === entry.id}
            >
              {busyId === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              これにする
            </Button>
          )}
        </div>

        {wants.length > 0 || passes.length > 0 ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {wants.length > 0 ? `👍 ${wants.map((v) => memberName(v.user_id)).join("・")}` : ""}
            {wants.length > 0 && passes.length > 0 ? " / " : ""}
            {passes.length > 0 ? `🙅 ${passes.map((v) => memberName(v.user_id)).join("・")}` : ""}
          </p>
        ) : null}

        {entryComments.length > 0 ? (
          <ul className="mt-3 space-y-1.5 border-t border-border pt-2">
            {entryComments.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="font-medium">{memberName(c.user_id)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {formatRelativeTime(c.created_at)}
                </span>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            addComment(entry.id);
          }}
        >
          <Input
            value={commentDrafts[entry.id] ?? ""}
            onChange={(e) => setCommentDrafts((d) => ({ ...d, [entry.id]: e.target.value }))}
            placeholder="コメントする"
            className="h-9 text-sm"
          />
          <Button type="submit" size="icon" variant="ghost" aria-label="送信" className="h-9 w-9">
            <Send className="size-4" />
          </Button>
        </form>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">{error}</p>
      ) : null}

      {confirmed ? (
        <section>
          <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">決まった献立</h4>
          <ul>{renderEntry(confirmed)}</ul>
        </section>
      ) : null}

      {candidates.length > 0 ? (
        <section>
          <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">
            候補（{candidates.length}件）
          </h4>
          <ul className="space-y-2">{candidates.map(renderEntry)}</ul>
        </section>
      ) : confirmed ? null : (
        <p className="rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
          まだ候補がありません。下から追加して家族に相談しましょう。
        </p>
      )}

      <section className="border-t border-border pt-4">
        <h4 className="mb-2 text-xs font-semibold text-muted-foreground">候補を追加</h4>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="レシピを検索"
            className="pl-9"
          />
        </div>

        {searchResults.length > 0 ? (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {searchResults.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => addCandidate({ recipeId: r.id })}
                  disabled={busyId === "new"}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-sm transition hover:bg-muted"
                >
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt="" className="size-8 rounded object-cover" />
                  ) : (
                    <span className="size-8 rounded bg-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <Badge tone="outline">追加</Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : query ? (
          <p className="mt-2 text-xs text-muted-foreground">該当するレシピがありません。</p>
        ) : null}

        <form
          className="mt-3 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (freeText.trim()) addCandidate({ freeText: freeText.trim() });
          }}
        >
          <Input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="レシピ未登録（外食・残り物 など）"
          />
          <Button type="submit" disabled={busyId === "new" || !freeText.trim()}>
            追加
          </Button>
        </form>
      </section>
    </div>
  );
}

export function SlotDetailEmpty() {
  return (
    <p className="p-6 text-center text-sm text-muted-foreground">
      <X className="mx-auto mb-2 size-6" />
      このスロットは見つかりませんでした。
    </p>
  );
}
