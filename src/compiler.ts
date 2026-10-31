/**
 * Brainfuck Health Check Program Generator & Compiler.
 *
 * Generates deterministic Brainfuck code that verifies tape arithmetic integrity,
 * cell wrapping, reads incoming request headers, and directly emits standard
 * HTTP 200 OK ({"status":"UP"}) or HTTP 500 Internal Server Error ({"status":"DOWN"}).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function generateBfPrinter(text: string): string {
  let cur = 0;
  const ops: string[] = [];
  const bytes = Buffer.from(text, 'utf-8');

  for (const b of bytes) {
    const diff = b - cur;
    if (diff > 0) {
      ops.push('+'.repeat(diff));
    } else if (diff < 0) {
      ops.push('-'.repeat(-diff));
    }
    ops.push('.');
    cur = b;
  }
  ops.push('[-]');
  return ops.join('');
}

export const HTTP_200 =
  'HTTP/1.1 200 OK\r\n' +
  'Content-Type: application/json\r\n' +
  'Content-Length: 15\r\n' +
  'Connection: close\r\n' +
  '\r\n' +
  '{"status":"UP"}';

export const HTTP_500 =
  'HTTP/1.1 500 Internal Server Error\r\n' +
  'Content-Type: application/json\r\n' +
  'Content-Length: 17\r\n' +
  'Connection: close\r\n' +
  '\r\n' +
  '{"status":"DOWN"}';

export function compileHealthcheckBf(): string {
  const printer200 = generateBfPrinter(HTTP_200);
  const printer500 = generateBfPrinter(HTTP_500);

  // Memory layout:
  // c0: err_flag (0 = healthy, 1 = unhealthy)
  // c1: temp1
  // c2: temp2
  // c3: temp3
  // c4: printer cell

  // 1. Zero out c0, c1, c2, c3, c4
  const initPart = '>[-]>[-]>[-]>[-] >[-] <<<<<';

  // 2. Arithmetic integrity test:
  // c1 = 10, then -10. If c1 != 0: c0 = 1
  const testArith = `
> ++ [ > +++++ < - ] > ----------
[ < < + > > [-] ]
<<
`;

  // 3. Wrapping test:
  // c1 = 0; c1 -= 1; c1 += 1. If c1 != 0: c0 = 1
  const testWrap = `
> - +
[ < + > [-] ]
<
`;

  // 4. Input reading:
  // Read byte into c1.
  // If c1 == 70 ('F'):
  // c1 -= 70; c2 = 1
  // if c1 != 0: c2 = 0; c1 = 0
  // if c2 != 0: c0 = 1; c2 = 0
  const testInput = `
> ,
[
  ----------------------------------------------------------------------
  > + <
  [ > - < [-] ]
  >
  [ < < + > > [-] ]
  <
]
<
`;

  // 5. Branching:
  // c1 = 1
  // if c0 != 0:
  //   c1 = 0
  //   c2 = 1 (run 500)
  //   c0 = 0
  // if c1 != 0:
  //   c1 = 0
  //   run 200
  // if c2 != 0:
  //   c2 = 0
  //   run 500
  const branching = `
> + <
[
  > - <
  > > + < <
  [-]
]
>
[
  [-]
  > > >
  ${printer200}
  < < <
]
>
[
  [-]
  > >
  ${printer500}
  < <
]
<<
`;

  const rawCode = initPart + testArith + testWrap + testInput + branching;
  return rawCode.replace(/[^><+\-.,[\]]/g, '');
}

// CLI execution: compile and save to bf/healthcheck.bf
if (process.argv[1] === __filename) {
  const code = compileHealthcheckBf();
  const outPath = path.resolve(__dirname, '..', 'bf', 'healthcheck.bf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code + '\n', 'utf-8');
  console.log(`Successfully generated bf/healthcheck.bf (${code.length} chars).`);
}
