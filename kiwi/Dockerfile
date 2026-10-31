# 니들이 한글을 알아? 판정기 (kiwi/app.py). 빌드 기준 폴더는 레포 루트:
#   docker build -f kiwi/Dockerfile -t portfolio-kiwi .
# (추가 사전 server/src/hangul/slang.json 을 Node 서버와 같이 씀)
FROM mirror.gcr.io/library/python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY kiwi/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY kiwi/app.py ./
COPY server/src/hangul/slang.json ./slang.json
USER nobody
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]
CMD ["python", "app.py"]
