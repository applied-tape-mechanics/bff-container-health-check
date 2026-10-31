# Brainfuck Container Health Check Endpoint (`bff-container-health-check`)

> **[Applied Tape Mechanics](https://github.com/applied-tape-mechanics)** — *Empirical computation and discrete field dynamics on minimal linear substrates.*
> *Enterprise-grade cloud microservices—except the core business logic is pure Brainfuck. Best Friends Forever (`BFF`) with the most hostile programming language ever created.*

A cloud-native HTTP and raw TCP health check sidecar microservice. Why trust a trivial `200 OK` string when a **Brainfuck program** ([`bf/healthcheck.bf`](bf/healthcheck.bf)) can actively verify memory cell read/write integrity, `10 - 10 == 0` subtraction, and 8-bit `255 + 1 == 0` overflow wrapping before emitting the raw `HTTP/1.1 200 OK` response stream byte-for-byte?

---

## 📦 Repository Structure & File Reference

```text
bff-container-health-check/
├── bf/
│   ├── healthcheck.bf         # Compiled Brainfuck diagnostic & HTTP stream generator (1,073 ops)
│   └── README.md              # Tape memory layout & diagnostic sequence specification
├── src/
│   ├── server.ts              # Entry point starting Fastify HTTP server and optional Raw TCP listener
│   ├── app.ts                 # Fastify application, OpenAPI/Swagger routes & HTML template injection
│   ├── tcp-server.ts          # Non-blocking Node node:net TCP socket bridge to the Brainfuck VM
│   ├── engine.ts              # Brainfuck VM wrapper for health evaluation & deep memory probes
│   ├── compiler.ts            # Deterministic compiler that generates bf/healthcheck.bf
│   └── index.html             # Interactive diagnostic dashboard with Client JS VM fallback
├── test/
│   └── healthcheck.test.ts    # 18 automated tests (VM, compiler determinism, TCP server & Fastify API)
├── Dockerfile                 # Multi-stage Node 24 container (base, test, and production stages)
├── docker-compose.yml         # Production healthcheck service (port 8084 -> 8080) & isolated test runner
├── package.json               # Service metadata, scripts & pinned bff-interpreter dependency
├── tsconfig.json              # TypeScript configuration
└── LICENSE                    # MIT License
```

---

## ✨ Architecture & Features

```text
┌────────────────────────────────────────────────────────┐
│  HTTP Client / Docker Healthcheck / Kubernetes Probe   │
│  GET /health HTTP/1.1                                  │
└───────────────────────────┬────────────────────────────┘
                            │ (HTTP Port 8084 or Raw TCP Socket)
                    ┌───────▼────────┐
                    │ Fastify & TCP  │ (src/server.ts, src/tcp-server.ts)
                    │ Network Bridge │ Non-blocking async listener
                    └───────┬────────┘
                            │ Streams request & trigger byte into stdin
                    ┌───────▼────────┐
                    │  BF Integrity  │ (bf/healthcheck.bf)
                    │  & HTTP Engine │ Runs memory diagnostic test,
                    │  (30k cells)   │ emits full HTTP response stream
                    └────────────────┘
```

- **Brainfuck Hardware/Memory Diagnostic (`bf/healthcheck.bf`, `1,073` instructions)**:
  1. **Zero Initialization**: Clears test register cells `c0..c4`.
  2. **Arithmetic Integrity Check**: Computes `(2 * 5) - 10` on the tape. If non-zero, sets error flag `c0 = 1`.
  3. **8-Bit Wrapping Check**: Subtracts `1` (`0 -> 255`) and adds `1` (`255 -> 0`) to verify unsigned 8-bit overflow semantics.
  4. **Failure Injection Trigger**: Reads incoming request byte from `stdin`. Sending `'F'` (ASCII `70`) forces `c0 = 1` to simulate an unhealthy container (`HTTP/1.1 500 Internal Server Error`).
  5. **Direct HTTP/1.1 Stream Generation**: Emits a complete, RFC-compliant HTTP/1.1 response header and JSON payload (`{"status":"UP"}` or `{"status":"DOWN"}`) directly from Brainfuck `.` instructions.
- **Dual Network Listeners**:
  - **Fastify HTTP Server (`PORT=8080`, mapped to `8084`)**: Provides `/health`, `/probe`, `/raw`, `/bf/code`, OpenAPI/Swagger UI (`/docs`), and the interactive web dashboard (`/`).
  - **Raw TCP Socket Server (`TCP_PORT`)**: Optional `node:net` socket bridge (`src/tcp-server.ts`) that feeds raw TCP packets into the Brainfuck VM and writes the Brainfuck-generated HTTP response bytes directly to the socket.
- **Zero-Submodule Runtime UI & Client-Side Fallback**:
  - Loads [`bff-ui`](https://github.com/applied-tape-mechanics/bff-ui) and [`bff-interpreter`](https://github.com/applied-tape-mechanics/bff-interpreter) at runtime from pinned GitHub releases via jsDelivr CDN (`@v1.0.0`).
  - Supports **OS 9** and **OS X** themes and runs 100% standalone in the browser via the JavaScript Brainfuck VM when hosted on GitHub Pages (`DISABLE_BACKEND=true`).

---

## 🧠 Brainfuck Tape Architecture (`bf/healthcheck.bf`)

See [`bf/README.md`](bf/README.md) for full details.

| Cell | Identifier | Purpose |
| :---: | :--- | :--- |
| `c0` | `err_flag` | Master health status (`0` = Healthy / `200 OK`, `1` = Failure / `500 Internal Server Error`) |
| `c1` | `temp1` | Primary arithmetic & `stdin` trigger character accumulator |
| `c2` | `temp2` | Secondary comparison flag & branch selector |
| `c3` | `temp3` | Scratch cell |
| `c4` | `printer` | Delta-encoded ASCII character emitter for `HTTP/1.1 200 OK` and `HTTP/1.1 500` streams |

---

## 🐳 Docker Setup (Zero Host Dependencies)

A pre-built production image is published automatically to **GitHub Container Registry (`ghcr.io`)**:

```bash
# Run the healthcheck microservice directly from GHCR on http://localhost:8084
docker run --rm -p 8084:8080 ghcr.io/applied-tape-mechanics/bff-container-health-check:latest
```

### Using Docker Compose

```bash
# Pull the pre-built release image from GHCR and start in the background
docker compose pull
docker compose up -d

# Or build locally from source and start
docker compose up -d --build

# Run the full 18-test suite (VM, compiler determinism, TCP socket & HTTP API) inside Docker
docker compose run --rm test

# Run TypeScript type checking inside Docker
docker compose run --rm test npm run typecheck

# Recompile bf/healthcheck.bf inside Docker
docker compose run --rm test npm run compile:bf
```

### Using as a Sidecar in Another Service's `docker-compose.yml`

```yaml
services:
  healthcheck:
    image: ghcr.io/applied-tape-mechanics/bff-container-health-check:latest
    ports:
      - "8084:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

Visit:
- **Interactive Diagnostic Dashboard:** [http://localhost:8084](http://localhost:8084)
- **Swagger OpenAPI Docs:** [http://localhost:8084/docs](http://localhost:8084/docs)

---

## 💻 Local Development (Node.js ≥ 22.18)

```bash
npm install
npm run dev          # watch mode on http://localhost:8080
npm test             # node:test (18 unit & integration tests)
npm run typecheck    # tsc --noEmit
npm run compile:bf   # regenerate bf/healthcheck.bf
```

Environment variables:
- `PORT` (default `8080`): HTTP server port
- `HOST` (default `0.0.0.0`): Bind address
- `TCP_PORT` (optional): Enables the raw TCP socket server on the specified port
- `DISABLE_BACKEND` (`true` / `false`): Disables backend API endpoints to test pure client-side JS VM execution

---

## 📡 API Examples

### 1. Standard Health Check (`GET /health`)
```bash
curl http://localhost:8084/health
```
```json
{
  "status": "UP",
  "app": "bff-container-health-check",
  "engine": "brainfuck",
  "version": "1.0.0",
  "backend_enabled": true
}
```

### 2. Deep Diagnostic Probe (`GET /probe`)
```bash
curl http://localhost:8084/probe
```
```json
{
  "status": "UP",
  "statusCode": 200,
  "healthy": true,
  "arithmeticCheck": true,
  "wrappingCheck": true,
  "tapeIntegrity": true,
  "instructionCount": 1073,
  "programOps": 417,
  "rawResponse": "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"UP\"}"
}
```

### 3. Simulate Failure Mode (`POST /health`)
```bash
curl -i -X POST http://localhost:8084/health \
  -H "Content-Type: application/json" \
  -d '{"input": "F"}'
```

### 4. Raw Brainfuck-Emitted HTTP Stream (`GET /raw`)
```bash
curl http://localhost:8084/raw
```
