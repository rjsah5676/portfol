/*
 * 화면 확인용 가짜 firebase/auth (POKER_E2E=1 로 next 를 띄우면 next.config 가 이 파일로 바꿔 끼움).
 * 주소의 ?fake=<uid>:<별명> 으로 "로그인"하고, 토큰은 server/scripts/dev-fake.ts 의 /__dev/token 에서 받음.
 * 운영 빌드에는 절대 들어가지 않음.
 */
type Listener = (u: FakeUser | null) => void;
interface FakeUser {
  uid: string;
  isAnonymous: boolean;
  email: string;
  displayName: string;
  getIdToken(force?: boolean): Promise<string>;
}

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const KEY = "fake_login";
let user: FakeUser | null = null;
let token = "";
const listeners = new Set<Listener>();
let ready: Promise<void> = Promise.resolve();

function readWanted(): { uid: string; nick: string } | null {
  if (typeof window === "undefined") return null;
  const q = new URL(location.href).searchParams.get("fake");
  if (q) {
    sessionStorage.setItem(KEY, q);
    return parse(q);
  }
  const saved = sessionStorage.getItem(KEY);
  return saved ? parse(saved) : null;
}
const parse = (s: string) => {
  const [uid, nick = ""] = s.split(":");
  return { uid, nick };
};

async function login(uid: string, nick: string) {
  const r = await fetch(`${API}/__dev/token?uid=${encodeURIComponent(uid)}&nick=${encodeURIComponent(nick)}`);
  const d = (await r.json()) as { token: string };
  token = d.token;
  user = { uid, isAnonymous: false, email: `${uid}@example.com`, displayName: nick || uid, getIdToken: async () => token };
  for (const l of listeners) l(user);
}

if (typeof window !== "undefined") {
  const w = readWanted();
  if (w) ready = login(w.uid, w.nick).catch(() => {});
}

export const auth = {
  get currentUser() {
    return user;
  },
  authStateReady: () => ready,
};
export type User = FakeUser;
export function onIdTokenChanged(_a: unknown, cb: Listener) {
  listeners.add(cb);
  void ready.then(() => cb(user));
  return () => listeners.delete(cb);
}
export const onAuthStateChanged = onIdTokenChanged;
export class GoogleAuthProvider {
  setCustomParameters() {}
  static credentialFromError() {
    return null;
  }
}
export async function signInWithPopup() {
  const w = readWanted() ?? { uid: "dev-a", nick: "" };
  await login(w.uid, w.nick);
  return { user };
}
export const linkWithPopup = signInWithPopup;
export const signInWithCredential = signInWithPopup;
export async function signInAnonymously() {
  await login(`anon-${Math.random().toString(36).slice(2, 8)}`, "");
  return { user };
}
export async function signInWithEmailAndPassword() {
  return signInWithPopup();
}
export async function signOut() {
  user = null;
  token = "";
  sessionStorage.removeItem(KEY);
  for (const l of listeners) l(null);
}
export function getAuth() {
  return auth;
}
