import { Elysia, t } from 'elysia';
import { getResource, resolveVideoLink } from './resolveService.ts';
import { relayResource } from './relay.ts';
import { cacheStatus } from './lossless.ts';
import { safeError } from './process.ts';

const videoResponse = async ({ params, request }: { params: { id: string; name: string }; request: Request }) => {
  const resource = getResource(params.id);
  if (!resource) return new Response('链接已过期，请重新解析视频', { status: 404 });
  try { return await relayResource(resource, request); }
  catch (error) { return new Response(safeError(error), { status: 502 }); }
};

export default new Elysia()
  .onRequest(({ request }) => {
    const host = new URL(request.url).hostname;
    if (!['127.0.0.1', 'localhost', 'localhost.youtube.com'].includes(host)) return new Response('Invalid host', { status: 403 });
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return new Response('Cross-origin request denied', { status: 403 });
  })
  .get('/', 'VRChat YouTube relay')
  .get('/status', () => ({ jobs: cacheStatus() }))
  .post('/fetch-link', ({ body }) => resolveVideoLink(body.url), {
    body: t.Object({ url: t.String({ maxLength: 2048 }) }),
  })
  .get('/video/:id/:name', videoResponse)
  .head('/video/:id/:name', videoResponse);
