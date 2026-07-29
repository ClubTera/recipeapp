// アプリ全体で使うドメイン型。
// Supabase の型は `supabase gen types typescript` で生成したものに差し替えられるが、
// ここでは手書きの型を「クエリ結果のキャスト先」として使う。

export type SourceType = "web" | "youtube" | "tiktok" | "x" | "instagram" | "original";
export type MealSlot = "breakfast" | "lunch" | "dinner";
export type EntryStatus = "candidate" | "confirmed" | "archived";
export type VoteValue = "want" | "pass";
export type ShoppingCategory = "vegetable" | "meat_fish" | "dairy" | "seasoning" | "other";
export type NotificationType =
  | "meal_candidate_added"
  | "meal_vote"
  | "meal_comment"
  | "meal_confirmed"
  | "plan_reminder"
  | "shopping_list_created"
  | "shopping_done"
  | "member_joined";

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type HouseholdMember = {
  household_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  profiles?: Profile | null;
};

export type Recipe = {
  id: string;
  household_id: string;
  title: string;
  source_type: SourceType;
  source_url: string | null;
  source_site_name: string | null;
  source_author: string | null;
  image_url: string | null;
  description: string | null;
  servings: string | null;
  cook_time_minutes: number | null;
  memo: string | null;
  is_favorite: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  raw_metadata: Record<string, unknown> | null;
};

export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  group_name: string | null;
  raw_text: string;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  sort_order: number;
};

export type RecipeStep = {
  id: string;
  recipe_id: string;
  step_no: number;
  body: string;
  image_url: string | null;
};

export type Tag = {
  id: string;
  household_id: string;
  name: string;
  color: string;
};

export type CookingLog = {
  id: string;
  recipe_id: string;
  cooked_on: string;
  cooked_by: string;
  rating: number | null;
  note: string | null;
};

export type MealPlan = {
  id: string;
  household_id: string;
  week_start_date: string;
  created_at: string;
};

export type MealPlanEntry = {
  id: string;
  meal_plan_id: string;
  date: string;
  meal_slot: MealSlot;
  recipe_id: string | null;
  free_text: string | null;
  status: EntryStatus;
  added_by: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MealVote = {
  entry_id: string;
  user_id: string;
  value: VoteValue;
  created_at: string;
};

export type MealComment = {
  id: string;
  entry_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type ShoppingList = {
  id: string;
  household_id: string;
  name: string;
  source_meal_plan_id: string | null;
  status: "active" | "done";
  created_by: string;
  created_at: string;
};

export type ShoppingListItem = {
  id: string;
  list_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  display_text: string;
  category: ShoppingCategory;
  is_checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
  source_recipe_ids: string[];
  added_by: string;
  sort_order: number;
  created_at: string;
};

export type AppNotification = {
  id: string;
  household_id: string;
  recipient_id: string;
  actor_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link_path: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  push_status: "pending" | "buffered" | "sent" | "skipped" | "failed";
  push_sent_at: string | null;
  created_at: string;
};

export type NotificationPreferences = {
  user_id: string;
  enabled_types: NotificationType[];
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  last_success_at: string | null;
  failure_count: number;
  created_at: string;
};

/** URLから取得したメタ情報。すべて「フォームの初期値」であり、確定値ではない。 */
export type ExtractedMetadata = {
  source_type: SourceType;
  source_url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  author: string | null;
  servings: string | null;
  cook_time_minutes: number | null;
  ingredients: string[];
  steps: string[];
  /** 取得に失敗した場合も 200 を返し、この理由を添える */
  warning: string | null;
  raw: Record<string, unknown> | null;
};
