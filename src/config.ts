const config = {
  ytdlp: '',
  proxy: '',
  proxyYtdlp: '',
  ytdlpCookiesBrowser: '',
  ytdlpCookiesTxt: '',
  ytdlpKeepConfig: false,
  exitWithVrc: false,
  hostsOk: false,
  port: 7919,
  debugFetch: false,
  configPath: './config.ini',
}

export default config

export const getYtdlpArgs = () => {
  if (config.ytdlpKeepConfig) return [];
  const args: string[] = [];
  if (config.ytdlpCookiesTxt) {
    args.push(`--cookies`, config.ytdlpCookiesTxt);
  }
  if (config.ytdlpCookiesBrowser) {
    args.push(`--cookies-from-browser`, config.ytdlpCookiesBrowser);
  }
  if (config.proxyYtdlp) {
    args.push(`--proxy`, config.proxyYtdlp);
  }
  return args;
}
