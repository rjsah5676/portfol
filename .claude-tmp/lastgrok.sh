# copy newest Grok download (5-letter .jpg/.png) to gen/$1
f=$(ls -t ~/mnt/Downloads/ | grep -E '^[A-Za-z0-9]{5}( \([0-9]+\))?\.(jpg|png|webp)$' | head -1)
cp ~/mnt/Downloads/"$f" ~/mnt/portfolio2/.claude-tmp/gen/"$1" && echo "$f -> $1"
