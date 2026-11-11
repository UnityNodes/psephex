import { z } from "zod/mini";

/**
 * Zod probes for eval with `new Function("")` the first time it parses an object. Our CSP has no
 * 'unsafe-eval', so the probe fails quietly but every dashboard page logged a script-src
 * violation. Turning the JIT off skips the probe; parsing stays correct, only slower.
 */
z.config({ jitless: true });
