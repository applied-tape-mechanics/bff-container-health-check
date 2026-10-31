/**
 * Server Entrypoint for Brainfuck Container Health Check.
 *
 * Runs the Fastify HTTP server (with OpenAPI / Swagger UI / Web UI)
 * and optionally the raw TCP network socket listener.
 */

import { buildApp } from './app.ts';
import { HealthCheckTcpServer } from './tcp-server.ts';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '8080', 10);
const TCP_PORT = process.env.TCP_PORT ? parseInt(process.env.TCP_PORT, 10) : undefined;
const DISABLE_BACKEND = process.env.DISABLE_BACKEND === 'true';

async function main() {
  const app = await buildApp({
    disableBackend: DISABLE_BACKEND,
    logger: process.env.NODE_ENV !== 'test',
  });

  let tcpServer: HealthCheckTcpServer | null = null;
  if (TCP_PORT) {
    tcpServer = new HealthCheckTcpServer(HOST, TCP_PORT);
    await tcpServer.start();
  }

  try {
    const address = await app.listen({ host: HOST, port: PORT });
    console.log(`[*] Brainfuck Health Check Server listening on ${address}`);
    if (tcpServer) {
      console.log(`[*] Brainfuck Raw TCP Server listening on ${HOST}:${TCP_PORT}`);
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('\n[*] Shutting down...');
    if (tcpServer) await tcpServer.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
