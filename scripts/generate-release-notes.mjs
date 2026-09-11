import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const releases = JSON.parse(await readFile(new URL('src/updates/releases.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const seen = new Set();
for (const release of releases) {
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || seen.has(release.version)) throw Error(`版本号无效或重复：${release.version}`);
  seen.add(release.version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release.recordedAt) || !release.summary || !release.items?.length || release.items.some(item => !item.title || !item.description)) throw Error(`更新说明不完整：${release.version}`);
}
if (!seen.has(manifest.version)) throw Error(`请先在 releases.json 添加当前版本 ${manifest.version} 的更新说明`);
const text = '# 版本更新记录\n\n由 src/updates/releases.json 自动生成，请修改配置后运行 pnpm notes:generate。记录日期来自版本说明所在的 Git 提交或本次编写日期，表示说明的记录时间。历史提交与独立发布验证文档保留原始依据。\n\n' + releases.map(release => {
  const source = release.sourceCommit ? `\n\n来源提交：\`${release.sourceCommit}\`` : '';
  return `## V${release.version}\n\n记录日期：${release.recordedAt}${source}\n\n${release.summary}\n\n` + release.items.map(item => `- **${item.title}**：${item.description}`).join('\n') + (release.notice ? `\n\n升级提示：${release.notice}` : '');
}).join('\n\n') + '\n';
const path = new URL('docs/version/更新记录.md', root);
if (process.argv.includes('--check')) {
  const existing = await readFile(path, 'utf8').catch(() => '');
  if (existing !== text) throw Error('更新记录与配置不一致，请运行 pnpm notes:generate');
} else await writeFile(path, text);
console.log(`更新说明已校验：${releases.length} 个版本，当前 V${manifest.version}`);
