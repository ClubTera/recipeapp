import type { ExtractedMetadata, SourceType } from "./types";

/**
 * URL からのメタ情報取得。
 *
 * 大原則（設計書 2.1 / 6.2）:
 *   取得は「失敗する前提」で作る。何が起きても例外を投げず、
 *   分かった分だけ埋めた ExtractedMetadata を返す。
 *   結果はあくまでフォームの初期値であり、ユーザーが必ず編集できる。
 */

export const FETCH_TIMEOUT_MS = 5000;

const UA =
  "Mozilla/5.0 (compatible; FamilyRecipeBot/1.0; +https://example.com/bot) AppleWebKit/537.36";

export function detectSourceType(url: string): SourceType {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "web";
  }
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "twitter.com" || host === "x.com") return "x";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  return "web";
}

function emptyResult(url: string, warning: string | null = null): ExtractedMetadata {
  return {
    source_type: detectSourceType(url),
    source_url: url,
    title: null,
    description: null,
    image_url: null,
    site_name: null,
    author: null,
    servings: null,
    cook_time_minutes: null,
    ingredients: [],
    steps: [],
    warning,
    raw: null,
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ja,en;q=0.8",
        ...(init?.headers ?? {}),
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** レスポンスの charset を見て文字化けしないようにデコードする（EUC-JP のレシピサイトが実在する） */
async function decodeBody(res: Response): Promise<string> {
  const buffer = await res.arrayBuffer();
  const headerCharset = /charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];

  // 先頭だけ latin1 で読んで meta charset を探す
  const head = new TextDecoder("latin1").decode(buffer.slice(0, 4096));
  const metaCharset =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];

  const charset = (headerCharset ?? metaCharset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

// ── OGP / meta ────────────────────────────────────────────────────────────────

function metaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1]).trim() || null;
  }
  return null;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex: string, code: string) => {
      const n = parseInt(code, hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// ── JSON-LD (schema.org/Recipe) ───────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

function collectJsonLd(html: string): JsonRecord[] {
  const results: JsonRecord[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      pushNodes(parsed, results);
    } catch {
      // 壊れた JSON-LD は珍しくない。黙って捨てて OGP にフォールバックする。
    }
  }
  return results;
}

function pushNodes(value: unknown, out: JsonRecord[]) {
  if (Array.isArray(value)) {
    value.forEach((v) => pushNodes(v, out));
  } else if (value && typeof value === "object") {
    const node = value as JsonRecord;
    out.push(node);
    if (node["@graph"]) pushNodes(node["@graph"], out);
  }
}

function isRecipeNode(node: JsonRecord): boolean {
  const type = node["@type"];
  if (typeof type === "string") return type.toLowerCase() === "recipe";
  if (Array.isArray(type)) return type.some((t) => String(t).toLowerCase() === "recipe");
  return false;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return stripTags(value) || null;
  if (Array.isArray(value)) return asString(value[0]);
  if (value && typeof value === "object") {
    const obj = value as JsonRecord;
    return asString(obj.name ?? obj.text ?? obj.url ?? null);
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => asString(v)).filter((v): v is string => Boolean(v));
}

/** ISO 8601 duration ("PT1H30M") を分に直す */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, d, h, min] = m;
  const total = (Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(min ?? 0);
  return total > 0 ? total : null;
}

function extractFromRecipeNode(node: JsonRecord, base: ExtractedMetadata): ExtractedMetadata {
  const image = node.image;
  const imageUrl =
    typeof image === "string"
      ? image
      : Array.isArray(image)
        ? asString(image[0])
        : image && typeof image === "object"
          ? asString((image as JsonRecord).url)
          : null;

  return {
    ...base,
    title: asString(node.name) ?? base.title,
    description: asString(node.description) ?? base.description,
    image_url: imageUrl ?? base.image_url,
    author: asString(node.author) ?? base.author,
    servings: asString(node.recipeYield) ?? base.servings,
    cook_time_minutes:
      parseIsoDuration(node.totalTime) ??
      parseIsoDuration(node.cookTime) ??
      parseIsoDuration(node.prepTime) ??
      base.cook_time_minutes,
    ingredients: asStringArray(node.recipeIngredient),
    steps: asStringArray(node.recipeInstructions),
    raw: node,
  };
}

// ── oEmbed ────────────────────────────────────────────────────────────────────

const OEMBED_ENDPOINTS: Partial<Record<SourceType, (url: string) => string>> = {
  youtube: (url) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  x: (url) => `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`,
};

async function extractViaOEmbed(url: string, type: SourceType): Promise<ExtractedMetadata | null> {
  const endpoint = OEMBED_ENDPOINTS[type]?.(url);
  if (!endpoint) return null;

  try {
    const res = await fetchWithTimeout(endpoint, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as JsonRecord;

    const html = typeof data.html === "string" ? data.html : "";
    // X は本文が html 内にしか無いので、タグを剥がして説明文に使う
    const bodyText = type === "x" ? stripTags(html) : null;

    return {
      ...emptyResult(url),
      title:
        asString(data.title) ??
        (bodyText ? bodyText.slice(0, 60) : null) ??
        null,
      description: bodyText,
      image_url: asString(data.thumbnail_url),
      site_name: asString(data.provider_name),
      author: asString(data.author_name),
      raw: data,
    };
  } catch {
    return null;
  }
}

// ── 本体 ──────────────────────────────────────────────────────────────────────

export async function extractMetadata(url: string): Promise<ExtractedMetadata> {
  const sourceType = detectSourceType(url);

  // Instagram はログイン必須で安定して取れない。URLだけ保存して手入力にフォールバックする。
  if (sourceType === "instagram") {
    return {
      ...emptyResult(url),
      site_name: "Instagram",
      warning:
        "Instagram はログインが必要なため、自動取得できません。タイトルと画像を手で入力してください。",
    };
  }

  if (OEMBED_ENDPOINTS[sourceType]) {
    const viaOEmbed = await extractViaOEmbed(url, sourceType);
    if (viaOEmbed?.title) return viaOEmbed;
    // oEmbed が落ちた場合も OGP を試す（YouTube は OGP も持っている）
  }

  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "text/html,*/*" } });
    if (!res.ok) {
      return emptyResult(url, `ページを取得できませんでした（HTTP ${res.status}）`);
    }
    const html = await decodeBody(res);

    let result: ExtractedMetadata = {
      ...emptyResult(url),
      title: metaContent(html, "og:title") ?? titleTag(html),
      description: metaContent(html, "og:description") ?? metaContent(html, "description"),
      image_url: absoluteUrl(metaContent(html, "og:image"), url),
      site_name: metaContent(html, "og:site_name"),
      author: metaContent(html, "author") ?? metaContent(html, "article:author"),
    };

    // JSON-LD があれば材料・手順まで取れるので優先する
    const recipeNode = collectJsonLd(html).find(isRecipeNode);
    if (recipeNode) {
      result = extractFromRecipeNode(recipeNode, result);
      result.image_url = absoluteUrl(result.image_url, url);
    }

    if (!result.title) {
      result.warning = "タイトルを取得できませんでした。手で入力してください。";
    }
    return result;
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return emptyResult(
      url,
      aborted
        ? "ページの取得に時間がかかりすぎたため中断しました。手で入力してください。"
        : "ページを取得できませんでした。手で入力してください。",
    );
  }
}

function titleTag(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? stripTags(m[1]) || null : null;
}

function absoluteUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}
