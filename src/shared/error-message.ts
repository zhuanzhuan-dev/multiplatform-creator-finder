/** Translate user-facing failures; stored errors remain unchanged for diagnostics. */
export function errorMessage(value: unknown): string {
  const raw = (value instanceof Error ? value.message : String(value ?? '')).trim();
  if (!raw) return '';
  const codes = [...new Set(raw.match(/\bHTTP\s*\d{3}\b|\b(?:ERR_[A-Z_]+|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/gi) || [])];
  const suffix = codes.length ? `（错误码：${codes.join('、')}）` : '';
  const rules: [RegExp, string][] = [
    [/连续重试后仍无法读取.*TA 的作品侧栏|达人作品列表加载失败/, '达人作品列表加载失败。请检查网络连接；如正在使用代理，可尝试关闭或切换线路，刷新页面后重试。'],
    [/failed to fetch|networkerror|network request failed|net::|load failed/i, '网络连接失败，请检查网络；如使用代理，可尝试关闭或切换线路后重试。'],
    [/timeout|timed out|aborterror|operation was aborted/i, '请求超时或已中断，请检查网络和页面加载情况后重试。'],
    [/quota.*exceed|kQuotaBytes/i, '本地存储空间不足，请导出重要数据并清理空间后重试。'],
    [/receiving end does not exist|could not establish connection|message port closed|extension context invalidated/i, '插件与页面的连接已失效，请刷新页面后重试；若刚更新插件，请先重新加载插件。'],
    [/unauthorized|invalid.token|token.expired|HTTP\s*401/i, '研究台授权已失效，请重新登录并连接。'],
    [/HTTP\s*402|payment.required/i, '服务请求受限，请联系管理员检查服务额度或计费状态。'],
    [/HTTP\s*403|forbidden|permission denied/i, '访问被拒绝，请检查账号权限或联系管理员。'],
    [/HTTP\s*429|too many requests/i, '请求过于频繁，请稍后重试。'],
    [/HTTP\s*5\d\d/i, '服务暂时不可用，请稍后重试。'],
    [/retry_exhausted/i, '已达到自动重试上限，请检查失败原因后重新处理。'],
    [/missing acknowledgement/i, '服务端尚未确认接收该条数据，将按队列策略重试。'],
    [/no tab with id|tab.*closed/i, '目标标签页已关闭，请重新打开采集页面后重试。'],
    [/cannot access|cannot attach|another debugger/i, '无法控制当前页面，请检查页面权限并关闭其他调试工具后重试。'],
  ];
  for (const [pattern, message] of rules) if (pattern.test(raw)) return message + suffix;
  // Keep existing Chinese copy and technical codes; never expose an untranslated browser/server sentence.
  const prose = raw.replace(/\bHTTP\s*\d{3}\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b(?:TA|DOM|JSON|VPN|MB|GB|KB|ID|AI|Vlog)\b/g, '');
  if (/[A-Za-z]{2,}/.test(prose)) {
    const chinesePrefix = raw.match(/^[\u3400-\u9fff\s，。；：、]+[：]/)?.[0] || '';
    return `${chinesePrefix}操作失败，请稍后重试；若持续失败，请联系管理员查看原始诊断记录。${suffix}`;
  }
  return raw;
}
