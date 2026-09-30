#!/usr/bin/env bash
# Run on the developer's Mac. Uploads Git HEAD, never the local database or .env.
set -euo pipefail

usage() {
  cat <<'HELP'
用法：bash scripts/deploy.sh [--apply] [--host 用户@服务器] [--port SSH端口] [--identity 私钥路径]

默认服务器：ubuntu@122.200.93.68:22
默认私钥：当前用户桌面的 developer.pem，可用 --identity 指定其他文件。
默认只显示计划，不连接服务器；加 --apply 才真正发布。
发布本地已提交的 Git HEAD，不需要先推送 GitHub。
服务器须已安装本系统，目录 /opt/heatsinkrep；不用于首次安装。
HELP
}

host=ubuntu@122.200.93.68
port=22
identity="$HOME/Desktop/developer.pem"
apply=false
while (($#)); do
  case "$1" in
    --apply) apply=true; shift ;;
    --host|--port|--identity)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --host) host=$2 ;;
        --port) port=$2 ;;
        --identity) identity=$2 ;;
      esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$host" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$ ]] || { echo 'SSH 地址无效' >&2; exit 2; }
if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || ((10#$port < 1 || 10#$port > 65535)); then
  echo 'SSH 端口无效' >&2; exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$script_dir/.." rev-parse --show-toplevel)
revision=$(git -C "$repo" rev-parse HEAD)
tag="$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}"
printf '目标：%s:%s\n目录：/opt/heatsinkrep\n提交：%s\n版本：%s\n' "$host" "$port" "$revision" "$tag"
printf '密钥：%s（仅在本机使用，不上传）\n' "$identity"
echo '顺序：上传已提交源码 → 服务器构建 → 停写备份 → 数据库迁移 → 更新应用 → 健康检查'
echo '保留库存、账号、仓位、旧镜像和备份；不重建 MySQL / RabbitMQ。'
if [[ "$apply" != true ]]; then
  echo '当前仅预览。确认目标与提交后，加 --apply 执行。'
  exit 0
fi
if [[ ! -f "$identity" || ! -r "$identity" ]]; then
  printf '找不到或无法读取私钥：%s\n请将 developer.pem 放在桌面，或用 --identity 指定私钥路径。\n' "$identity" >&2
  exit 2
fi
if ! git -C "$repo" diff --quiet || ! git -C "$repo" diff --cached --quiet; then
  echo '有未提交的修改，请先提交。脚本只发布 Git HEAD。' >&2
  exit 1
fi
if [[ -n "$(git -C "$repo" ls-files --others --exclude-standard)" ]]; then
  echo '有未跟踪文件，请先提交或移出项目，避免漏发。' >&2
  exit 1
fi
for command in ssh scp tar; do command -v "$command" >/dev/null; done

ssh_options=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
ssh_options+=(-i "$identity" -o IdentitiesOnly=yes)
ssh_run() { ssh "${ssh_options[@]}" -p "$port" "$host" "$@"; }
local_tmp=$(mktemp -d "${TMPDIR:-/tmp}/heatsink-deploy.XXXXXXXX")
upload=
cleanup() {
  rm -f -- "$local_tmp/source.tar.gz" "$local_tmp/deploy_server.py"
  rmdir -- "$local_tmp"
}
trap cleanup EXIT
# Only these two paths enter the upload directory; the key remains on this Mac.
git -C "$repo" archive --format=tar.gz HEAD > "$local_tmp/source.tar.gz"
git -C "$repo" show HEAD:scripts/deploy_server.py > "$local_tmp/deploy_server.py"
upload=$(ssh_run 'umask 077; mktemp -d /tmp/heatsink-upload.XXXXXXXX')
[[ "$upload" =~ ^/tmp/heatsink-upload\.[a-zA-Z0-9]+$ ]] || { echo '服务器临时目录无效' >&2; exit 1; }
scp "${ssh_options[@]}" -P "$port" "$local_tmp/source.tar.gz" "$local_tmp/deploy_server.py" "$host:$upload/"
echo '正在服务器发布；如果 SSH 中断，请先查看服务器 result.json 和 deploy.log，不要直接重复发布。'
if ssh_run "sudo -n python3 '$upload/deploy_server.py' --apply --archive '$upload/source.tar.gz' --tag '$tag' --revision '$revision'"; then
  ssh_run "rm -f -- '$upload/source.tar.gz' '$upload/deploy_server.py'; rmdir -- '$upload'" || true
  printf '发布完成。服务器记录：/opt/heatsinkrep/releases/%s/result.json\n' "$tag"
else
  deploy_exit=$?
  printf '发布未确认成功（SSH 退出码 %s）。请检查 /opt/heatsinkrep/releases/%s/，上传文件保留在 %s。\n' "$deploy_exit" "$tag" "$upload" >&2
  exit 1
fi
