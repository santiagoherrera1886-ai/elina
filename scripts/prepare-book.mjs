import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Source parts keep each GitHub connector upload below its request-size limit.
// Production serves one byte-for-byte identical original PDF.
const source = new URL('../book-source/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'));
const pdf = Buffer.concat(await Promise.all(manifest.parts.map(part => readFile(new URL(part, source)))));
assert.equal(pdf.length, manifest.bytes, 'Original PDF length does not match');
assert.equal(createHash('sha256').update(pdf).digest('hex'), manifest.sha256, 'Original PDF checksum does not match');
await mkdir(new URL('../public/assets/', import.meta.url), { recursive:true });
await writeFile(new URL('../public/assets/la-nina-de-la-montana.pdf', import.meta.url), pdf);
console.log(`Original PDF reconstructed and verified: ${pdf.length} bytes.`);
