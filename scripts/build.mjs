import { cp, rm, mkdir } from 'node:fs/promises';
await import('./prepare-book.mjs');
await rm(new URL('../dist/', import.meta.url), { recursive:true, force:true });
await mkdir(new URL('../dist/', import.meta.url), { recursive:true });
await cp(new URL('../public/', import.meta.url), new URL('../dist/', import.meta.url), { recursive:true });
console.log('Elina: production site built in dist/.');
