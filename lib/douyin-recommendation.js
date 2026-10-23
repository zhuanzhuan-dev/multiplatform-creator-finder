/** The active player, not the URL or author, tells us which list is playing. */
export function recommendationState(doc, parser) {
  const card = parser.visibleFeedItem(doc);
  const player = card?.querySelector('[data-e2e="feed-active-video"]')
    || card?.querySelector('#slideMode, #sliderVideo');
  return { card, mode: player?.id === 'slideMode' ? 'author'
    : player?.id === 'sliderVideo' ? 'recommendation' : 'unknown',
  videoId: player?.getAttribute('data-e2e-vid') || '' };
}

export function recommendationAdvanced(before, after, beforeFingerprint, afterFingerprint) {
  return after.mode === 'recommendation' && Boolean(afterFingerprint)
    && beforeFingerprint !== afterFingerprint
    && (before.card !== after.card || Boolean(before.videoId && after.videoId && before.videoId !== after.videoId));
}
