"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, Star, UtensilsCrossed, X } from "lucide-react";
import type { Recipe, Tag } from "@/lib/types";
import { Badge, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SOURCE_LABELS, cn, formatShortDate } from "@/lib/utils";
import { useSession } from "@/components/session-provider";

type Sort = "created" | "cooked_count" | "cooked_last";

const SORTS: { value: Sort; label: string }[] = [
  { value: "created", label: "追加順" },
  { value: "cooked_count", label: "作った回数" },
  { value: "cooked_last", label: "最後に作った日" },
];

export function RecipeList({
  recipes,
  tags,
  recipeTags,
  cookStats,
}: {
  recipes: Recipe[];
  tags: Tag[];
  recipeTags: { recipe_id: string; tag_id: string }[];
  cookStats: Record<string, { count: number; last: string | null }>;
}) {
  const { members } = useSession();
  const [query, setQuery] = useState("");
  const [tagId, setTagId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<string | null>(null);
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("created");

  const tagsByRecipe = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rt of recipeTags) {
      map.set(rt.recipe_id, [...(map.get(rt.recipe_id) ?? []), rt.tag_id]);
    }
    return map;
  }, [recipeTags]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = recipes.filter((r) => {
      if (favoriteOnly && !r.is_favorite) return false;
      if (sourceType && r.source_type !== sourceType) return false;
      if (authorId && r.created_by !== authorId) return false;
      if (tagId && !(tagsByRecipe.get(r.id) ?? []).includes(tagId)) return false;
      if (q) {
        const haystack = [r.title, r.description, r.memo, r.source_site_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sort === "cooked_count") {
        return (cookStats[b.id]?.count ?? 0) - (cookStats[a.id]?.count ?? 0);
      }
      if (sort === "cooked_last") {
        const av = cookStats[a.id]?.last ?? "";
        const bv = cookStats[b.id]?.last ?? "";
        return bv.localeCompare(av);
      }
      return b.created_at.localeCompare(a.created_at);
    });

    return list;
  }, [recipes, query, tagId, sourceType, authorId, favoriteOnly, sort, tagsByRecipe, cookStats]);

  const hasFilter = Boolean(tagId || sourceType || authorId || favoriteOnly || query);

  return (
    <div className="px-4 py-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="レシピ名・メモで検索"
          className="h-11 w-full rounded-full border border-input bg-card pl-10 pr-4 text-base placeholder:text-muted-foreground focus:outline-2 focus:outline-ring"
        />
      </div>

      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
        <FilterChip active={favoriteOnly} onClick={() => setFavoriteOnly((v) => !v)}>
          <Star className={cn("size-3.5", favoriteOnly && "fill-current")} />
          お気に入り
        </FilterChip>

        {tags.map((tag) => (
          <FilterChip
            key={tag.id}
            active={tagId === tag.id}
            onClick={() => setTagId((v) => (v === tag.id ? null : tag.id))}
          >
            {tag.name}
          </FilterChip>
        ))}

        {Object.entries(SOURCE_LABELS).map(([value, label]) => (
          <FilterChip
            key={value}
            active={sourceType === value}
            onClick={() => setSourceType((v) => (v === value ? null : value))}
          >
            {label}
          </FilterChip>
        ))}

        {members.length > 1 &&
          members.map((m) => (
            <FilterChip
              key={m.id}
              active={authorId === m.id}
              onClick={() => setAuthorId((v) => (v === m.id ? null : m.id))}
            >
              {m.display_name}
            </FilterChip>
          ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSort(s.value)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition",
                sort === s.value ? "bg-accent text-accent-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length}件</span>
          {hasFilter ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setTagId(null);
                setSourceType(null);
                setAuthorId(null);
                setFavoriteOnly(false);
              }}
              className="flex items-center gap-0.5 text-xs text-muted-foreground underline"
            >
              <X className="size-3" />
              解除
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed className="size-10" />}
          title={recipes.length === 0 ? "まだレシピがありません" : "条件に合うレシピがありません"}
          description={
            recipes.length === 0
              ? "URLを貼るだけで、タイトルや写真を自動で取り込めます。"
              : undefined
          }
          action={
            recipes.length === 0 ? (
              <Link href="/recipes/new">
                <Button size="lg">
                  <Plus className="size-5" />
                  最初のレシピを追加
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3">
          {filtered.map((recipe) => (
            <li key={recipe.id}>
              <RecipeCard recipe={recipe} stats={cookStats[recipe.id]} />
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/recipes/new"
        aria-label="レシピを追加"
        className="fixed bottom-20 right-4 z-20 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition active:scale-95"
      >
        <Plus className="size-7" />
      </Link>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function RecipeCard({
  recipe,
  stats,
}: {
  recipe: Recipe;
  stats?: { count: number; last: string | null };
}) {
  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition active:scale-[0.98]"
    >
      <div className="relative aspect-[4/3] w-full bg-muted">
        {recipe.image_url ? (
          // 外部サイトの任意ドメインを扱うため next/image は使わない
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.image_url}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <UtensilsCrossed className="size-8" />
          </div>
        )}
        {recipe.is_favorite ? (
          <Star className="absolute right-2 top-2 size-5 fill-primary text-primary drop-shadow" />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{recipe.title}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1">
          <Badge tone="outline">{SOURCE_LABELS[recipe.source_type]}</Badge>
          {recipe.cook_time_minutes ? (
            <Badge tone="muted">{recipe.cook_time_minutes}分</Badge>
          ) : null}
          {stats?.count ? <Badge tone="muted">{stats.count}回</Badge> : null}
          {stats?.last ? (
            <span className="text-[10px] text-muted-foreground">{formatShortDate(stats.last)}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
