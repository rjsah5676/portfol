#!/bin/bash
# usage: regen.sh outdir
cd /home/claude/p2/web; mkdir -p $1
while read -r line; do eval "npm run -s rhythm-chart -- $line" > $1/$(echo $line|cut -d' ' -f1).log 2>&1 || echo FAIL $line; done < /tmp/claude-0/s/cmds2.txt
cp src/data/rhythm/*.json $1/; git checkout -q src/data/rhythm
