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
  streamMode: 'mp4' as 'mp4' | 'hls-direct' | 'hls-mux',
}

export default config

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
      args.push(`--proxy`, config.proxyYtdlp);
    }
  }
  switch (config.streamMode) {
    case "mp4":
      args.push('-f', 'b[protocol=https]', '--get-url')
      break;
    case "hls-direct":
      args.push('-f', 'b', '--get-url')
      break;
    case "hls-mux":
      args.push('-f', 'b', '-o-')
      break;
  }
  return args;
}
