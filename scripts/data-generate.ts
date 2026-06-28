import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateSnapshot } from '../src/domain/syntheticSnapshot';

// Byte-stable: deterministic generator + fixed 2-space JSON + trailing newline.
const out = resolve(import.meta.dirname, '..', 'data', 'fixtures', 'synthetic-snapshot.json');
writeFileSync(out, `${JSON.stringify(generateSnapshot(), null, 2)}\n`);
console.warn(`wrote ${out}`);
