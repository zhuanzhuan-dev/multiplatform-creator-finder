#!/bin/zsh

set -u
ROOT_DIR="${0:A:h}"
cd "$ROOT_DIR"

if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "需要 Node.js 22，当前版本：$(node --version)"
  read
  exit 1
fi

pnpm install --frozen-lockfile
pnpm build

cat <<'EOF'
本版本已改为上传研究台（No Swipe / Supabase），不再安装本机飞书 Bridge。

请按「同事安装说明.md」操作：
1. Chrome 加载 dist 文件夹作为未打包扩展
2. 打开侧栏，点击「连接研究台」
3. 在 https://fai.zhuanspirit.com/creators 登录并确认配对

EOF

echo "按回车关闭窗口。"
read
exit 0
