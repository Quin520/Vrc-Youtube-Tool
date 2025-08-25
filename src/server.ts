import { Elysia, t } from "elysia";
import { $ } from "bun";
import config, { getYtdlpArgs } from "./config.ts";
import { createLogg } from "@guiiai/logg";
import { getProxyUrl, getSavedUrlByIndex, resolveVideoLink, streamHls } from "./resolveService.ts";

const log = createLogg('HTTP 服务').useGlobalConfig()

export default new Elysia()
  .get('/', 'Hello')
  .post('/fetch-link', async ({ body }) => {
    log.withFields(body).log("收到视频解析请求")
    return await resolveVideoLink(body.url)
  }, {
    body: t.Object({
      url: t.String(),
    }),
    response: t.Object({
      text: t.Optional(t.String()),
      code: t.Number(),
    })
  })
  .get('/video/:id', async ({ params, request, set }) => {
    if (!getSavedUrlByIndex(params.id)) return
    if (config.streamMode === 'hls-mux') {
      set.headers["content-type"] = 'video/mp4';
      return streamHls(params.id);
    }
    const url = getSavedUrlByIndex(params.id)!
    if (url.endsWith('.m3u8')) {
      const req = await fetch(url, {
        proxy: `http://${config.proxy}`,
        verbose: config.debugFetch,
      });
      const text = await req.text();
      const newText = text.split('\n').map(line => {
        if (line && !line.startsWith('#')) {
          if (line.startsWith('http')) {
            return getProxyUrl(line);
          }
        } else {
          return line;
        }
      }).join('\n');
      set.headers['content-type'] = 'application/vnd.apple.mpegurl';
      return newText;
    }
    const res = await fetch(url, {
      proxy: `http://${config.proxy}`,
      verbose: config.debugFetch,
      // tls: { rejectUnauthorized: false },
    })
    if (url.endsWith('.ts')) {
      return await res.arrayBuffer();
    }
    return res;
  }, {
    params: t.Object({
      id: t.Integer()
    })
  })