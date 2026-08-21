#!/usr/bin/env bash
BASE="${1:-https://www.tryselfmade.ai}"
curl -s -XPOST "$BASE/api/scan/run" -H 'content-type: application/json' \
  -d '{"pageId":"709019802867739"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('briefs:',Array.isArray(j.briefs)?j.briefs.length:'MISSING','rivalToRemake:',j.rivalToRemake?'yes':'null')})"
