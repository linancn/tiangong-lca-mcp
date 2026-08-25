import { once } from 'node:events';
import type { Server } from 'node:http';
import type { Express } from 'express';

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function withHttpServer<T>(
  app: Express,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Expected the test HTTP server to listen on an ephemeral TCP port.');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}
