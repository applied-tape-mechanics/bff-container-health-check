/**
 * Comprehensive Tests for bff-container-health-check.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { BrainfuckVM, compile } from 'bff-interpreter';
import { HealthCheckEngine } from '../src/engine.ts';
import { compileHealthcheckBf } from '../src/compiler.ts';
import { HealthCheckTcpServer } from '../src/tcp-server.ts';
import { buildApp } from '../src/app.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BF_PATH = path.resolve(__dirname, '..', 'bf', 'healthcheck.bf');

class MockSocket extends EventEmitter {
  written: Buffer[] = [];
  ended = false;
  destroyed = false;

  setTimeout(_ms: number, _cb?: () => void) {}

  write(data: Uint8Array | Buffer, cb?: () => void): boolean {
    this.written.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    if (cb) cb();
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  getOutput(): string {
    return Buffer.concat(this.written).toString('utf-8');
  }
}

describe('Interpreter Basic VM Verification', () => {
  it('executes basic Brainfuck program correctly', () => {
    const vm = new BrainfuckVM({ tapeSize: 65_536 });
    const prog = compile('++++++++[>++++++++<-]>+.');
    const out = vm.run(prog);
    assert.equal(Buffer.from(out).toString('utf-8'), 'A');
  });

  it('resets tape on reset()', () => {
    const vm = new BrainfuckVM({ tapeSize: 100 });
    const prog = compile('+++++');
    vm.run(prog);
    assert.equal(vm.tape[0], 5);
    vm.reset();
    assert.equal(vm.tape[0], 0);
  });

  it('handles 8-bit wrapping arithmetic', () => {
    const vm = new BrainfuckVM({ tapeSize: 100 });
    vm.execute('-');
    assert.equal(vm.tape[0], 255);
    vm.execute('+');
    assert.equal(vm.tape[0], 0);
  });
});

describe('Compiler Determinism', () => {
  it('compiles healthcheck.bf identically to the on-disk file', () => {
    const compiled = compileHealthcheckBf();
    const disk = readFileSync(BF_PATH, 'utf-8').trim();
    assert.equal(compiled, disk);
  });
});

describe('HealthCheckEngine', () => {
  it('returns healthy 200 OK response with empty input', () => {
    const engine = new HealthCheckEngine();
    const raw = engine.runHealthcheckString();
    assert.ok(raw.includes('HTTP/1.1 200 OK'));
    assert.ok(raw.includes('Content-Type: application/json'));
    assert.ok(raw.includes('{"status":"UP"}'));
  });

  it('handles standard HTTP GET request line input', () => {
    const engine = new HealthCheckEngine();
    const raw = engine.runHealthcheckString('GET /health HTTP/1.1\r\n\r\n');
    assert.ok(raw.includes('HTTP/1.1 200 OK'));
    assert.ok(raw.includes('{"status":"UP"}'));
  });

  it('evaluates isHealthy() helper to true on normal execution', () => {
    const engine = new HealthCheckEngine();
    assert.equal(engine.isHealthy(), true);
    assert.equal(engine.isHealthy('GET / HTTP/1.1\r\n\r\n'), true);
  });

  it('triggers forced failure mode when input starts with F', () => {
    const engine = new HealthCheckEngine();
    const raw = engine.runHealthcheckString('F');
    assert.ok(raw.includes('HTTP/1.1 500 Internal Server Error'));
    assert.ok(raw.includes('{"status":"DOWN"}'));
    assert.equal(engine.isHealthy('F'), false);
  });

  it('runs deep probe and verifies memory, arithmetic, and wrapping integrity', () => {
    const engine = new HealthCheckEngine();
    const probe = engine.probeIntegrity();
    assert.equal(probe.status, 'UP');
    assert.equal(probe.statusCode, 200);
    assert.equal(probe.healthy, true);
    assert.equal(probe.arithmeticCheck, true);
    assert.equal(probe.wrappingCheck, true);
    assert.equal(probe.tapeIntegrity, true);
    assert.ok(probe.instructionCount > 0);
    assert.ok(probe.programOps > 0);
  });
});

describe('HealthCheckTcpServer', () => {
  it('streams HTTP 200 response to TCP socket connection', () => {
    const server = new HealthCheckTcpServer();
    const mockSocket = new MockSocket();

    server.handleConnection(mockSocket as any);
    mockSocket.emit('data', Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n'));

    const response = mockSocket.getOutput();
    assert.ok(response.includes('HTTP/1.1 200 OK'));
    assert.ok(response.includes('{"status":"UP"}'));
    assert.equal(mockSocket.ended, true);
  });

  it('streams HTTP 500 response when forced failure trigger F is sent over TCP', () => {
    const server = new HealthCheckTcpServer();
    const mockSocket = new MockSocket();

    server.handleConnection(mockSocket as any);
    mockSocket.emit('data', Buffer.from('F'));

    const response = mockSocket.getOutput();
    assert.ok(response.includes('HTTP/1.1 500 Internal Server Error'));
    assert.ok(response.includes('{"status":"DOWN"}'));
    assert.equal(mockSocket.ended, true);
  });

  it('handles socket timeout gracefully by returning default UP health check', () => {
    const server = new HealthCheckTcpServer();
    const mockSocket = new MockSocket();

    server.handleConnection(mockSocket as any);
    mockSocket.emit('timeout');

    const response = mockSocket.getOutput();
    assert.ok(response.includes('HTTP/1.1 200 OK'));
    assert.ok(response.includes('{"status":"UP"}'));
    assert.equal(mockSocket.ended, true);
  });
});

describe('Fastify Application Endpoints', () => {
  it('GET /health returns 200 OK with UP status', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'UP');
    assert.equal(body.engine, 'brainfuck');
    assert.equal(body.version, '1.0.0');
  });

  it('POST /health allows triggering failure mode with F', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/health',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'F' }),
    });
    assert.equal(res.statusCode, 500);
    const body = res.json();
    assert.equal(body.status, 'DOWN');
    assert.ok(body.rawResponse.includes('500 Internal Server Error'));
  });

  it('GET /probe returns deep integrity diagnostics', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/probe' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'UP');
    assert.equal(body.arithmeticCheck, true);
    assert.equal(body.wrappingCheck, true);
    assert.equal(body.tapeIntegrity, true);
  });

  it('GET /raw returns exact raw HTTP stream emitted by Brainfuck', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/raw' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('HTTP/1.1 200 OK'));
    assert.ok(res.body.includes('{"status":"UP"}'));
  });

  it('GET /bf/code returns raw Brainfuck code', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/bf/code' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.startsWith('>[-]>[-]>[-]'));
  });

  it('GET / returns HTML UI or JSON according to Accept header', async () => {
    const app = await buildApp();
    const resHtml = await app.inject({ method: 'GET', url: '/' });
    assert.equal(resHtml.statusCode, 200);
    assert.ok(resHtml.body.includes('<!DOCTYPE html>'));

    const resJson = await app.inject({
      method: 'GET',
      url: '/',
      headers: { Accept: 'application/json' },
    });
    assert.equal(resJson.statusCode, 200);
    const json = resJson.json();
    assert.equal(json.status, 'UP');
  });

  it('DISABLE_BACKEND=true rejects guarded endpoints with 503', async () => {
    const app = await buildApp({ disableBackend: true });
    const resHealth = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(resHealth.statusCode, 503);

    const resProbe = await app.inject({ method: 'GET', url: '/probe' });
    assert.equal(resProbe.statusCode, 503);
  });
});
