/**
 * Fastify Server, OpenAPI docs and Web UI for Brainfuck Container Health Check.
 */

import { readFileSync } from 'node:fs';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { HealthCheckEngine, type ProbeResult } from './engine.ts';

export const APP_ID = 'bff-container-health-check';
export const VERSION = '1.0.0';

export interface AppOptions {
  disableBackend?: boolean;
  engine?: HealthCheckEngine;
  logger?: boolean;
}

interface HealthCheckBody {
  input?: string;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const disableBackend = options.disableBackend ?? false;
  const engine = options.engine ?? new HealthCheckEngine();
  const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf-8');

  const app = Fastify({ logger: options.logger ?? false });

  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, (body as Buffer).toString('utf-8'));
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const detail =
      status === 400 && /json/i.test(error.message) ? `Invalid JSON body: ${error.message}` : error.message;
    void reply.status(status).send({ detail });
  });

  if (!disableBackend) {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Brainfuck Container Health Check Endpoint (bff-container-health-check)',
          description:
            'Lightweight HTTP/TCP health check sidecar where Brainfuck verifies memory/arithmetic integrity and generates HTTP response streams.',
          version: VERSION,
        },
      },
    });
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
    app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }

  const guard = () => {
    if (disableBackend) {
      throw Object.assign(new Error('Backend API processing is disabled (DISABLE_BACKEND=true).'), {
        statusCode: 503,
      });
    }
  };

  app.get(
    '/health',
    {
      schema: {
        summary: 'Standard health check endpoint evaluated by Brainfuck',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              app: { type: 'string' },
              engine: { type: 'string' },
              version: { type: 'string' },
              backend_enabled: { type: 'boolean' },
            },
          },
          500: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              detail: { type: 'string' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      guard();
      const healthy = engine.isHealthy();
      if (!healthy) {
        return reply.status(500).send({
          status: 'DOWN',
          detail: 'Brainfuck integrity checks failed',
        });
      }
      return {
        status: 'UP',
        app: APP_ID,
        engine: 'brainfuck',
        version: VERSION,
        backend_enabled: !disableBackend,
      };
    },
  );

  app.post(
    '/health',
    {
      schema: {
        summary: 'Trigger health check with arbitrary input stream (e.g. "F" to force failure)',
        body: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input string to feed to the BF health check' },
          },
        },
      },
    },
    async (req, reply) => {
      guard();
      let input = '';
      if (typeof req.body === 'string') {
        try {
          const parsed = JSON.parse(req.body) as HealthCheckBody;
          input = parsed.input ?? '';
        } catch {
          input = req.body;
        }
      } else if (typeof req.body === 'object' && req.body !== null) {
        input = (req.body as HealthCheckBody).input ?? '';
      }

      const raw = engine.runHealthcheckString(input);
      const isUp = raw.includes('200 OK') && raw.includes('"UP"');
      const status = isUp ? 200 : 500;

      return reply.status(status).send({
        status: isUp ? 'UP' : 'DOWN',
        statusCode: status,
        rawResponse: raw,
      });
    },
  );

  app.get(
    '/probe',
    {
      schema: {
        summary: 'Deep diagnostic probe running memory and arithmetic integrity checks in BF VM',
      },
    },
    async () => {
      guard();
      return engine.probeIntegrity();
    },
  );

  app.get(
    '/raw',
    {
      schema: {
        summary: 'Raw HTTP response stream directly emitted by Brainfuck program',
        produces: ['text/plain'],
      },
    },
    async (_req, reply) => {
      guard();
      const raw = engine.runHealthcheckString();
      return reply.type('text/plain; charset=utf-8').send(raw);
    },
  );

  app.get(
    '/bf/code',
    {
      schema: {
        summary: 'Raw Brainfuck source code',
        produces: ['text/plain'],
      },
    },
    async (_req, reply) => reply.type('text/plain; charset=utf-8').send(engine.bfCode),
  );

  app.get('/', async (req, reply) => {
    // If request explicitly asks for JSON, return health status
    const accept = req.headers['accept'] || '';
    if (accept.includes('application/json') && !accept.includes('text/html')) {
      const healthy = !disableBackend && engine.isHealthy();
      return reply.status(healthy ? 200 : 500).send({ status: healthy ? 'UP' : 'DOWN' });
    }

    const html = indexHtml
      .replace(/__BF_CODE__/g, JSON.stringify(engine.bfCode))
      .replace(/__DISABLE_BACKEND__/g, JSON.stringify(disableBackend))
      .replace(/__VERSION__/g, VERSION)
      .replace(/__APP_ID__/g, APP_ID);

    return reply.type('text/html; charset=utf-8').send(html);
  });

  return app;
}
