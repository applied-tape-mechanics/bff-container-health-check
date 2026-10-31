/**
 * Raw TCP Network Socket Server for Brainfuck Container Health Check.
 *
 * Uses Node.js standard library node:net to handle non-blocking TCP network I/O,
 * passing client requests to the Brainfuck healthcheck engine and streaming
 * the raw Brainfuck-generated HTTP response back to the client.
 */

import * as net from 'node:net';
import { HealthCheckEngine } from './engine.ts';

export const DEFAULT_HOST = process.env.HOST || '0.0.0.0';
export const DEFAULT_PORT = parseInt(process.env.PORT || '8080', 10);

const FALLBACK_ERROR_RESPONSE = Buffer.from(
  'HTTP/1.1 500 Internal Server Error\r\n' +
  'Content-Type: application/json\r\n' +
  'Content-Length: 17\r\n' +
  'Connection: close\r\n\r\n' +
  '{"status":"DOWN"}',
  'utf-8'
);

export interface ISocket {
  setTimeout?: (ms: number, cb?: () => void) => void;
  write: (data: Uint8Array | Buffer, cb?: () => void) => boolean;
  end: () => void;
  destroy: () => void;
  on: (event: string, listener: (...args: any[]) => void) => this;
}

export class HealthCheckTcpServer {
  host: string;
  port: number;
  engine: HealthCheckEngine;
  server: net.Server | null = null;

  constructor(host: string = DEFAULT_HOST, port: number = DEFAULT_PORT) {
    this.host = host;
    this.port = port;
    this.engine = new HealthCheckEngine();
  }

  handleConnection(socket: ISocket): void {
    let receivedData: Buffer[] = [];
    let handled = false;

    if (socket.setTimeout) {
      socket.setTimeout(5000);
    }

    const finish = (response: Uint8Array | Buffer) => {
      if (handled) return;
      handled = true;
      try {
        socket.write(response, () => {
          socket.end();
        });
      } catch {
        socket.destroy();
      }
    };

    socket.on('data', (chunk: Buffer | Uint8Array) => {
      receivedData.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      // Process on first data packet received
      const totalBuffer = Buffer.concat(receivedData);
      try {
        const responseBytes = this.engine.runHealthcheck(totalBuffer);
        finish(responseBytes);
      } catch {
        finish(FALLBACK_ERROR_RESPONSE);
      }
    });

    socket.on('timeout', () => {
      // If no data was received before timeout, run with empty input
      if (!handled) {
        try {
          const responseBytes = this.engine.runHealthcheck(new Uint8Array());
          finish(responseBytes);
        } catch {
          finish(FALLBACK_ERROR_RESPONSE);
        }
      }
    });

    socket.on('error', () => {
      finish(FALLBACK_ERROR_RESPONSE);
    });
  }

  start(port?: number, host?: string): Promise<void> {
    if (port !== undefined) this.port = port;
    if (host !== undefined) this.host = host;

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
        }
        console.log(`[*] Brainfuck TCP Health Check Server listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }
}
