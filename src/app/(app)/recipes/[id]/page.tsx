import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Clock, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { RecipeDetailActions } from "@/components/recipe-detail-actions";
import { Badge } from "@/components/ui/card";
import { SOURCE_LABELS, formatShortDate } from "@/lib/utils";
import type { CookingLog, Recipe, RecipeIngredient, RecipeStep } from "@/lib/types";

export const dynamic = "force-dynamic";

/** YouTube のURLから埋め込み用のIDを取り出す */
function youtubeId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] ?? null;
      return u.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: recipe }, { data: ingredients }, { data: steps }, { data: tagRows }, { data: logs }] =
    await Promise.all([
      supabase.from("recipes").select("*").eq("id", id).maybeSingle(),
      supabase.from("recipe_ingredients").select("*").eq("recipe_id", id).order("sort_order"),
      supabase.from("recipe_steps").select("*").eq("recipe_id", id).order("step_no"),
      supabase.from("recipe_tags").select("tags(id, name)").eq("recipe_id", id),
      supabase
        .from("cooking_logs")
        .select("*")
        .eq("recipe_id", id)
        .order("cooked_on", { ascending: false }),
    ]);

  if (!recipe) notFound();

  const r = recipe as Recipe;
  const ings = (ingredients ?? []) as RecipeIngredient[];
  const cookingLogs = (logs ?? []) as CookingLog[];
  const tags = ((tagRows ?? []) as unknown as { tags: { id: string; name: string } | null }[])
    .map((t) => t.tags)
    .filter(Boolean) as { id: string; name: string }[];

  const ytId = r.source_type === "youtube" ? youtubeId(r.source_url) : null;

  // グループ見出しごとに材料をまとめる
  const groups: { name: string | null; items: RecipeIngredient[] }[] = [];
  for (const ing of ings) {
    const last = groups[groups.length - 1];
    if (last && last.name === (ing.group_name ?? null)) last.items.push(ing);
    else groups.push({ name: ing.group_name ?? null, items: [ing] });
  }

  return (
    <article className="pb-8">
      {ytId ? (
        <div className="aspect-video w-full bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${ytId}`}
            title={r.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            className="size-full"
          />
        </div>
      ) : r.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.image_url} alt="" className="aspect-[4/3] w-full object-cover sm:aspect-[16/9]" />
      ) : null}

      <div className="px-4 py-4">
        <h2 className="text-xl font-bold leading-snug">{r.title}</h2>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone="outline">{SOURCE_LABELS[r.source_type]}</Badge>
          {r.source_site_name ? <span>{r.source_site_name}</span> : null}
          {r.source_author ? <span>／ {r.source_author}</span> : null}
          {r.servings ? (
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {r.servings}
            </span>
          ) : null}
          {r.cook_time_minutes ? (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {r.cook_time_minutes}分
            </span>
          ) : null}
        </div>

        {tags.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t.id} tone="primary">
                {t.name}
              </Badge>
            ))}
          </div>
        ) : null}

        {r.source_url ? (
          <a
            href={r.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary underline"
          >
            <ExternalLink className="size-4" />
            元のページを開く
          </a>
        ) : null}

        {r.description ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{r.description}</p>
        ) : null}

        {r.memo ? (
          <div className="mt-4 rounded-lg bg-accent p-3">
            <p className="text-xs font-semibold text-accent-foreground">家族メモ</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-accent-foreground">{r.memo}</p>
          </div>
        ) : null}

        <RecipeDetailActions recipe={r} ingredients={ings} logs={cookingLogs} />

        {groups.length ? (
          <section className="mt-6">
            <h3 className="mb-2 text-base font-semibold">材料</h3>
            {groups.map((group, gi) => (
              <div key={gi} className="mb-3">
                {group.name ? (
                  <p className="mb-1 text-sm font-medium text-muted-foreground">{group.name}</p>
                ) : null}
                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                  {group.items.map((ing) => (
                    <li key={ing.id} className="px-3 py-2.5 text-sm">
                      {/* 表示は常に入力そのまま（raw_text）を使う */}
                      {ing.raw_text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}

        {steps?.length ? (
          <section className="mt-6">
            <h3 className="mb-2 text-base font-semibold">作り方</h3>
            <ol className="space-y-3">
              {(steps as RecipeStep[]).map((step) => (
                <li key={step.id} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {step.step_no}
                  </span>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {cookingLogs.length ? (
          <section className="mt-6">
            <h3 className="mb-2 text-base font-semibold">作った記録</h3>
            <ul className="flex flex-wrap gap-2">
              {cookingLogs.slice(0, 12).map((log) => (
                <Badge key={log.id} tone="muted">
                  {formatShortDate(log.cooked_on)}
                  {log.rating ? ` ★${log.rating}` : ""}
                </Badge>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-8 flex gap-3 text-sm">
          <Link href={`/recipes/${r.id}/edit`} className="text-primary underline">
            編集する
          </Link>
        </div>
      </div>
    </article>
  );
}
