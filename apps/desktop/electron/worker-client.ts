import { request as httpRequest } from 'node:http';

export type LocalWorkerMethod = 'GET' | 'POST' | 'DELETE';

export interface LocalWorkerRequestOptions {
  port: number;
  token: string;
  method: LocalWorkerMethod;
  route: string;
  body?: unknown;
  timeoutMs?: number;
}

/** Use Node's HTTP client so long local media jobs can wait for their response headers. */
export function requestLocalWorker<T>(options: LocalWorkerRequestOptions): Promise<T> {
  const { port, token, method, route, body, timeoutMs = 60_000 } = options;
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    };
    const finishValue = (value: T) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: route,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(serializedBody === undefined ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(serializedBody),
        }),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('aborted', () => finishError(new Error('Local worker response was interrupted.')));
      response.on('error', finishError);
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        let payload: Record<string, unknown> = {};
        try { payload = responseText ? JSON.parse(responseText) as Record<string, unknown> : {}; }
        catch { finishError(new Error('Local worker returned invalid JSON.')); return; }
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          finishError(new Error(typeof payload.error === 'string' ? payload.error : `Local worker returned HTTP ${status}.`));
          return;
        }
        finishValue(payload as T);
      });
    });

    request.on('error', finishError);
    timer = setTimeout(() => request.destroy(new Error(`Local worker request timed out after ${timeoutMs} ms.`)), timeoutMs);
    if (serializedBody !== undefined) request.write(serializedBody);
    request.end();
  });
}
