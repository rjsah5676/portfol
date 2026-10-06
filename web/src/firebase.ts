// firebase.js
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyC-833NLKJyKbNAuIj07ZqO9lt2GYHD5UM",
  authDomain: "gunmo-portfolio.firebaseapp.com",
  projectId: "gunmo-portfolio",
  storageBucket: "gunmo-portfolio.appspot.com",
  messagingSenderId: "608990934237",
  appId: "1:608990934237:web:70f8076ec788e718a11734",
  measurementId: "G-E2V0469JW7",
};

const DATABASE_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://gunmo-portfolio-default-rtdb.firebaseio.com";

// 개발 모드 HMR로 이 파일이 다시 실행돼도 이미 만든 앱을 재사용 (app/duplicate-app 방지)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

// Realtime Database (스케치 퀴즈 실시간 그림·채팅) — 쓰는 페이지에서만 연결되도록 지연 생성.
// 콘솔에서 만든 DB 위치가 미국(us-central1)이 아니면 NEXT_PUBLIC_FIREBASE_DATABASE_URL에 그 주소를 넣으면 됨
let rtdbInstance: Database | null = null;
export const rtdb = () => (rtdbInstance ??= getDatabase(app, DATABASE_URL));

export default app;
