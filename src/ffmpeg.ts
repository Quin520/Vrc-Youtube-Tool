import path from 'node:path';
import { selectedFormats, type MediaInfo } from './media.ts';
import { runProcess } from './process.ts';

const capabilities = new Map<string, Promise<{ boundedRequests: boolean }>>();
export function checkFfmpeg(executable: string) {
  let result = capabilities.get(executable);
  if (!result) {
    result = (async () => {
      try { await runProcess(executable, ['-version'], { timeoutMs: 5000 }); }
      catch { throw new Error('无损模式需要 ffmpeg.exe；请放在工具目录，或设置 [ytdlp] ffmpeg-path'); }
      const options = await runProcess(executable, ['-hide_banner', '-h', 'protocol=http'], { timeoutMs: 5000 }).catch(() => '');
      return { boundedRequests: /-request_size\s/.test(options) && /-initial_request_size\s/.test(options) };
    })();
    capabilities.set(executable, result);
    result.catch(() => capabilities.delete(executable));
  }
  return result;
}

export function buildRemuxArgs(info: MediaInfo, output: string, options: {
  proxy?: string; boundedRequests: boolean; hls: boolean;
}) {
  const formats = selectedFormats(info);
  // Demux errors can otherwise exit 0 with a truncated movie. Never cache that
  // result as complete, even if FFmpeg managed to write a valid container.
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-xerror', '-y', '-progress', 'pipe:1', '-stats_period', '0.5'];
  for (const format of formats) {
    args.push('-rw_timeout', '15000000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
    if (options.boundedRequests && ['http', 'https', undefined].includes(format.protocol)) {
      args.push('-request_size', '8388608', '-initial_request_size', '1048576', '-multiple_requests', '1');
    }
    if (options.proxy) args.push('-http_proxy', options.proxy);
    const headers = { ...info.http_headers, ...format.http_headers };
    const text = Object.entries(headers)
      .filter(([key, value]) => /^[\w-]+$/.test(key) && !/[\r\n]/.test(value) && !/^(host|range|content-length|accept-encoding)$/i.test(key))
      .map(([key, value]) => `${key}: ${value}\r\n`).join('');
    if (text) args.push('-headers', text);
    args.push('-i', format.url);
  }
  const video = formats.findIndex(f => f.vcodec && f.vcodec !== 'none');
  const audio = formats.findIndex(f => f.acodec && f.acodec !== 'none');
  if (video < 0 || audio < 0) throw new Error('视频或音轨缺失');
  args.push('-map', `${video}:v:0`, '-map', `${audio}:a:0`, '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy');
  if (options.hls) {
    // Forward slashes are required by FFmpeg's HLS path handling on Windows.
    args.push('-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_time', '4', '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments+temp_file', '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', path.join(path.dirname(output), 'segment%06d.m4s').replaceAll('\\', '/'));
  } else args.push('-movflags', '+faststart', '-f', 'mp4');
  args.push(output.replaceAll('\\', '/'));
  return args;
}

export function progressReader(update: (seconds: number, speed?: number) => void) {
  let pending = '';
  let seconds = 0;
  let speed: number | undefined;
  return (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop()!.slice(-4096);
    for (const raw of lines) {
      const [key, value] = raw.trim().split('=');
      if (key === 'out_time_us' && Number.isFinite(Number(value))) seconds = Math.max(0, Number(value) / 1_000_000);
      if (key === 'speed') { const parsed = Number(value?.replace(/x$/, '')); speed = parsed > 0 ? parsed : undefined; }
      if (key === 'progress') update(seconds, speed);
    }
  };
}
