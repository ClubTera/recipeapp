import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

export const metadata: Metadata = {
  title: "家族のレシピ",
  description: "レシピを貯めて、家族で献立を相談し、買い物リストまで一本でつなぐアプリ",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "家族のレシピ",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f0834a",
  width: "device-width",
  initialScale: 1,
  // 入力欄タップ時の意図しないズームを防ぐ（フォントは16px以上にしてある）
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
