import html from './index.html';
export default {
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== '/extension-privacy' && path !== '/extension-privacy/') return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};
