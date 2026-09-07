const sensitive = /cookie|token|secret|password|authorization|credential|session[_-]?key/i;
export function sanitizeRaw(value, depth = 0, seen = new WeakSet(), budget = { left: 3000 }) {
  if (--budget.left < 0 || depth > 8) return '[truncated]';
  if (typeof value === 'string') {
    if (/^(?:data|blob):/i.test(value)) return '[media omitted]';
    return value.slice(0, 16000).replace(/([?&](?:[^=&]*(?:token|signature|secret|credential|authorization)[^=&]*|msToken|a_bogus)=)[^&#\s"<>]*/gi, '$1[redacted]');
  }
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([, d]) => 'value' in d).slice(0, 150);
  const result = Array.isArray(value) ? [] : {};
  for (const [key, descriptor] of entries) {
    if (key === 'length' || ['__proto__','constructor','prototype'].includes(key)) continue;
    result[key] = sensitive.test(key) ? '[redacted]' : sanitizeRaw(descriptor.value, depth + 1, seen, budget);
  }
  return result;
}

export function rawCardSnapshot(element, observation) {
  if (!element) throw Error('当前推荐卡片尚未加载');
  const clone = element.cloneNode(true);
  clone.querySelectorAll('script, style, iframe, input, textarea, select, [contenteditable], #dra-floating-launcher').forEach(n => n.remove());
  const attributes = [];
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || sensitive.test(attr.name) || attr.name === 'value') node.removeAttribute(attr.name);
      else node.setAttribute(attr.name, String(sanitizeRaw(attr.value)));
    }
    if (attributes.length < 300 && [...node.attributes].some(a => /type|data-e2e|data-aweme|data-id/.test(a.name))) {
      attributes.push({ tag: node.tagName.toLowerCase(), attributes: Object.fromEntries([...node.attributes].filter(a => /type|data-e2e|data-aweme|data-id/.test(a.name)).map(a=>[a.name,a.value])) });
    }
  }
  const html = clone.outerHTML;
  return { capturedAt: new Date().toISOString(), parsed: sanitizeRaw(observation), dom: html.slice(0,250000), domTruncated:html.length>250000,
    attributes, evidence: { parser: 'visible DOM markers, media elements and dedicated controls', inferredType:observation?.contentType, inferredAd:observation?.isAd, signals:observation?.typeEvidence || [] } };
}

// Read bounded data associated with this card, not window globals or a React application tree.
export function pageCardData(card, expectedId = '') {
  if (!card) return { candidates: [], reason:'no active card' };
  const queue = [], visited = new WeakSet(), candidates = [];
  for (const node of [card, ...card.querySelectorAll('*')].slice(0,100)) {
    for (const key of Object.keys(node).filter(k => /^__reactProps\$|^__reactFiber\$/.test(k))) {
      const value = Object.getOwnPropertyDescriptor(node,key)?.value;
      if (key.startsWith('__reactFiber')) queue.push({value:value?.memoizedProps,path:'card.react.memoizedProps',depth:0});
      else queue.push({value,path:'card.react.props',depth:0});
    }
  }
  let processed = 0;
  while (queue.length && ++processed <= 600 && candidates.length < 5) {
    const {value,path,depth} = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value) || depth > 6) continue;
    visited.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const id = descriptors.aweme_id?.value ?? descriptors.awemeId?.value;
    if (id != null && (!expectedId || String(id) === expectedId)) {
      candidates.push({ path, matchedId:String(id), data:sanitizeRaw(value) });continue;
    }
    for (const [key,descriptor] of Object.entries(descriptors).slice(0,100)) {
      if (!('value' in descriptor) || sensitive.test(key) || ['children','return','sibling','_owner','stateNode'].includes(key)) continue;
      queue.push({value:descriptor.value,path:`${path}.${key}`,depth:depth+1});
    }
  }
  return { candidates, reason:candidates.length ? 'card-associated data; verify type fields against labelled examples' : 'no matching structured data found; DOM sample only' };
}
