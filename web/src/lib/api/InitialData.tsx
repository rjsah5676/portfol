"use client";

import { createContext, useContext, type ReactNode } from "react";

// 서버(layout)에서 미리 읽은 데이터를 "use client" 페이지에 건네주는 통로.
// layout 에서 <InitialData value={{ 이름: 데이터 }}> 로 감싸고, 페이지에서 useInitial("이름") 으로 꺼냄.
const Ctx = createContext<Record<string, unknown>>({});

export function InitialData({
  value,
  children,
}: {
  value: Record<string, unknown>;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 서버가 미리 읽어둔 값 (없으면 undefined → 평소처럼 브라우저에서 읽음) */
export function useInitial<T>(name: string): T | undefined {
  return useContext(Ctx)[name] as T | undefined;
}
