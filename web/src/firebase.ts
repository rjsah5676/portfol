// firebase.js
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// Firebase는 로그인(Auth)에만 씀. 데이터(랭킹·방명록·글·게임 방)는 백엔드 서버가 맡음 → lib/api
const firebaseConfig = {
  apiKey: "AIzaSyC-833NLKJyKbNAuIj07ZqO9lt2GYHD5UM",
  authDomain: "gunmo-portfolio.firebaseapp.com",
  projectId: "gunmo-portfolio",
  storageBucket: "gunmo-portfolio.appspot.com",
  messagingSenderId: "608990934237",
  appId: "1:608990934237:web:70f8076ec788e718a11734",
  measurementId: "G-E2V0469JW7",
};

// 개발 모드 HMR로 이 파일이 다시 실행돼도 이미 만든 앱을 재사용 (app/duplicate-app 방지)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

export default app;
