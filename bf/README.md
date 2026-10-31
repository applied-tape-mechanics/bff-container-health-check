# Brainfuck Healthcheck Programs — `bf/`

This directory contains the Brainfuck source program powering the container health check endpoint.

## `healthcheck.bf`

### Purpose
Executes a runtime hardware/memory simulation integrity check on the 30,000-cell tape and generates a RFC-compliant HTTP response stream with JSON body directly from Brainfuck instructions.

### Memory Layout
- **Cell 0**: Error Flag (`0` = Healthy / UP, `1` = Integrity Failure / DOWN)
- **Cells 1–3**: Scratch and condition flags for arithmetic and character checking
- **Cell 4**: Dynamic byte output buffer

### Diagnostic Sequence
1. **Zero Initialization**: Clears test register cells.
2. **Arithmetic Integrity**: Computes `(2 * 5) - 10`. If cell is non-zero, sets error flag.
3. **Wrapping Arithmetic Integrity**: Subtracts 1 and adds 1 to test 8-bit unsigned cell wrapping `(0 - 1 = 255, 255 + 1 = 0)`.
4. **Trigger Byte Check**: Reads incoming trigger stream from stdin. If character `F` (ASCII 70) is sent, explicitly forces error mode.
5. **Conditional HTTP Output**:
   - If **healthy** (Cell 0 == 0):
     Emits:
     ```http
     HTTP/1.1 200 OK
     Content-Type: application/json
     Content-Length: 15
     Connection: close

     {"status":"UP"}
     ```
   - If **unhealthy** (Cell 0 != 0):
     Emits:
     ```http
     HTTP/1.1 500 Internal Server Error
     Content-Type: application/json
     Content-Length: 17
     Connection: close

     {"status":"DOWN"}
     ```
