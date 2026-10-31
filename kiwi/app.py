"""
니들이 한글을 알아? 판정기 — 형태소 분석기 Kiwi(kiwipiepy, 네이티브)를 따로 띄운 작은 HTTP 서비스.

Node 서버(server/src/hangul/kiwi.ts)가 KIWI_URL 로 부름. 판정 규칙(문장인지 · 점수)은 전부 Node 쪽에 있고, 여기는 분석만.
  POST /analyze {"texts": [...]}  → {"results": [{"score": -21.0, "tokens": [["오늘", "MAG", true], ...]}]}  (세 번째 = 사전에 있는 말인지)
  POST /space   {"texts": [...]}  → {"results": ["띄어 쓴 문장", ...]}
  GET  /health                    → ok

왜 따로: npm 의 wasm 판(kiwi-nlp)은 압축 모델을 못 써서 메모리를 약 680MB 먹음. 네이티브는 약 330MB.
그리고 판정기가 죽어도(메모리 초과 등) 사이트 서버는 같이 안 죽게.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from kiwipiepy import Kiwi

MAX_TEXTS = 4000
MAX_LEN = 80
MAX_BODY = 512 * 1024

SLANG_PATH = os.environ.get("KIWI_SLANG", os.path.join(os.path.dirname(os.path.abspath(__file__)), "slang.json"))

kiwi = Kiwi(num_workers=0, model_type="cong", load_typo_dict=False, load_multi_dict=False)
with open(SLANG_PATH, encoding="utf-8") as f:
    for word, tag in json.load(f):
        kiwi.add_user_word(word, tag)
lock = threading.Lock()


def analyze(texts):
    with lock:
        out = []
        for t in texts:
            tokens, score = kiwi.analyze(t)[0][:2]
            out.append({"score": score, "tokens": [[k.form, k.tag, not k.oov] for k in tokens]})
        return out


def space(texts):
    with lock:
        return [kiwi.space(t, reset_whitespace=False) for t in texts]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        fn = {"/analyze": analyze, "/space": space}.get(self.path)
        if not fn:
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(400, {"error": "bad body"})
        try:
            texts = json.loads(self.rfile.read(n))["texts"]
            ok = isinstance(texts, list) and len(texts) <= MAX_TEXTS and all(
                isinstance(t, str) and 0 < len(t) <= MAX_LEN for t in texts
            )
        except (ValueError, KeyError, TypeError):
            ok = False
        if not ok:
            return self._send(400, {"error": "bad texts"})
        self._send(200, {"results": fn(texts)})

    def log_message(self, *args):  # 요청마다 찍지 않음
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"[kiwi] 판정기 준비 :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
