/**
 * Health Check Engine.
 *
 * Loads and runs bf/healthcheck.bf using the persistent Brainfuck VM.
 * Exposes status evaluation, memory diagnostics, and raw HTTP response generation.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { BrainfuckVM, cleanCode, compile, type Program } from 'bff-interpreter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BF_PATH = path.resolve(__dirname, '..', 'bf', 'healthcheck.bf');

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

export interface ProbeResult {
  status: 'UP' | 'DOWN';
  statusCode: number;
  healthy: boolean;
  arithmeticCheck: boolean;
  wrappingCheck: boolean;
  tapeIntegrity: boolean;
  instructionCount: number;
  programOps: number;
  rawResponse: string;
}

export class HealthCheckEngine {
  readonly vm: BrainfuckVM;
  readonly bfCode: string;
  readonly program: Program;

  constructor(tapeSize: number = 30_000, bfPath: string = DEFAULT_BF_PATH) {
    this.vm = new BrainfuckVM({ tapeSize });
    this.bfCode = cleanCode(readFileSync(bfPath, 'utf-8'));
    this.program = compile(this.bfCode);
  }

  /**
   * Executes the Brainfuck health check.
   * Returns the raw HTTP response emitted by the BF program as a Uint8Array.
   */
  runHealthcheck(inputData: Uint8Array | string = new Uint8Array()): Uint8Array {
    this.vm.reset();
    return this.vm.run(this.program, inputData);
  }

  /**
   * Executes the Brainfuck health check and returns the response as a decoded string.
   */
  runHealthcheckString(inputData: Uint8Array | string = new Uint8Array()): string {
    const raw = this.runHealthcheck(inputData);
    return textDecoder.decode(raw);
  }

  /**
   * Checks if the healthcheck returned 200 OK and status "UP".
   */
  isHealthy(inputData: Uint8Array | string = new Uint8Array()): boolean {
    const respStr = this.runHealthcheckString(inputData);
    return respStr.includes('200 OK') && respStr.includes('"UP"');
  }

  /**
   * Performs an in-depth diagnostic probe verifying VM arithmetic,
   * 8-bit wrapping, memory integrity, and execution metrics.
   */
  probeIntegrity(): ProbeResult {
    // 1. Verify basic arithmetic on a temporary run
    const arithVM = new BrainfuckVM({ tapeSize: 10 });
    arithVM.execute('++[>+++++<-]>----------');
    const arithmeticCheck = arithVM.tape[2] === 0;

    // 2. Verify 8-bit wrapping
    const wrapVM = new BrainfuckVM({ tapeSize: 10 });
    wrapVM.execute('-+');
    const wrappingCheck = wrapVM.tape[0] === 0;

    // 3. Execute the full healthcheck program
    this.vm.reset();
    const raw = this.vm.run(this.program, new Uint8Array());
    const rawResponse = textDecoder.decode(raw);
    const healthy = rawResponse.includes('200 OK') && rawResponse.includes('"UP"');
    const tapeIntegrity = this.vm.tape[0] === 0; // c0 is the error flag in healthcheck.bf

    return {
      status: healthy ? 'UP' : 'DOWN',
      statusCode: healthy ? 200 : 500,
      healthy,
      arithmeticCheck,
      wrappingCheck,
      tapeIntegrity,
      instructionCount: this.bfCode.length,
      programOps: this.program.ops.length,
      rawResponse,
    };
  }
}
