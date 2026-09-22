#!/usr/bin/env bash
# install.sh — dsh-pulse 部署（Linux / macOS / VPS）
# 与 install.ps1 等价：三处解析位 + profile 注册；幂等，自动备份，逐字节回读，JSON 非法自动回滚。
#
# 用法：
#   ./install.sh                                   # 用 $DSH_HOME（未设则 ~/.dsh），profile = web
#   ./install.sh --dsh-home /opt/dsh --profiles web,gen4-lab
#   ./install.sh --plan                            # 只打印计划，不动盘
#   ./install.sh --remove                          # 卸载
#
# 只动 --dsh-home 指定的目录；不会碰别的路径。

set -euo pipefail

ID='dsh-pulse'
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILES='web'
MODE='install'

while [ $# -gt 0 ]; do
  case "$1" in
    --dsh-home) DSH_HOME="$2"; shift 2 ;;
    --profiles) PROFILES="$2"; shift 2 ;;
    --plan)     MODE='plan'; shift ;;
    --remove|--uninstall) MODE='remove'; shift ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "[FAIL] 未知参数: $1"; exit 2 ;;
  esac
done

IFS=',' read -r -a PROFILE_LIST <<< "$PROFILES"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '%s\n' "$*"; }
ok()   { printf '[OK] %s\n' "$*"; }
info() { printf '[i] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*"; exit 1; }

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum   >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else cksum "$1" | awk '{print $1"-"$2}'
  fi
}

# JSON 合法性闸门：优先 node，其次 python3，都没有就退化成括号配对检查。
json_gate() {
  local pj="$1"
  if command -v node >/dev/null 2>&1; then
    node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const b=(j.dsh&&j.dsh.profile&&j.dsh.profile.bundles)||[];const d=j.dependencies||{};console.log("OK bundles="+b.length+" dep="+(d[process.argv[2]]||"MISSING"))' "$pj" "$ID"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));b=(d.get("dsh",{}).get("profile",{}) or {}).get("bundles",[]);dep=(d.get("dependencies",{}) or {}).get(sys.argv[2],"MISSING");print("OK bundles=%d dep=%s"%(len(b),dep))' "$pj" "$ID"
  else
    local open close
    open=$(tr -cd '{' < "$pj" | wc -c)
    close=$(tr -cd '}' < "$pj" | wc -c)
    [ "$open" = "$close" ] || return 1
    grep -q "\"$ID\"" "$pj" || return 1
    echo "OK (crude brace check; 建议装 node 或 python3 做真校验)"
  fi
}

[ -d "$DSH_HOME" ] || fail "DshHome 不存在: $DSH_HOME"

info "DSH home : $DSH_HOME"
info "源       : $SRC"
info "解析位   : <home>/node_modules/$ID · <home>/plugins/$ID · <home>/profiles/<p>/node_modules/$ID"
info "profile  : ${PROFILE_LIST[*]}"

TARGETS=("$DSH_HOME/node_modules/$ID" "$DSH_HOME/plugins/$ID")
for p in "${PROFILE_LIST[@]}"; do TARGETS+=("$DSH_HOME/profiles/$p/node_modules/$ID"); done

# ---------- 卸载 ----------
if [ "$MODE" = 'remove' ]; then
  for t in "${TARGETS[@]}"; do
    if [ -d "$t" ]; then rm -rf "$t"; ok "已移除 $t"; else info "不存在（跳过）$t"; fi
  done
  for p in "${PROFILE_LIST[@]}"; do
    pj="$DSH_HOME/profiles/$p/package.json"
    [ -f "$pj" ] || { warn "无 $pj"; continue; }
    if grep -q "\"$ID\"" "$pj"; then
      cp "$pj" "$pj.bak-$STAMP"
      # 只摘除本插件的依赖项与 bundles 条目，不动别的字段。
      node -e '
        const fs=require("fs"),p=process.argv[1],id=process.argv[2];
        const j=JSON.parse(fs.readFileSync(p,"utf8"));
        if(j.dependencies) delete j.dependencies[id];
        const b=j.dsh&&j.dsh.profile&&j.dsh.profile.bundles;
        if(Array.isArray(b)) j.dsh.profile.bundles=b.filter(x=>x!==id);
        fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");
      ' "$pj" "$ID" 2>/dev/null || {
        # 无 node：退化成文本替换（与 install.ps1 同款）
        sed -i.tmp -e "s/,\s*\"$ID\"//g" -e "s/\"$ID\"\s*:\s*\"[^\"]*\",\{0,1\}//g" "$pj"
        rm -f "$pj.tmp"
      }
      ok "$p package.json 已摘除（备份保留：$pj.bak-$STAMP）"
    else
      info "$p package.json 未含本插件"
    fi
  done
  say ''
  say '[完成] 下一步：cd <home>/profiles/<profile> && pnpm install，然后重启该 profile。'
  exit 0
