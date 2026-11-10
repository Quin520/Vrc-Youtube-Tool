/** Normalize the common links shared by other users, without following arbitrary hosts. */
export function normalizeYoutubeUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP/HTTPS 视频链接');
  const host = url.hostname.toLowerCase();
  if (url.username || url.password || url.port || host === 'localhost.youtube.com') {
    throw new Error('无效的 YouTube 链接');
  }
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || null;
  else if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'www.youtube-nocookie.com') {
    id = url.searchParams.get('v');
    if (!id && /^\/(shorts|live|embed|v)\//.test(url.pathname)) id = url.pathname.split('/')[2] || null;
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('需要 YouTube 单个视频链接（支持 youtu.be、Shorts、live 和 embed）');
  return `https://www.youtube.com/watch?v=${id}`;
}
