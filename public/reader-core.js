export const STORAGE_KEY = 'elina.reader.v1';
export const themes = ['light', 'sepia', 'dark'];
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const normalizeText = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

export function findChapter(book, id) {
  return book.chapters.find(chapter => chapter.id === id) ?? book.chapters[0];
}

export function validPosition(book, value) {
  if (!value || typeof value !== 'object') return null;
  const chapter = book.chapters.find(chapter => chapter.id === value.chapterId);
  if (!chapter) return null;
  const block = chapter.blocks.find(block => block.id === value.blockId);
  return {
    chapterId: chapter.id,
    blockId: block?.id ?? null,
    offset: Number.isFinite(value.offset) ? clamp(value.offset, 0, 1) : 0,
    ratio: Number.isFinite(value.ratio) ? clamp(value.ratio, 0, 1) : 0,
  };
}

export function sanitizeState(book, value) {
  const source = value && typeof value === 'object' ? value : {};
  const bookmarks = Array.isArray(source.bookmarks) ? source.bookmarks : [];
  return {
    theme: themes.includes(source.theme) ? source.theme : 'light',
    fontSize: Number.isFinite(source.fontSize) ? clamp(source.fontSize, 17, 29) : 21,
    position: validPosition(book, source.position),
    bookmarks: [...new Map(bookmarks.map(value => validPosition(book, value)).filter(value => value?.blockId).map(value => [`${value.chapterId}:${value.blockId}`, value])).values()].slice(0, 300),
  };
}

export function overallProgress(book, chapterId, ratio) {
  const index = Math.max(0, book.chapters.findIndex(chapter => chapter.id === chapterId));
  const before = book.chapters.slice(0, index).reduce((sum, chapter) => sum + chapter.words, 0);
  const total = book.chapters.reduce((sum, chapter) => sum + chapter.words, 0);
  return total ? clamp((before + book.chapters[index].words * clamp(ratio, 0, 1)) / total * 100, 0, 100) : 0;
}

export function parseReaderHash(hash, book) {
  let parts;
  try { parts = decodeURIComponent(hash).replace(/^#/, '').split('/'); } catch { return null; }
  if (parts[0] !== 'leer') return null;
  const chapter = findChapter(book, parts[1]);
  const block = chapter.blocks.find(block => block.id === parts[2]);
  return { chapterId: chapter.id, blockId: block?.id ?? null, offset: 0, ratio: 0 };
}

export function searchBook(book, query, limit = 70) {
  const needle = normalizeText(query.trim());
  if (needle.length < 2) return { total: 0, matches: [] };
  const matches = [];
  let total = 0;
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      if (!block.text) continue;
      const start = normalizeText(block.text).indexOf(needle);
      if (start < 0) continue;
      total++;
      if (matches.length >= limit) continue;
      const excerptStart = Math.max(0, start - 40);
      const excerptEnd = Math.min(block.text.length, start + needle.length + 85);
      matches.push({ chapterId: chapter.id, chapterLabel: chapter.label, blockId: block.id,
        before: (excerptStart ? '…' : '') + block.text.slice(excerptStart, start),
        match: block.text.slice(start, start + needle.length),
        after: block.text.slice(start + needle.length, excerptEnd) + (excerptEnd < block.text.length ? '…' : ''), page: block.page });
    }
  }
  return { total, matches };
}
