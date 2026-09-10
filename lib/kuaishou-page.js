import { parseCompactNumber } from './normalizers.js';

export const KUAISHOU_ACTIVE = '.swiper-feed .swiper-slide-active';
const text = (root, selector) => root.querySelector(selector)?.textContent?.trim() || '';
export function kuaishouVideoId(src) {
  try { return new URL(src).searchParams.get('clientCacheKey')?.split('_')[0] || ''; } catch { return ''; }
}
export function readKuaishouVideo(doc = document) {
  const cards = doc.querySelectorAll(KUAISHOU_ACTIVE);
  if (cards.length !== 1) throw Error('未识别到唯一的快手当前视频，请回到推荐页');
  const card = cards[0], video = card.querySelector('video');
  const profileUrl = card.querySelector('a.name[href*="/profile/"]')?.href || '';
  const authorId = new URL(profileUrl || 'https://www.kuaishou.com').pathname.match(/^\/profile\/([\w-]+)$/)?.[1];
  const videoId = kuaishouVideoId(video?.currentSrc || video?.src || '');
  if (!authorId || !videoId || !video) throw Error('快手视频或作者身份尚未加载');
  const displayDuration = text(card,'.current-and-duration').split('/').at(-1)?.trim().split(':').map(Number);
  const durationSeconds = Number.isFinite(video.duration) ? video.duration : displayDuration?.reduce((n,v)=>n*60+v,0);
  const likes = parseCompactNumber(text(card,'.like-btn > span'));
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(likes)) throw Error('快手时长或点赞尚未加载');
  return {sourcePlatform:'kuaishou',contentType:'video',videoId,authorId,profileUrl,
    authorName:text(card,'a.name').replace(/^@/,''),caption:text(card,'.caption'),
    hashtags:[...card.querySelectorAll('.caption a.tag')].map(node=>node.textContent.trim().replace(/^#/,'')),
    durationSeconds,likes,comments:parseCompactNumber(text(card,'.comment > span')),favorites:parseCompactNumber(text(card,'.star > span')),
    avatarUrl:card.querySelector('.Avatar img')?.src || '',coverUrl:card.querySelector('img.background')?.src || '',coverSource:'kuaishou-recommend',
    publishedTimeText:text(card,'.timestamp'),beforeUrl:doc.location?.href || 'https://www.kuaishou.com/new-reco',observedAt:new Date().toISOString()};
}
export function readKuaishouProfile(doc = document) {
  const root=doc.querySelector('.profile-top');
  if(!root) throw Error('快手作者主页尚未加载');
  const followersText=[...root.querySelectorAll('.count > span')].find(node=>node.textContent.includes('粉丝'))?.querySelector('span')?.textContent;
  const followers=parseCompactNumber(followersText);
  if(!Number.isFinite(followers))throw Error('快手作者粉丝数未读取');
  const recentVideos=[...doc.querySelectorAll('.photo-card')].slice(0,20).map(card=>({text:card.querySelector('img')?.alt || '',likes:parseCompactNumber(text(card,'.like'))}));
  const knownLikes=recentVideos.map(video=>video.likes).filter(Number.isFinite);
  return {profileUrl:doc.location?.href || '',authorName:text(root,'h1 .name'),followers,
    kuaishouId:text(root,'.uid').replace(/^快手号[：:]\s*/,''),bio:text(root,'.text-count .text'),
    avatarUrl:root.querySelector('.Avatar img')?.src || '',recentVideos,worksListComplete:false,
    averageLikes:knownLikes.length===recentVideos.length && knownLikes.length ? knownLikes.reduce((a,b)=>a+b,0)/knownLikes.length : undefined};
}
export function kuaishouBlocked(doc=document) {
  // Only inspect visible dialogs, never captions containing verification words.
  return [...doc.querySelectorAll('[role="dialog"], .captcha, #captcha_container')].some(node=>
    node.getBoundingClientRect().width>0 && /验证|登录|访问频繁|异常/.test(node.textContent || ''));
}
