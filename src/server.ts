import { Elysia, t } from "elysia";
import { $ } from "bun";
import config, { getYtdlpArgs } from "./config.ts";
import { createLogg } from "@guiiai/logg";

const log = createLogg('HTTP 服务').useGlobalConfig()
const videoLinks: string[] = []

export default new Elysia()
  .get('/', 'Hello')
  .post('/fetch-link', async ({ body }) => {
    log.withFields(body).log("收到视频解析请求")
    try {
      const args = body.args;
      if (args.includes('--exp-allow')) {
        args.splice(args.indexOf('--exp-allow'), 2);
      }
      if (args.includes('--wild-allow')) {
        args.splice(args.indexOf('--wild-allow'), 2);
      }
      const stdout = await $`${config.ytdlp} ${getYtdlpArgs()} ${body.args}`.text()
      log.log(stdout)
      if (stdout.startsWith('http')) {
        const find = videoLinks.findIndex(v => v === stdout);
        if (find !== -1) {
          return {
            text: `http://${config.hostsOk ? 'localhost.youtube.com' : 'localhost'}:${config.port}/video/${find}`,
            code: 0,
          };
        }
        const index = videoLinks.length;
        videoLinks.push(stdout);
        return {
          text: `http://${config.hostsOk ? 'localhost.youtube.com' : 'localhost'}:${config.port}/video/${index}`,
          code: 0,
        };
      } else {
        return {
          text: stdout,
          code: 0,
        };
      }
    } catch (e: any) {
      log.withField('stdout', e.stdout).withField('stderr', e.stderr).errorWithError("视频解析失败", e);
      return {
        code: e.exitCode || 1,
      }
    }
  }, {
    body: t.Object({
      args: t.Array(t.String()),
    }),
    response: t.Object({
      text: t.Optional(t.String()),
      code: t.Number(),
    })
  })
  .get('/video/:id', ({ params, request, set }) => {
    return fetch(videoLinks[params.id]!, {
      proxy: `http://${config.proxy}`,
      verbose: config.debugFetch,
      // tls: { rejectUnauthorized: false },
    })
  }, {
    params: t.Object({
      id: t.Integer()
    })
  })