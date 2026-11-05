# 사건 그림 — 표지(GPT) · 캡처류(코드)

그림도 단서다. 표지는 문제문 옆에 항상 떠 있고, 단서 그림은 15/30/45문에 열린다.

- **표지(cover)**: GPT 이미지로. 문제문의 이상한 점 2~3개를 그림에도 심고, **보너스 항목 소품**을 구석에 숨긴다. 글자는 꼭 필요한 것만(프롬프트에 명시), 진상을 말하는 요소는 금지.
- **캡처류 단서**(단톡방 · 통장 · 서류 · 문자): `cases/art/<id>/cN.html` → Edge 헤드리스로 PNG. 글자가 정확해야 해서 GPT 안 씀.
  ```powershell
  & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=390,844 --screenshot="..\web\public\mystery\<id>\c1.png" "file:///...\cases\art\<id>\c1.html"
  ```
- **현장 삽화 단서**(깨진 창문 · 상자): GPT, 표지와 같은 그림체 블록.
- 결과물은 `web/public/mystery/<id>/` (cover.png · c1.png …). 사건 JSON 의 `cover` · `clues[].image` 에 `/mystery/<id>/…` 로.
- 그림에 넣은 세부(이름 · 금액 · 날짜)는 **facts 에도 넣는다** — 플레이어가 그림 보고 물어볼 테니.

## 그림체 블록 (표지 · 삽화 프롬프트 맨 앞에 그대로)
```
Art style for a Korean mystery case-file game: ink illustration with bold, slightly rough black line work and cross-hatching for shadows, almost monochrome — desaturated paper tone (#EDE6D6) with grey-brown washes — plus ONE accent color only (specified per image) used sparingly on one or two objects. Subtle film grain and a faint vignette. Realistic proportions, modern Korean everyday setting, no anime faces, no chibi. Looks like an illustration printed inside a detective's case file. No text, letters, numbers, logos or signatures unless the prompt lists them explicitly.
```

## attendance 「출근했습니다」 — 표지 `cover.png` (가로 3:2)
```
[그림체 블록] Accent color: the yellow of a messenger app (#FEE500).
Scene: a small Korean company's office at night, seen from slightly above and in front of the boss's desk. A man in his 50s in a wrinkled shirt (the company president) sits at the desk, one hand pressing a smartphone to the desk, the other hand covering his mouth; he is sweating, eyes fixed on the phone. On the phone screen, a group-chat app in the accent yellow with three identical short chat bubbles stacked — the bubbles are blank (no readable text). Behind him, a monthly wall calendar with only ONE day (the 25th) circled in red. On a shelf in the corner, half hidden behind binders, a construction hard hat with a long crack across it, dusty. Fluorescent light, blinds half drawn, dark window. Composition: desk and president in the center-right, the hard hat small but clearly visible on the left shelf. No text anywhere except the blank bubbles.
```
- 이상한 점: 월급 주는 사람이 왜 식은땀을 흘리나 / 달력 25일 / 왜 사무실에 금 간 안전모
- 보너스 소품: 금 간 안전모 → "사고의 모습"(추락 · 현장). 달력 → "급여로 꾸민 이유"(매달 25일 급여일)
- 여러 장 뽑아서 고르는 기준: 안전모가 보이되 눈에 확 띄진 않는 것, 폰 화면에 글자가 안 생긴 것
