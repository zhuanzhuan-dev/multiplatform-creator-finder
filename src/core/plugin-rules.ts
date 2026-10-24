/** Contract v1. Mirrored verbatim in multi/src/core/plugin-rules.ts. */
export type Rules = Record<string, any>
export type RuleOperation = { op: 'set' | 'add' | 'remove'; key: string; value: unknown }
export type RuleField = { key: string; label: string; type: 'number' | 'boolean' | 'text' | 'terms' | 'categories' | 'rows' | 'scoreRows'; min?: number; max?: number; nullable?: boolean; allowEmptyKeywords?: boolean; path: (string | number)[]; value: unknown }
export const RULE_PLATFORMS = ['douyin', 'kuaishou', 'bilibili', 'bilibili-popular', 'feigua', 'xingtu'] as const
export function ruleFields(platform: string, rules: Rules): RuleField[] {
  const fields: RuleField[] = []
  const add = (key: string, label: string, type: RuleField['type'], opts: Partial<RuleField> = {}, path: (string | number)[] = key.split('.')) => {
    const value = path.reduce<any>((v, p) => v?.[p], rules)
    if (value !== undefined) fields.push({ key, label, type, path, value, ...opts })
  }
  if (platform === 'xingtu') { add('xingtuKeywords', '星图排除词', 'terms'); return fields }
  if (platform === 'feigua') { add('feiguaKeywords', '飞瓜排除词', 'terms'); add('feiguaPositiveKeywords', '飞瓜正向词', 'terms'); return fields }
  add('hard.minFollowers', '最低粉丝', 'number', { min: 0, nullable: true })
  add('hard.maxFollowers', '最高粉丝', 'number', { min: 0, nullable: true })
  add('hard.minVideoDurationSeconds', '最短视频（秒）', 'number', { min: 1 })
  add('hard.minVideoLikes', '最低点赞', 'number', { min: 0 })
  add('gameBlacklist', '排除词', 'terms')
  if (platform === 'douyin' || platform === 'kuaishou') add('contentOnlyExclusionTerms', '原排除词中仅按作品匹配的词', 'terms')
  add('contentBlacklist', '内容排除词', 'terms')
  add('excludeTnames', '排除分区', 'terms')
  add('excludeOgv', '排除影视节目', 'boolean')
  add('includeDigital', '包含数码类', 'boolean')
  add('positiveCategories', '正向类目', 'categories', {allowEmptyKeywords:platform.startsWith('bilibili')})
  for (const [index, category] of (rules.positiveCategories || []).entries()) {
    if (!/^[\w-]+$/.test(category.id)) continue
    for (const [key, label, type] of [['keywords', '关键词', 'terms'], ['partitions', '分区', 'terms'], ['name', '名称', 'text'], ['enabled', '启用', 'boolean'], ['score', '加分/优先级', 'number']] as const) {
      add(`positiveCategories.${category.id}.${key}`, `${category.name || category.id}·${label}`, type, type === 'number' ? { min: 0, max: 100 } : {}, ['positiveCategories', index, key])
    }
  }
  for (const key of ['enabled', 'requireCompleteWorksList']) add(`lowFollowerNewAccount.${key}`, `低粉新号·${key === 'enabled' ? '启用例外' : '作品完整'}`, 'boolean')
  add('lowFollowerNewAccount.maxVideos', '低粉新号最多作品', 'number', { min: 1 })
  add('lowFollowerNewAccount.minAverageLikes', '低粉新号最低均赞', 'number', { min: 0 })
  for (const key of ['likes','followers']) add(`scoring.${key}`, key === 'likes' ? '均赞加分档位' : '粉丝加分档位', 'scoreRows')
  for (const level of ['S','A']) {
    for (const key of ['enabled','requireCategory']) add(`scoring.levels.${level}.${key}`, `${level}级·${key === 'enabled' ? '启用' : '要求命中类目'}`, 'boolean')
    for (const key of ['minFollowers','maxFollowers','minAverageLikes']) add(`scoring.levels.${level}.${key}`, `${level}级·${({minFollowers:'最低粉丝',maxFollowers:'最高粉丝',minAverageLikes:'最低均赞'} as Record<string,string>)[key]}`, 'number', {min:0,nullable:key==='maxFollowers'})
  }
  // Complex lists retain their existing schema; each row is strictly checked below.
  for (const key of ['playRules.reject', 'playRules.prefer']) add(key, key.endsWith('reject') ? '播放淘汰条件' : '播放优选条件', 'rows')
  return fields
}
function terms(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 300 && value.every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 120)
}
function validValue(field: RuleField, value: unknown) {
  if (field.type === 'number') return (value === null && field.nullable) || (typeof value === 'number' && Number.isFinite(value) && value >= (field.min ?? 0) && value <= (field.max ?? 1e12))
  if (field.type === 'boolean') return typeof value === 'boolean'
  if (field.type === 'text') return typeof value === 'string' && value.trim().length > 0 && value.length <= 120
  if (field.type === 'terms') return terms(value)
  if (field.type === 'categories') return Array.isArray(value) && value.length > 0 && value.length <= 30 && new Set(value.map(c => c?.id)).size === value.length && value.some(c => c?.enabled !== false) && value.every(c => c && typeof c === 'object' && /^[\w-]{1,60}$/.test(c.id) && typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 120 && terms(c.keywords) && (field.allowEmptyKeywords || c.enabled === false || c.keywords.length > 0) && typeof c.score === 'number' && c.score >= 0 && c.score <= 100 && (c.enabled === undefined || typeof c.enabled === 'boolean') && (c.partitions === undefined || terms(c.partitions)) && Object.keys(c).every(k => ['id','name','keywords','score','enabled','partitions','audience'].includes(k)) && (c.audience === undefined || typeof c.audience === 'string' && c.audience.length <= 200))
  if (field.type === 'scoreRows') return Array.isArray(value) && value.length <= 30 && value.every(row => row && Object.keys(row).every(k=>['min','max','points'].includes(k)) && typeof row.min==='number' && Number.isFinite(row.min) && row.min>=0 && row.min<=1e12 && typeof row.points==='number' && Number.isFinite(row.points) && row.points>=0 && row.points<=100 && (row.max==null || typeof row.max==='number' && Number.isFinite(row.max) && row.max>=row.min && row.max<=1e12))
  return Array.isArray(value) && value.length <= 30 && value.every(row => row && Object.keys(row).sort().join(',') === 'days,daysOp,plays,playsOp' && ['<','<=','>','>='].includes(row.playsOp) && ['<','<=','>','>='].includes(row.daysOp) && ['days','plays'].every(k => row[k] === '' || typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] >= 0 && row[k] <= 1e12))
}
export function applyRuleOperations(platform: string, original: Rules, operations: RuleOperation[]): { rules: Rules; changes: { key: string; label: string; before: unknown; after: unknown }[] } {
  if (!RULE_PLATFORMS.includes(platform as any) || !Array.isArray(operations) || operations.length > 40) throw Error('规则操作不合法')
  const rules = structuredClone(original)
  const changes: { key: string; label: string; before: unknown; after: unknown }[] = []
  for (const operation of operations) {
    const field = ruleFields(platform, rules).find(f => f.key === operation.key)
    if (!field || !['set','add','remove'].includes(operation.op)) throw Error(`不支持的规则字段或操作：${operation.key}`)
    let after = operation.value
    if (operation.op !== 'set') {
      if (field.type !== 'terms' || typeof operation.value !== 'string' || !terms([operation.value])) throw Error('增删操作只适用于关键词列表')
      after = operation.op === 'add' ? [...new Set([...(field.value as string[]), operation.value])] : (field.value as string[]).filter(x => x !== operation.value)
    }
    if (!validValue(field, after)) throw Error(`规则值不合法：${field.label}`)
    const parent = field.path.slice(0, -1).reduce<any>((v, p) => v[p], rules)
    parent[field.path.at(-1)!] = after
    if (JSON.stringify(field.value) !== JSON.stringify(after)) changes.push({ key: field.key, label: field.label, before: field.value, after })
  }
  const min = rules.hard?.minFollowers, max = rules.hard?.maxFollowers
  if ((platform === 'douyin' || platform === 'kuaishou') && Array.isArray(rules.contentOnlyExclusionTerms)) {
    const normalize = (word: string) => word.normalize('NFKC').trim().toLowerCase()
    const excluded = new Set((rules.gameBlacklist || []).map(normalize))
    if (rules.contentOnlyExclusionTerms.some((word: string) => !excluded.has(normalize(word)))) throw Error('仅按作品匹配的词必须同时保留在 gameBlacklist 排除词中。contentOnlyExclusionTerms 只改变匹配范围，不是独立排除词库。')
  }
  if (min != null && max != null && min > max) throw Error('最低粉丝不能大于最高粉丝')
  if (rules.lowFollowerNewAccount?.maxVideos != null && !Number.isInteger(rules.lowFollowerNewAccount.maxVideos)) throw Error('最多作品必须是整数')
  for (const level of Object.values(rules.scoring?.levels || {}) as Rules[]) if (level.maxFollowers != null && level.minFollowers > level.maxFollowers) throw Error('等级粉丝下限不能大于上限')
  if (rules.positiveCategories && !validValue({ type: 'categories', allowEmptyKeywords:platform.startsWith('bilibili') } as RuleField, rules.positiveCategories)) throw Error('请保留启用类目，关键词与格式应符合该平台规则')
  return { rules, changes }
}
export function canonicalRules(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRules).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalRules((value as Rules)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
export async function ruleFingerprint(rules: Rules): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRules(rules)))
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('')
}
