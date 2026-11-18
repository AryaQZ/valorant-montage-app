import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { requestLocalWorker } from './worker-client.js';

let server: Server | undefined;

function listen(handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') { reject(new Error('Test server did not bind a TCP port.')); return; }
      resolve(address.port);
    });
  });
}

afterEach(async () => {
  if (!server) return;
  const current = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve()));
});

it('waits for delayed local worker headers within the caller timeout', async () => {
  const port = await listen((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"status":"complete"}');
    }, 400);
  });

  await expect(requestLocalWorker({ port, token: 'test-token', method: 'GET', route: '/v1/jobs/test', timeoutMs: 1_500 }))
    .resolves.toEqual({ status: 'complete' });
});

it('enforces its explicit timeout for a stalled local worker', async () => {
  const port = await listen(() => { /* Hold the response open until the client deadline. */ });

  await expect(requestLocalWorker({ port, token: 'test-token', method: 'GET', route: '/v1/jobs/test', timeoutMs: 80 }))
    .rejects.toThrow('timed out after 80 ms');
});
