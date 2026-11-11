import { randomUUID } from 'node:crypto';
import { Elysia, t } from 'elysia';
import { getResource, jobPlaybackUrl, resolveVideoLink, retryVideoJob } from './resolveService.ts';
import { relayResource } from './relay.ts';
import { cacheStatus, cancelLosslessJob, clearUnusedCache, getLosslessJob } from './lossless.ts';
import { safeError } from './process.ts';
import config, { streamModes } from './config.ts';
import { dashboard } from './dashboard.ts';
import { version } from '../package.json';

const videoResponse = async ({ params, request }: { params: { id: string; name: string }; request: Request }) => {
  const resource = getResource(params.id);
  if (!resource) return new Response('链接已过期，请重新解析视频', { status: 404 });
  try { return await relayResource(resource, request); }
  catch (error) {
    const cancelled = resource.kind === 'file' && ['cancelled', 'cancelling', 'evicted'].includes(resource.job.state);
    return new Response(safeError(error), { status: request.signal.aborted ? 499 : cancelled ? 410 : 502 });
  }
};

export function createServer(options: { onShutdown?: () => void } = {}) {
  const controlToken = randomUUID();
  const authorize = ({ request }: { request: Request }) => {
    if (request.headers.get('X-Control-Token') !== controlToken) return Response.json({ error: '请从本机任务面板操作' }, { status: 403 });
  };
  return new Elysia()
    .onRequest(({ request }) => {
      const host = new URL(request.url).hostname;
      if (!['127.0.0.1', 'localhost', 'localhost.youtube.com'].includes(host)) return new Response('Invalid host', { status: 403 });
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) return new Response('Cross-origin request denied', { status: 403 });
    })
    .get('/', () => new Response(dashboard, { headers: { 'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } }))
    .get('/status', () => Response.json({ version, mode: config.streamMode, controlToken,
      jobs: cacheStatus().map(job => ({ ...job, playbackUrl: jobPlaybackUrl(job.id) })),
    }, { headers: { 'Cache-Control': 'no-store' } }))
    .post('/fetch-link', ({ body }) => resolveVideoLink(body.url, { mode: body.mode }), {
      body: t.Object({ url: t.String({ maxLength: 2048 }), mode: t.Optional(t.Union(streamModes.map(mode => t.Literal(mode)))) }),
    })
    .post('/jobs/:id/cancel', ({ params }) => {
      if (!getLosslessJob(params.id)) return Response.json({ error: '任务不存在' }, { status: 404 });
      if (!cancelLosslessJob(params.id)) return Response.json({ error: '任务已结束或正在取消' }, { status: 409 });
      return Response.json({ ok: true }, { status: 202 });
    }, { beforeHandle: authorize })
    .post('/jobs/:id/retry', async ({ params }) => {
      if (!getLosslessJob(params.id)) return Response.json({ error: '任务不存在' }, { status: 404 });
      try { return await retryVideoJob(params.id); }
      catch (error) { return Response.json({ error: safeError(error) }, { status: 409 }); }
    }, { beforeHandle: authorize })
    .post('/cache/clear', async () => {
      try { return await clearUnusedCache(); }
      catch (error) { return Response.json({ error: safeError(error) }, { status: 500 }); }
    }, { beforeHandle: authorize })
    .post('/control/shutdown', () => {
      if (!options.onShutdown) return Response.json({ error: '此实例不支持远程退出' }, { status: 409 });
      setTimeout(options.onShutdown, 100);
      return { ok: true };
    }, { beforeHandle: authorize })
    .get('/video/:id/:name', videoResponse)
    .head('/video/:id/:name', videoResponse);
}

export default createServer();
