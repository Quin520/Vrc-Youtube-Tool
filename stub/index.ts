import path from 'node:path';
import { normalizeYoutubeUrl } from '../src/youtube.ts';

const args = Bun.argv.slice(2);
const videoUrl = [...args].reverse().find(value => {
  try { normalizeYoutubeUrl(value); return true; } catch { return false; }
});
if (!videoUrl) {
  const child = Bun.spawn([path.join(path.dirname(process.execPath), 'yt-dlp-original.exe'), ...args], {
    stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  });
  process.exit(await child.exited);
}

const res = await fetch('http://127.0.0.1:7919/fetch-link', {
  method: 'POST',
  proxy: '',
  signal: AbortSignal.timeout(75_000),
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: videoUrl,
  }),
})

const data = await res.json() as {
  text?: string;
  code: number;
  error?: string;
};

if (data.text) {
  console.log(data.text);
}
if (data.error) console.error(data.error);

process.exit(data.code);
