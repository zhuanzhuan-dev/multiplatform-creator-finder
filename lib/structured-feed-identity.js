// Reads only active card ancestors; never searches sibling/preloaded feed items.
export function structuredFeedIdentity(card) {
  const unknown = (reason) => ({ contentType: 'unknown', isLive: false, subtype: 'unknown', typeEvidence: [reason] });
  if (!card) return unknown('current card missing');
  const idNode = card.getAttribute?.('data-e2e-vid') ? card : card.querySelector?.('[data-e2e-vid], [data-e2e-aweme-id]');
  const domId = String(idNode?.getAttribute('data-e2e-vid') || idNode?.getAttribute('data-e2e-aweme-id') || String(card.className || '').match(/video_(\d+)/)?.[1] || '');
  let item = null;
  for (const node of [card, ...card.querySelectorAll('[data-e2e]')].slice(0, 100)) {
    const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    let fiber = key && Object.getOwnPropertyDescriptor(node, key)?.value;
    for (let depth = 0; fiber && depth < 16; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (!props?.item) continue;
      // The nearest item boundary owns this DOM node, even when inactive.
      if (props.isActive === true) item = props.item;
      break;
    }
    if (item) break;
  }
  if (!item) return unknown('active structured item unavailable');
  const id = typeof item.awemeId === 'string' ? item.awemeId : '';
  if (!id || (domId && domId !== id)) return { ...unknown('current card identity mismatch'), contentId: id || 'invalid' };
  const awemeType = item.awemeType;
  const mediaType = item.mediaType;
  const liveMarker = [card, ...card.querySelectorAll('[data-e2e="feed-live"]')].some(node => {
    if (node.getAttribute('data-e2e') !== 'feed-live' || node.closest('[hidden], [aria-hidden="true"], [data-e2e="video-desc"], [data-e2e="feed-video-nickname"], [data-e2e="feed-video-avatar"]')) return false;
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (typeof innerHeight === 'undefined' || (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth));
  });
  let room = item.cellRoom?.rawdata;
  if (typeof room === 'string') { try { room = JSON.parse(room); } catch { room = null; } }
  let contentType = 'unknown';
  if (domId === id && [0, 4].includes(awemeType) && mediaType === 4 && !liveMarker) contentType = 'video';
  if (awemeType === 101 && mediaType == null && room?.id_str === id && liveMarker) contentType = 'live';
  return {
    contentType, isLive: contentType === 'live', subtype: contentType === 'unknown' ? 'unknown' : `feed-${contentType}`,
    typeEvidence: [`active item: awemeType=${awemeType}, mediaType=${mediaType ?? 'missing'}`, contentType === 'unknown' ? 'unverified or conflicting content fields' : 'current card identity verified'],
    contentId: id, awemeType: awemeType ?? null, mediaType: mediaType ?? null,
  };
}
