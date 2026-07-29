"use client";

import { createContext, useContext } from "react";
import type { Household, Profile } from "@/lib/types";

type SessionValue = {
  user: Profile;
  household: Household;
  members: Profile[];
  role: "owner" | "member";
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: SessionValue;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** クライアントコンポーネントから現在のユーザー・世帯を取る */
export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession は SessionProvider の内側でのみ使えます");
  return ctx;
}

/** メンバーIDから表示名を引く小さなヘルパー */
export function useMemberName() {
  const { members } = useSession();
  return (userId: string | null | undefined) =>
    members.find((m) => m.id === userId)?.display_name ?? "家族";
}
