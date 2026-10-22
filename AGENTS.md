# 多平台自动找号助手

本目录是独立 Git 仓库，远端为 `zhuanzhuan-dev/multiplatform-creator-finder`。以下约定只适用于本仓库，不适用于外层的达人推荐工作台仓库。

## Linear 项目

- 本插件的需求、缺陷和优化记录到 FAI 团队的 [No Swipe](https://linear.app/fxxkai/project/no-swipe-30cdc81c8a31) 项目，项目 UUID：`ee272242-fd9a-4d1b-9669-48b7f7cb010f`（编号 `P-FAI-4`）。
- 跨插件与工作台的任务分别记录到各自项目，并关联 Issue。开始执行标记 `In Progress`；范围完成、检查通过且产生 Git commit 后标记 `Done`，发布与线上验收分别记录。

## Git 工作方式

- 本项目由我们自行开发，日常改动直接在 `main` 完成。开始修改前确认 Git 根目录属于本仓库，并同步 `origin/main`。
- 需要提交时直接提交到本仓库的 `main`；用户要求推送且未指定目标时，推送 `origin/main`。
- 用户没有明确要求时，不创建或重命名功能分支、worktree，也不创建 PR。用户指定其他目标时按明确要求执行。
- 清理历史分支或 worktree 前，先核对未提交改动和未进入 `main` 的提交；保留尚未合入的工作。
