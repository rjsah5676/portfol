#!/bin/bash
# 리듬게임 채보 연구 도구를 원래 쓰던 경로로 펼침 (스크립트 안 경로가 고정이라 그대로 맞춤)
#   /home/claude/p2           ← 이 레포 (web/ 에서 npm ci 끝난 상태)
#   /home/claude/osz2         ← osu 비교 스크립트 + 채보 데이터 (+ audio/osu_audio/<set id>.mp3 는 따로 받아야 함)
#   /home/claude/ref          ← 곡 하나 정밀 대조 스크립트
#   /tmp/claude-0/s           ← 내장곡 재생성·꼬리 자르기 도구
#   /tmp/claude-0/ours_gen_stars.ts ← 생성 채보 별점 계산 (cmp_sub.py 가 씀)
# 사용: bash research/rhythm/setup.sh   (레포 루트에서)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
[ "$REPO" = /home/claude/p2 ] || ln -sfn "$REPO" /home/claude/p2
mkdir -p /home/claude/osz2/audio/osu_audio /home/claude/ref /tmp/claude-0/s
cp "$HERE"/osu/* /home/claude/osz2/
cp "$HERE"/ref/* /home/claude/ref/
cp "$HERE"/tools/{regen.sh,cmds2.txt,trim.mjs,clicktest.mjs,probe.mjs} /tmp/claude-0/s/
cp "$HERE"/tools/stars.ts /tmp/claude-0/ours_gen_stars.ts
gunzip -c "$HERE"/data/osu-mania-4k-charts.json.gz > /home/claude/osz2/charts_new.json
n=$(ls /home/claude/osz2/audio/osu_audio 2>/dev/null | wc -l)
echo "펼침 완료. osu 음원 $n/107개 (없으면 data/osu-beatmapset-ids.txt 의 세트를 받아 audio/osu_audio/<id>.mp3 로)"
