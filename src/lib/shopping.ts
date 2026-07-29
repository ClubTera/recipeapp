import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateIngredients, type AggregatedItem, type AliasMap } from "./ingredients";
import { CATEGORY_ORDER } from "./utils";
import type { RecipeIngredient, ShoppingList } from "./types";

/** 材料名の正規化マスタを読み込む（世帯をまたぐ共通データなので使い回せる） */
export async function fetchAliasMap(supabase: SupabaseClient): Promise<AliasMap> {
  const { data } = await supabase
    .from("ingredient_aliases")
    .select("alias, canonical_name, category");
  const map: AliasMap = new Map();
  for (const row of (data ?? []) as {
    alias: string;
    canonical_name: string;
    category: AggregatedItem["category"];
  }[]) {
    map.set(row.alias, { canonical_name: row.canonical_name, category: row.category });
  }
  return map;
}

/** 進行中の買い物リストを取り、無ければ作る */
export async function getOrCreateActiveList(
  supabase: SupabaseClient,
  householdId: string,
  userId: string,
  name = "買い物リスト",
): Promise<ShoppingList> {
  const { data: existing } = await supabase
    .from("shopping_lists")
    .select("*")
    .eq("household_id", householdId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing as ShoppingList;

  const { data, error } = await supabase
    .from("shopping_lists")
    .insert({ household_id: householdId, name, created_by: userId })
    .select("*")
    .single();
  if (error) throw error;
  return data as ShoppingList;
}

/**
 * 集約済みの品目をリストへ投入する。
 * 既に同じ名前・単位の未チェック品目があれば、行を増やさず数量を足す。
 */
export async function insertItems(
  supabase: SupabaseClient,
  listId: string,
  items: AggregatedItem[],
  userId: string,
) {
  if (items.length === 0) return;

  const { data: existingRows } = await supabase
    .from("shopping_list_items")
    .select("id, name, unit, quantity, is_checked, source_recipe_ids, display_text")
    .eq("list_id", listId);

  const existing = (existingRows ?? []) as {
    id: string;
    name: string;
    unit: string | null;
    quantity: number | null;
    is_checked: boolean;
    source_recipe_ids: string[];
    display_text: string;
  }[];

  const toInsert: Record<string, unknown>[] = [];

  for (const item of items) {
    const hit = existing.find(
      (e) =>
        !e.is_checked &&
        e.name === item.name &&
        (e.unit ?? null) === (item.unit ?? null) &&
        (e.quantity == null) === (item.quantity == null),
    );

    if (hit && item.quantity != null && hit.quantity != null) {
      const quantity = hit.quantity + item.quantity;
      await supabase
        .from("shopping_list_items")
        .update({
          quantity,
          display_text: rebuildDisplayText(item, quantity),
          source_recipe_ids: [...new Set([...hit.source_recipe_ids, ...item.source_recipe_ids])],
        })
        .eq("id", hit.id);
      continue;
    }
    if (hit && item.quantity == null && hit.display_text === item.display_text) {
      continue; // 「塩 少々」が二重に並ぶのを防ぐ
    }

    toInsert.push({
      list_id: listId,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      display_text: item.display_text,
      category: item.category,
      source_recipe_ids: item.source_recipe_ids,
      added_by: userId,
      sort_order: CATEGORY_ORDER.indexOf(item.category),
    });
  }

  if (toInsert.length) {
    const { error } = await supabase.from("shopping_list_items").insert(toInsert);
    if (error) throw error;
  }
}

function rebuildDisplayText(item: AggregatedItem, quantity: number): string {
  const q = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100);
  if (item.unit === "大さじ" || item.unit === "小さじ" || item.unit === "カップ") {
    return `${item.name} ${item.unit}${q}`;
  }
  return `${item.name} ${q}${item.unit ?? ""}`;
}

/** レシピ詳細から材料を個別に追加するときの入口 */
export async function addIngredientsToList(
  supabase: SupabaseClient,
  params: {
    householdId: string;
    userId: string;
    recipeId: string;
    ingredients: RecipeIngredient[];
  },
) {
  const aliases = await fetchAliasMap(supabase);
  const items = aggregateIngredients(
    params.ingredients.map((i) => ({ ...i, recipe_id: params.recipeId })),
    aliases,
  );
  const list = await getOrCreateActiveList(supabase, params.householdId, params.userId);
  await insertItems(supabase, list.id, items, params.userId);
  return { list, count: items.length };
}
