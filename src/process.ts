import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const children = new Set<ChildProcess>();

export function stopChildren() {
  for (const child of children) child.kill();
}
process.once('exit', stopChildren);

export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]').slice(-1800);
}

export function runProcess(command: string, args: string[], options: {
  timeoutMs?: number;
  maxOutput?: number;
  signal?: AbortSignal;
} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const stdout: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let failure: Error | undefined;
    const stop = (message: string) => {
      failure ||= new Error(message);
      child.kill();
    };
    const timer = setTimeout(() => stop('处理超时，请检查代理连接或视频长度'), options.timeoutMs ?? 60_000);
    const abort = () => stop('处理已取消');
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxOutput ?? 32 * 1024 ** 2)) stop('解析输出超过大小限制');
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      children.delete(child);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(safeError(stderr.trim()) || `进程退出，代码 ${code}`));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}
