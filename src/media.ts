export interface MediaFormat {
  format_id: string;
  url: string;
  protocol?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  filesize?: number;
  filesize_approx?: number;
  http_headers?: Record<string, string>;
}

export interface MediaInfo extends MediaFormat {
  id: string;
  duration?: number;
  is_live?: boolean;
  live_status?: string;
  requested_formats?: MediaFormat[];
  formats?: MediaFormat[];
}

/** Keep only playback fields; full yt-dlp metadata can be large and contain account context. */
export function compactMediaInfo(info: MediaInfo): MediaInfo {
  const pick = (f: MediaFormat): MediaFormat => ({
    format_id: f.format_id, url: f.url, protocol: f.protocol, ext: f.ext,
    vcodec: f.vcodec, acodec: f.acodec, width: f.width, height: f.height, fps: f.fps,
    filesize: f.filesize, filesize_approx: f.filesize_approx, http_headers: f.http_headers,
  });
  return { ...pick(info), id: info.id, duration: info.duration, is_live: info.is_live, live_status: info.live_status,
    requested_formats: info.requested_formats?.map(pick),
    formats: info.formats?.map(f => ({ format_id: f.format_id, url: '', height: f.height, vcodec: f.vcodec })),
  };
}

export function selectedFormats(info: MediaInfo) {
  const formats = info.requested_formats?.length ? info.requested_formats : [info];
  if (!formats.every(f => f.url && /^https?:\/\//i.test(f.url))) throw new Error('没有可转发的 HTTP 音视频流');
  return formats;
}

export function qualitySummary(info: MediaInfo) {
  const selected = selectedFormats(info);
  const video = selected.find(f => f.vcodec && f.vcodec !== 'none');
  const audio = selected.find(f => f.acodec && f.acodec !== 'none');
  if (!video || !audio) throw new Error('选中的格式缺少视频或音轨');
  return {
    videoId: info.id,
    formats: selected.map(f => f.format_id).join('+'),
    width: video.width,
    height: video.height,
    fps: video.fps,
    videoCodec: video.vcodec,
    audioCodec: audio.acodec,
    highestAvailableHeight: Math.max(0, ...(info.formats ?? selected).filter(f => f.vcodec !== 'none').map(f => f.height ?? 0)),
  };
}
