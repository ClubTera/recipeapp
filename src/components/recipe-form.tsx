"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Link2, Loader2, Sparkles, Star, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import { parseIngredientLine } from "@/lib/ingredients";
import { SOURCE_LABELS, cn } from "@/lib/utils";
import type {
  ExtractedMetadata,
  Recipe,
  RecipeIngredient,
  RecipeStep,
  SourceType,
  Tag,
} from "@/lib/types";

export type RecipeFormInitial = {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  tagIds: string[];
};

/**
 * レシピの新規作成／編集フォーム。
 * URL取り込みの結果は「初期値」として流し込むだけで、保存前に必ずここで編集できる（設計書 2.1）。
 */
export function RecipeForm({
  initial,
  tags,
}: {
  initial?: RecipeFormInitial;
  tags: Tag[];
}) {
  const router = useRouter();
  const { household, user } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);

  const [recipeId] = useState(() => initial?.recipe.id ?? crypto.randomUUID());
  const [sourceUrl, setSourceUrl] = useState(initial?.recipe.source_url ?? "");
  const [sourceType, setSourceType] = useState<SourceType>(
    initial?.recipe.source_type ?? "original",
  );
  const [siteName, setSiteName] = useState(initial?.recipe.source_site_name ?? "");
  const [author, setAuthor] = useState(initial?.recipe.source_author ?? "");
  const [rawMetadata, setRawMetadata] = useState<Record<string, unknown> | null>(
    initial?.recipe.raw_metadata ?? null,
  );

  const [title, setTitle] = useState(initial?.recipe.title ?? "");
  const [description, setDescription] = useState(initial?.recipe.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.recipe.image_url ?? "");
  const [servings, setServings] = useState(initial?.recipe.servings ?? "");
  const [cookTime, setCookTime] = useState(
    initial?.recipe.cook_time_minutes ? String(initial.recipe.cook_time_minutes) : "",
  );
  const [memo, setMemo] = useState(initial?.recipe.memo ?? "");
  const [isFavorite, setIsFavorite] = useState(initial?.recipe.is_favorite ?? false);

  const [ingredientsText, setIngredientsText] = useState(() =>
    initial ? ingredientsToText(initial.ingredients) : "",
  );
  const [stepsText, setStepsText] = useState(() =>
    initial ? initial.steps.map((s) => s.body).join("\n") : "",
  );
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const [newTagName, setNewTagName] = useState("");

  const [extracting, setExtracting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── URLからの取り込み ────────────────────────────────────────────────────
  const extract = async () => {
    const url = sourceUrl.trim();
    if (!url) return;
    setExtracting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/extract-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "取得に失敗しました");
      }
      const data = (await res.json()) as ExtractedMetadata;

      setSourceType(data.source_type);
      if (data.title && !title) setTitle(data.title);
      if (data.description && !description) setDescription(data.description);
      if (data.image_url && !imageUrl) setImageUrl(data.image_url);
      if (data.site_name) setSiteName(data.site_name);
      if (data.author) setAuthor(data.author);
      if (data.servings && !servings) setServings(data.servings);
      if (data.cook_time_minutes && !cookTime) setCookTime(String(data.cook_time_minutes));
      if (data.ingredients.length && !ingredientsText.trim()) {
        setIngredientsText(data.ingredients.join("\n"));
      }
      if (data.steps.length && !stepsText.trim()) setStepsText(data.steps.join("\n"));
      setRawMetadata(data.raw ?? null);

      setNotice(
        data.warning ??
          (data.ingredients.length
            ? `材料${data.ingredients.length}件まで取り込みました。内容を確認してください。`
            : "取り込みました。内容を確認してください。"),
      );
    } catch (err) {
      // 取得失敗は正常系。手入力に進めることを伝える。
      setNotice(
        err instanceof Error
          ? `${err.message} 手で入力すれば保存できます。`
          : "取得できませんでした。手で入力すれば保存できます。",
      );
    } finally {
      setExtracting(false);
    }
  };

  // ── 画像アップロード ─────────────────────────────────────────────────────
  const uploadImage = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // RLS がパスの先頭セグメント（世帯ID）を見るので、この形を崩さないこと
      const path = `${household.id}/${recipeId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("recipe-images").upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("recipe-images").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像のアップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  // ── 保存 ─────────────────────────────────────────────────────────────────
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();

      const payload = {
        id: recipeId,
        household_id: household.id,
        title: title.trim(),
        source_type: sourceType,
        source_url: sourceUrl.trim() || null,
        source_site_name: siteName.trim() || null,
        source_author: author.trim() || null,
        image_url: imageUrl.trim() || null,
        description: description.trim() || null,
        servings: servings.trim() || null,
        cook_time_minutes: cookTime ? Number(cookTime) : null,
        memo: memo.trim() || null,
        is_favorite: isFavorite,
        created_by: initial?.recipe.created_by ?? user.id,
        raw_metadata: rawMetadata,
      };

      if (initial) {
        const { error } = await supabase.from("recipes").update(payload).eq("id", recipeId);
        if (error) throw error;
        // 子テーブルは作り直す方が差分計算より確実
        await Promise.all([
          supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId),
          supabase.from("recipe_steps").delete().eq("recipe_id", recipeId),
          supabase.from("recipe_tags").delete().eq("recipe_id", recipeId),
        ]);
      } else {
        const { error } = await supabase.from("recipes").insert(payload);
        if (error) throw error;
      }

      const ingredientRows = parseIngredientsText(ingredientsText, recipeId);
      if (ingredientRows.length) {
        const { error } = await supabase.from("recipe_ingredients").insert(ingredientRows);
        if (error) throw error;
      }

      const stepRows = stepsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((body, i) => ({ recipe_id: recipeId, step_no: i + 1, body }));
      if (stepRows.length) {
        const { error } = await supabase.from("recipe_steps").insert(stepRows);
        if (error) throw error;
      }

      // 新規タグを作ってから紐付ける
      const tagIds = [...selectedTagIds];
      const newName = newTagName.trim();
      if (newName) {
        const { data, error } = await supabase
          .from("tags")
          .insert({ household_id: household.id, name: newName })
          .select("id")
          .single();
        if (error && error.code !== "23505") throw error;
        if (data) tagIds.push((data as { id: string }).id);
      }
      if (tagIds.length) {
        const { error } = await supabase
          .from("recipe_tags")
          .insert(tagIds.map((tag_id) => ({ recipe_id: recipeId, tag_id })));
        if (error) throw error;
      }

      router.push(`/recipes/${recipeId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setSaving(false);
    }
  };

  const parsedPreview = parseIngredientsText(ingredientsText, recipeId);
  const mergeableCount = parsedPreview.filter((r) => r.quantity != null).length;

  return (
    <form onSubmit={save} className="space-y-6 px-4 py-4">
      {/* URL取り込み */}
      <section className="rounded-lg border border-border bg-card p-4">
        <Label htmlFor="source-url">URLから取り込む</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="source-url"
              type="url"
              inputMode="url"
              placeholder="https://cookpad.com/recipe/..."
              className="pl-9"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </div>
          <Button onClick={extract} disabled={extracting || !sourceUrl.trim()}>
            {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            取り込む
          </Button>
        </div>
        <FieldHint>
          クックパッド・YouTube・X などに対応。取得できなくても、下の欄を手で埋めれば保存できます。
        </FieldHint>
        {notice ? (
          <p className="mt-2 rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
            {notice}
          </p>
        ) : null}
      </section>

      {/* 基本情報 */}
      <section className="space-y-4">
        <div>
          <Label htmlFor="title">
            タイトル <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            required
            placeholder="鶏の照り焼き"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <Label>写真</Label>
          <div className="flex items-start gap-3">
            <div className="relative size-24 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <ImagePlus className="size-7" />
                </div>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <Input
                type="url"
                placeholder="画像URL"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                  端末から選ぶ
                </Button>
                {imageUrl ? (
                  <Button variant="ghost" size="sm" onClick={() => setImageUrl("")}>
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadImage(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="servings">分量</Label>
            <Input
              id="servings"
              placeholder="2人分"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cook-time">調理時間（分）</Label>
            <Input
              id="cook-time"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="30"
              value={cookTime}
              onChange={(e) => setCookTime(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="source-type">種別</Label>
          <Select
            id="source-type"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SourceType)}
          >
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </section>

      {/* 材料 */}
      <section>
        <Label htmlFor="ingredients">材料</Label>
        <Textarea
          id="ingredients"
          rows={8}
          placeholder={"玉ねぎ 1/2個\n醤油 大さじ2\n塩 少々\n\n# タレ\nみりん 大さじ1"}
          value={ingredientsText}
          onChange={(e) => setIngredientsText(e.target.value)}
          className="font-mono text-sm"
        />
        <FieldHint>
          1行に1つ書いてください。「# タレ」のように # で始めるとグループの見出しになります。
          入力そのままが常に表示され、買い物リストの合算にだけ解析結果を使います。
        </FieldHint>
        {parsedPreview.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {parsedPreview.length}件中 {mergeableCount}件は分量を読み取れました（買い物リストで合算されます）。
          </p>
        ) : null}
      </section>

      {/* 手順 */}
      <section>
        <Label htmlFor="steps">作り方</Label>
        <Textarea
          id="steps"
          rows={6}
          placeholder={"鶏肉を一口大に切る\nフライパンで両面を焼く\nタレを絡めて完成"}
          value={stepsText}
          onChange={(e) => setStepsText(e.target.value)}
        />
        <FieldHint>1行が1ステップになります。</FieldHint>
      </section>

      {/* タグ・メモ */}
      <section className="space-y-4">
        <div>
          <Label>タグ</Label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const active = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() =>
                    setSelectedTagIds((ids) =>
                      active ? ids.filter((i) => i !== tag.id) : [...ids, tag.id],
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
          <Input
            className="mt-2"
            placeholder="新しいタグを追加（例: 時短）"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="memo">家族用メモ</Label>
          <Textarea
            id="memo"
            rows={3}
            placeholder="息子が好き / 塩は半分で"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => setIsFavorite((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Star className={cn("size-5", isFavorite ? "fill-primary text-primary" : "text-muted-foreground")} />
          お気に入りにする
        </button>
      </section>

      {error ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : null}

      <div className="sticky bottom-20 flex gap-2 bg-background/80 py-2 backdrop-blur">
        <Button type="submit" size="lg" className="flex-1" disabled={saving}>
          {saving ? <Loader2 className="size-5 animate-spin" /> : null}
          {initial ? "変更を保存" : "レシピを保存"}
        </Button>
        <Button variant="outline" size="lg" onClick={() => router.back()}>
          キャンセル
        </Button>
      </div>

      {siteName || author ? (
        <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {siteName ? <Badge tone="outline">{siteName}</Badge> : null}
          {author ? <Badge tone="outline">{author}</Badge> : null}
        </p>
      ) : null}
    </form>
  );
}

/** テキストエリアの内容を recipe_ingredients の行に変換する */
function parseIngredientsText(text: string, recipeId: string) {
  const rows: {
    recipe_id: string;
    group_name: string | null;
    raw_text: string;
    name: string | null;
    quantity: number | null;
    unit: string | null;
    sort_order: number;
  }[] = [];
  let group: string | null = null;
  let order = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      group = trimmed.replace(/^#+\s*/, "") || null;
      continue;
    }
    const parsed = parseIngredientLine(trimmed);
    rows.push({
      recipe_id: recipeId,
      group_name: group,
      raw_text: trimmed,
      name: parsed.name,
      quantity: parsed.quantity,
      unit: parsed.unit,
      sort_order: order++,
    });
  }
  return rows;
}

function ingredientsToText(ingredients: RecipeIngredient[]): string {
  const lines: string[] = [];
  let currentGroup: string | null = null;
  for (const ing of [...ingredients].sort((a, b) => a.sort_order - b.sort_order)) {
    if (ing.group_name !== currentGroup) {
      currentGroup = ing.group_name;
      if (currentGroup) lines.push(`# ${currentGroup}`);
    }
    lines.push(ing.raw_text);
  }
  return lines.join("\n");
}
