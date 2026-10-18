import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizeState, searchBook, overallProgress, parseReaderHash, validPosition } from '../public/reader-core.js';
const book = JSON.parse(await readFile(new URL('../public/data/book.json', import.meta.url), 'utf8'));

test('search finds accented Spanish text without requiring an accent', () => {
  const plain = searchBook(book, 'montana');
  const accented = searchBook(book, 'MONTAÑA');
  assert.ok(plain.total > 20);
  assert.equal(plain.total, accented.total);
  assert.equal(plain.matches[0].blockId, accented.matches[0].blockId);
  assert.ok(plain.matches.every(result => /montaña/i.test(result.match)));
});
test('search reaches the final section omitted in the source table of contents', () => {
  const result = searchBook(book, 'El Hombre que le Sonrió');
  assert.equal(result.matches[0].chapterId, 'capitulo-5');
  assert.equal(result.matches[0].page, 57);
  assert.equal(searchBook(book, '<script>alert(1)</script>').total, 0);
  assert.equal(searchBook(book, ' ').total, 0);
});
test('corrupt saved preferences never break the reader', () => {
  const restored = sanitizeState(book, {
    theme: '<invalid>', fontSize: Infinity,
    position: { chapterId: 'missing' },
    bookmarks: [null, {}, { chapterId: 'missing' }, { chapterId: 'prologo', blockId: 'missing' }]
  });
  assert.equal(restored.theme, 'light');
  assert.equal(restored.fontSize, 21);
  assert.equal(restored.position, null);
  assert.deepEqual(restored.bookmarks, []);
  assert.doesNotThrow(() => sanitizeState(book, null));
});
test('a real reading position survives a save and restore, duplicates are removed', () => {
  const chapter = book.chapters[3];
  const position = { chapterId: chapter.id, blockId: chapter.blocks[5].id, offset: .4, ratio: .3 };
  const state = sanitizeState(book, JSON.parse(JSON.stringify({ theme:'dark', fontSize:25, position, bookmarks:[position, position] })));
  assert.deepEqual(state.position, position);
  assert.equal(state.bookmarks.length, 1);
  assert.equal(state.theme, 'dark');
  assert.equal(state.fontSize, 25);
  assert.equal(validPosition(book, { ...position, ratio: 999, offset:-100 }).ratio, 1);
  assert.equal(validPosition(book, { ...position, ratio: 999, offset:-100 }).offset, 0);
});
test('overall progress stays continuous between chapters and reaches 100%', () => {
  assert.equal(overallProgress(book, 'prologo', 0), 0);
  for (let i = 1; i < book.chapters.length; i++) {
    assert.equal(overallProgress(book, book.chapters[i-1].id, 1), overallProgress(book, book.chapters[i].id, 0));
  }
  assert.equal(overallProgress(book, 'capitulo-5', 1), 100);
});
test('deep links open only valid reading locations', () => {
  const target = book.chapters[5].blocks.at(-2);
  assert.equal(parseReaderHash(`#leer/capitulo-5/${target.id}`, book).blockId, target.id);
  assert.equal(parseReaderHash('#historia', book), null);
  assert.equal(parseReaderHash('#leer/%ZZ', book), null);
  assert.equal(parseReaderHash('#leer/unknown', book).chapterId, 'prologo');
  assert.equal(parseReaderHash('#leer/prologo/not-a-block', book).blockId, null);
});
