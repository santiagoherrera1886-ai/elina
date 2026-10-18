import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = new URL('../public/', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('styles.css', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const book = JSON.parse(await readFile(new URL('data/book.json', root), 'utf8'));
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate document IDs');
for (const [, selector] of app.matchAll(/\$\('#([\w-]+)'\)/g)) {
  assert.ok(ids.includes(selector), `Missing application element: ${selector}`);
}
const assets = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map(match => match[1]);
assets.push(...[...css.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]));
for (const path of new Set(assets)) {
  if (/^https?:/.test(path)) continue;
  const info = await stat(new URL(path, root));
  assert.ok(info.size > 0, `Empty asset ${path}`);
}
assert.equal(book.pages, 58);
assert.equal(book.chapters.length, 6);
assert.ok(book.words > 25000);
assert.equal(book.chapters[0].id, 'prologo');
const headings = book.chapters.flatMap(chapter => chapter.blocks.filter(block => block.type === 'heading'));
assert.equal(headings.length, 38, 'Every subsection should be present');
const blockIds = book.chapters.flatMap(chapter => chapter.blocks.map(block => block.id));
assert.equal(new Set(blockIds).size, blockIds.length);
assert.equal(book.chapters.at(-1).blocks.at(-1).text, 'Fin de la Primera Parte');
for (const chapter of book.chapters) for (const block of chapter.blocks) {
  if (block.type === 'image') await stat(new URL(block.src, root));
  assert.ok(block.page >= 5 && block.page <= 58);
}
assert.ok(!app.includes('innerHTML'), 'Reader should render source text safely');
assert.ok(html.includes('prefers-reduced-motion') || css.includes('prefers-reduced-motion'));
assert.ok(css.includes('@media(max-width:760px)'));
const pdf = await readFile(new URL(book.pdf, root));
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(config.outputDirectory, 'dist');
console.log(`Verified ${book.pages} PDF pages, ${book.chapters.length} reading sections, ${headings.length} subsections, ${book.words} words, all local assets and UI selectors.`);
