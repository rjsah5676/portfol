import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Config } from "./config";

export interface AuthUser {
  uid: string;
  email: string | null;
  /** 익명 로그인(게임용)인지 */
  anonymous: boolean;
  admin: boolean;
}

export interface Auth {
  /** Firebase ID 토큰 검증. 유효하지 않으면 throw */
  verify(token: string): Promise<AuthUser>;
}

/**
 * Firebase Auth가 발급한 ID 토큰(JWT)을 서버에서 검증.
 * 서비스 계정 키 없이 공개키(JWKS)만으로 서명·발급자·대상 프로젝트를 확인함.
 */
export function createAuth(
  cfg: Pick<Config, "firebaseProjectId" | "authJwksUrl" | "adminEmails">,
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(cfg.authJwksUrl))
): Auth {
  const admins = new Set(cfg.adminEmails.map((e) => e.toLowerCase()));
  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, keys, {
        issuer: `https://securetoken.google.com/${cfg.firebaseProjectId}`,
        audience: cfg.firebaseProjectId,
        algorithms: ["RS256"],
      });
      const uid = typeof payload.sub === "string" ? payload.sub : "";
      if (!uid || uid.length > 128) throw new Error("invalid sub");
      const email = typeof payload.email === "string" ? payload.email : null;
      const provider = (payload.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
      return {
        uid,
        email,
        anonymous: provider === "anonymous",
        // 기존 Firestore 규칙(isAdmin)과 같은 기준: 토큰의 이메일이 관리자 이메일인지
        admin: !!email && admins.has(email.toLowerCase()),
      };
    },
  };
}
