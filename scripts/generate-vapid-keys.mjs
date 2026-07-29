/**
 * VAPID 鍵ペアを生成する（依存ライブラリなし）。
 *   npm run gen:vapid
 *
 * 一度だけ生成して保管すること。鍵を変えると既存の購読が全部無効になる（設計書 7.7）。
 */
import { generateKeyPairSync, createPublicKey } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

// 公開鍵は非圧縮形式（0x04 + X + Y の65バイト）を base64url で渡す
const publicDer = createPublicKey(publicKey).export({ type: "spki", format: "der" });
const publicRaw = publicDer.subarray(publicDer.length - 65);

const privateJwk = privateKey.export({ format: "jwk" });

const toBase64Url = (buf) => buf.toString("base64url");

console.log("");
console.log("VAPID 鍵ペアを生成しました。以下を控えてください（再生成しないこと）。");
console.log("");
console.log("── .env.local（Next.js / 公開してよい） ──");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${toBase64Url(publicRaw)}`);
console.log("");
console.log("── Supabase Edge Function Secrets（絶対に公開しない） ──");
console.log(`supabase secrets set \\`);
console.log(`  VAPID_PUBLIC_KEY=${toBase64Url(publicRaw)} \\`);
console.log(`  VAPID_PRIVATE_KEY=${privateJwk.d} \\`);
console.log(`  VAPID_SUBJECT=mailto:you@example.com`);
console.log("");
