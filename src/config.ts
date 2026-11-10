export type StreamMode = 'lossless' | 'lossless-compatible' | 'mp4' | 'hls-direct' | 'hls-mux';

const config = {
  ytdlp: '',
  proxy: '127.0.0.1:7890',
  proxyYtdlp: '',
  ytdlpCookiesBrowser: '',
  ytdlpCookiesTxt: '',
  ytdlpKeepConfig: false,
  exitWithVrc: false,
  hostsOk: false,
  port: 7919,
  debugFetch: false,
  configPath: './config.ini',
  streamMode: 'lossless' as StreamMode,
  ffmpeg: './ffmpeg.exe',
  cacheDir: './cache',
  cacheMaxBytes: 8 * 1024 ** 3,
  prepareTimeoutMs: 15 * 60_000,
}

export default config

export const isLosslessMode = () => ['lossless', 'lossless-compatible', 'hls-mux'].includes(config.streamMode);

export const getFormatSelector = () => {
  switch (config.streamMode) {
    case 'mp4': return 'b[protocol=https][ext=mp4]';
    case 'hls-direct': return 'b';
    case 'lossless-compatible':
      // Select existing H.264/AAC streams. Never transcode another codec to them.
      return 'bv[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1][acodec^=mp4a]';
    default: return 'bv*+ba/b';
  }
};

export const getYtdlpArgs = () => {
  const args: string[] = [];
  if (!config.ytdlpKeepConfig) {
    if (config.ytdlpCookiesTxt) {
      args.push(`--cookies`, config.ytdlpCookiesTxt);
    }
    if (config.ytdlpCookiesBrowser) {
      args.push(`--cookies-from-browser`, config.ytdlpCookiesBrowser);
    }
    if (config.proxyYtdlp) {
      args.push(`--proxy`, proxyUrl(config.proxyYtdlp)!);
    }
  }
  // These output/selection options belong to the relay even when using a user config.
  args.push('--no-playlist', '--skip-download', '--dump-single-json', '--no-progress',
    '--socket-timeout', '15', '--retries', '2', '-f', getFormatSelector());
  return args;
}

export function proxyUrl(value = config.proxy) {
  return value ? (/^https?:\/\//i.test(value) ? value : `http://${value}`) : undefined;
}