fi

# ---------- 计划 ----------
if [ "$MODE" = 'plan' ]; then
  for t in "${TARGETS[@]}"; do say "[PLAN] copy $SRC -> $t"; done
  for p in "${PROFILE_LIST[@]}"; do say "[PLAN] patch $DSH_HOME/profiles/$p/package.json"; done
  say '[PLAN] 去掉 --plan 即执行。'
  exit 0
fi

# ---------- 安装 ----------
SRC_FILES=(index.js client.js cordis.patch.yml package.json)
for f in "${SRC_FILES[@]}"; do
  [ -f "$SRC/$f" ] || fail "源缺文件: $f"
done

for t in "${TARGETS[@]}"; do
  parent="$(dirname "$t")"
  [ -d "$parent" ] || mkdir -p "$parent"
  if [ -d "$t" ]; then
    cp -a "$t" "$t.bak-$STAMP"
    info "旧副本已备份: $t.bak-$STAMP"
    rm -rf "$t"
  fi
  mkdir -p "$t"
  for f in "${SRC_FILES[@]}"; do cp "$SRC/$f" "$t/$f"; done
  ok "已部署 $t"
done

# 逐字节回读
bad=0
for t in "${TARGETS[@]}"; do
  for f in "${SRC_FILES[@]}"; do
    a="$(sha "$SRC/$f")"; b="$(sha "$t/$f")"
    if [ "$a" = "$b" ]; then printf '  %-8s %s/%s\n' MATCH "$t" "$f"
    else printf '  %-8s %s/%s\n' MISMATCH "$t" "$f"; bad=$((bad+1)); fi
  done
done
[ "$bad" -eq 0 ] || fail "回读不符 $bad 处 —— 请重跑或回滚 .bak-$STAMP"
ok '三处解析位逐字节一致'

# profile 注册
for p in "${PROFILE_LIST[@]}"; do
  pj="$DSH_HOME/profiles/$p/package.json"
  [ -f "$pj" ] || { warn "无 $pj —— 跳过注册"; continue; }
  if grep -q "\"$ID\"" "$pj"; then info "$p 已含 $ID（幂等跳过）"; continue; fi
  cp "$pj" "$pj.bak-$STAMP"
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs=require("fs"),p=process.argv[1],id=process.argv[2];
      const j=JSON.parse(fs.readFileSync(p,"utf8"));
      j.dependencies=j.dependencies||{};
      j.dependencies[id]="file:../../plugins/"+id;
      j.dsh=j.dsh||{}; j.dsh.profile=j.dsh.profile||{};
      const b=j.dsh.profile.bundles=j.dsh.profile.bundles||[];
      if(!b.includes(id)) b.push(id);
      fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");
    ' "$pj" "$ID"
  else
    # 无 node：与 install.ps1 同款的文本补丁
    sed -i.tmp -e "s#\(\"dependencies\"[[:space:]]*:[[:space:]]*{\)#\1\n    \"$ID\": \"file:../../plugins/$ID\",#" "$pj"
    sed -i.tmp -e "s#\(\"bundles\"[[:space:]]*:[[:space:]]*\[\)\([^]]*\)#\1\2,\"$ID\"#" "$pj"
    rm -f "$pj.tmp"
  fi
  if ! chk="$(json_gate "$pj")"; then
    cp "$pj.bak-$STAMP" "$pj"
    fail "$p package.json 补丁后 JSON 非法（已回滚）"
  fi
  ok "$p package.json 已注册（备份保留）：$chk"
done

say ''
say '[完成] 下一步：'
say "  1) cd \"$DSH_HOME/profiles/<profile>\" && pnpm install"
say '  2) 重启该 profile（宿主 / keeper / 桌面端），浏览器刷新后应在输入框下方的统计 pill 旁看到「缓存命中 xx.xx%  42.7 tok/s」'
say "  卸载：$SRC/install.sh --dsh-home \"$DSH_HOME\" --profiles ${PROFILES} --remove"
