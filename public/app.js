import { STORAGE_KEY, sanitizeState, findChapter, overallProgress, parseReaderHash, searchBook, clamp } from './reader-core.js';

const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
const reader = $('#reader');
const scroller = $('#reader-scroll');
const article = $('#reader-article');
const sidebarContent = $('#sidebar-content');
const searchInput = $('#book-search');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobile = window.matchMedia('(max-width: 760px)');
let book, state, currentChapter, bookPromise;
let previousHash = '#inicio', returnFocus = null, tab = 'index';
let restoring = false, renderVersion = 0, saveTimer, searchTimer, toastTimer;
let storageAvailable = true, lastReadingBlock = null;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  // A modal dialog sits in the top layer, so put its feedback inside the dialog.
  if (reader.open) reader.append(toast);
  else document.body.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3800);
}

function persist() {
  if (!state) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch {
    if (storageAvailable) notify('Este navegador no permite guardar. Puedes seguir leyendo; el progreso durará esta sesión.');
    storageAvailable = false;
  }
}

async function loadBook() {
  if (book) return book;
  if (bookPromise) return bookPromise;
  bookPromise = (async () => {
    const response = await fetch(new URL('data/book.json', import.meta.url));
    if (!response.ok) throw new Error(`Book request failed: ${response.status}`);
    const content = await response.json();
    if (!Array.isArray(content.chapters) || content.chapters.length !== 6) throw new Error('Invalid book data');
    book = content;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch { saved = null; }
    state = sanitizeState(book, saved);
    $$('[data-time]').forEach(element => {
      element.textContent = String(book.chapters[Number(element.dataset.time)].minutes);
    });
    updateResumeLabel();
    applyPreferences();
    return book;
  })().catch(error => { bookPromise = null; throw error; });
  return bookPromise;
}

function updateResumeLabel() {
  $$('[data-resume-label]').forEach(element => { element.textContent = state?.position ? 'Continuar leyendo' : 'Comenzar a leer'; });
}

function setSidebar(open) {
  reader.classList.toggle('sidebar-visible', open);
  reader.classList.toggle('sidebar-hidden', !open);
  $('#toggle-sidebar').setAttribute('aria-expanded', String(open));
  $('#toggle-sidebar').setAttribute('aria-label', open ? 'Ocultar índice y búsqueda' : 'Mostrar índice y búsqueda');
  const sidebar = $('#reader-sidebar');
  sidebar.inert = !open;
}

function applyPreferences() {
  if (!state) return;
  reader.dataset.theme = state.theme;
  reader.style.setProperty('--read-size', `${state.fontSize}px`);
  $('#font-size').value = state.fontSize;
  $$('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.theme)));
}

function routeFor(position) {
  return `#leer/${position.chapterId}${position.blockId ? `/${position.blockId}` : ''}`;
}

async function openReader(target = 'resume', { fromRoute = false } = {}) {
  const wasOpen = reader.open;
  if (!wasOpen) {
    returnFocus = document.activeElement;
    if (!location.hash.startsWith('#leer')) previousHash = location.hash || '#inicio';
    reader.showModal();
    document.body.classList.add('reader-open');
    setSidebar(!mobile.matches);
  }
  try {
    await loadBook();
    const requested = typeof target === 'object' ? target : target === 'resume' ? state.position || { chapterId: book.chapters[0].id } : { chapterId: target };
    const position = { ...requested, chapterId: findChapter(book, requested.chapterId).id };
    if (!wasOpen && !fromRoute) history.pushState({ reader: true }, '', routeFor(position));
    renderChapter(position, { updateRoute: !fromRoute });
    if (!wasOpen) $('#close-reader').focus({ preventScroll: true });
  } catch {
    article.replaceChildren();
    const box = el('div', 'reader-load-error');
    box.append(el('h1', '', 'La historia sigue aquí.'), el('p', '', 'No pudimos abrir el lector. Revisa tu conexión e inténtalo de nuevo, o abre el PDF original.'));
    const retry = el('button', 'button primary', 'Volver a intentar');
    retry.addEventListener('click', () => openReader(target, { fromRoute }));
    const pdf = el('a', 'button secondary', 'Abrir el PDF');
    pdf.href = 'assets/la-nina-de-la-montana.pdf';
    pdf.target = '_blank'; pdf.rel = 'noopener';
    box.append(retry, document.createTextNode(' '), pdf);
    article.append(box);
    $('#previous-chapter').disabled = true;
    $('#next-chapter').disabled = true;
  }
}

function closeReader({ fromRoute = false } = {}) {
  if (!reader.open) return;
  savePosition();
  reader.close();
  document.body.classList.remove('reader-open');
  $('#reader-settings').hidden = true;
  $('#toggle-settings').setAttribute('aria-expanded', 'false');
  document.body.append($('#toast'));
  if (!fromRoute && location.hash.startsWith('#leer')) history.replaceState({}, '', previousHash);
  updateResumeLabel();
  returnFocus?.focus?.({ preventScroll: true });
}

function renderChapter(position, { updateRoute = true } = {}) {
  const version = ++renderVersion;
  restoring = true;
  lastReadingBlock = undefined;
  currentChapter = findChapter(book, position.chapterId);
  article.replaceChildren();
  const kicker = el('div', 'reader-chapter-kicker');
  kicker.append(el('span', '', currentChapter.label), el('small', '', `${currentChapter.minutes} min de lectura aprox.`));
  article.append(kicker, el('h1', '', currentChapter.title), el('div', 'chapter-divider'));
  let isFirst = true;
  currentChapter.blocks.forEach(block => {
    let node;
    if (block.type === 'image') {
      node = el('figure');
      const img = el('img');
      img.src = block.src; img.alt = block.alt;
      const dimensions = block.src.includes('freedom-ink') ? [1101, 614] : [1101, 1641];
      img.width = dimensions[0]; img.height = dimensions[1];
      img.loading = 'lazy';
      node.append(img, el('figcaption', '', `Ilustración de la edición original · Página ${block.page}`));
    } else if (block.type === 'heading') node = el('h2', '', block.text);
    else if (block.type === 'epigraph') node = el('div', 'reader-epigraph', block.text);
    else if (block.type === 'ending') node = el('div', 'reader-ending', block.text);
    else {
      node = el('p', `book-paragraph${isFirst ? ' first-paragraph' : ''}`, block.text);
      isFirst = false;
    }
    node.id = block.id;
    node.dataset.block = block.id;
    node.dataset.page = block.page;
    article.append(node);
  });
  $('#reader-chapter-label').textContent = `${currentChapter.label} · ${currentChapter.title}`;
  const index = book.chapters.indexOf(currentChapter);
  $('#previous-chapter').disabled = index === 0;
  $('#next-chapter').disabled = false;
  $('#next-chapter').textContent = index === book.chapters.length - 1 ? 'Terminar esta parte ✓' : 'Siguiente capítulo →';
  renderSidebar();
  if (mobile.matches) setSidebar(false);
  if (updateRoute) history.replaceState({ reader: true }, '', routeFor(position));
  requestAnimationFrame(() => {
    if (version !== renderVersion) return;
    restorePosition(position);
    requestAnimationFrame(() => {
      if (version !== renderVersion) return;
      restoring = false;
      savePosition();
      updateProgress();
    });
  });
}

function capturePosition() {
  if (!currentChapter || !reader.open) return state?.position || null;
  const bounds = scroller.getBoundingClientRect();
  const blocks = $$('[data-block]', article);
  let active = blocks[0];
  for (const block of blocks) {
    if (block.getBoundingClientRect().top <= bounds.top + 42) active = block;
    else break;
  }
  const rect = active?.getBoundingClientRect();
  const offset = rect ? clamp((bounds.top + 24 - rect.top) / Math.max(rect.height, 1), 0, 1) : 0;
  const range = scroller.scrollHeight - scroller.clientHeight;
  const ratio = range > 0 ? clamp(scroller.scrollTop / range, 0, 1) : 1;
  return { chapterId: currentChapter.id, blockId: scroller.scrollTop < 90 ? null : active?.id || null, offset, ratio };
}

function restorePosition(position) {
  const target = position.blockId ? document.getElementById(position.blockId) : null;
  if (target && article.contains(target)) {
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, top + (position.offset || 0) * target.getBoundingClientRect().height - 24);
  } else scroller.scrollTop = (position.ratio || 0) * (scroller.scrollHeight - scroller.clientHeight);
}

function savePosition() {
  if (!state || !currentChapter || restoring || !reader.open) return;
  state.position = capturePosition();
  persist();
}

function updateProgress() {
  if (!currentChapter || !state || restoring) return;
  const position = capturePosition();
  const progress = Math.round(overallProgress(book, currentChapter.id, position.ratio));
  $('#reading-percent').textContent = `${progress}%`;
  $('#reading-progress-bar').style.width = `${progress}%`;
  $('.reading-progress').setAttribute('aria-valuenow', progress);
  const block = currentChapter.blocks.find(block => block.id === position.blockId);
  const page = block?.page || currentChapter.page;
  $('#reading-status').textContent = `${currentChapter.label} · Página de origen ${page} de ${book.pages}`;
  if (lastReadingBlock !== position.blockId) {
    lastReadingBlock = position.blockId;
    updateBookmarkButton(position);
  }
}

function updateBookmarkButton(position = capturePosition()) {
  const targetBlock = position?.blockId || currentChapter?.blocks[0]?.id;
  const saved = state?.bookmarks.some(mark => mark.chapterId === position?.chapterId && mark.blockId === targetBlock);
  $('#save-bookmark').classList.toggle('saved', !!saved);
  $('#save-bookmark').setAttribute('aria-pressed', String(!!saved));
  $('#save-bookmark').setAttribute('aria-label', saved ? 'Quitar el marcador de este punto' : 'Guardar un marcador en este punto');
}

function chapterButton(chapter) {
  const button = el('button', `chapter-link${chapter.id === currentChapter?.id ? ' active' : ''}`);
  button.append(el('span', '', chapter.label), el('strong', '', chapter.title), el('small', '', `Página ${chapter.page} · ${chapter.minutes} min aprox.`));
  if (chapter.id === currentChapter?.id) button.setAttribute('aria-current', 'true');
  button.addEventListener('click', () => { savePosition(); renderChapter({ chapterId: chapter.id }); scroller.focus({ preventScroll: true }); });
  return button;
}

function renderSidebar() {
  if (!book || !state) return;
  sidebarContent.replaceChildren();
  $('#tab-index').classList.toggle('active', tab === 'index');
  $('#tab-bookmarks').classList.toggle('active', tab === 'bookmarks');
  $('#tab-index').setAttribute('aria-pressed', String(tab === 'index'));
  $('#tab-bookmarks').setAttribute('aria-pressed', String(tab === 'bookmarks'));
  const query = searchInput.value.trim();
  if (query.length > 0) {
    if (query.length < 2) { sidebarContent.append(el('p', 'sidebar-empty', 'Escribe al menos dos letras para buscar.')); return; }
    const results = searchBook(book, query);
    sidebarContent.append(el('p', 'search-count', results.total ? `${results.total} pasaje${results.total === 1 ? '' : 's'} encontrado${results.total === 1 ? '' : 's'}` : 'No encontramos esa palabra. Prueba con otra.'));
    results.matches.forEach(result => {
      const button = el('button', 'search-result');
      button.append(el('strong', '', `${result.chapterLabel} · Página ${result.page}`));
      const snippet = el('p');
      snippet.append(document.createTextNode(result.before), el('mark', '', result.match), document.createTextNode(result.after));
      button.append(snippet);
      button.addEventListener('click', () => { savePosition(); renderChapter({ chapterId: result.chapterId, blockId: result.blockId }); scroller.focus({ preventScroll: true }); });
      sidebarContent.append(button);
    });
    if (results.total > results.matches.length) sidebarContent.append(el('p', 'sidebar-empty', `Mostramos los primeros ${results.matches.length} pasajes. Escribe una frase más precisa para acotar la búsqueda.`));
    return;
  }
  if (tab === 'bookmarks') {
    if (!state.bookmarks.length) sidebarContent.append(el('p', 'sidebar-empty', 'Tus pasajes, a un toque. Pulsa el marcador de arriba mientras lees para guardar un punto y volver aquí después.'));
    state.bookmarks.forEach(mark => {
      const ch = findChapter(book, mark.chapterId);
      const block = ch.blocks.find(block => block.id === mark.blockId);
      const row = el('div', 'bookmark-row');
      const go = el('button');
      go.append(el('strong', '', ch.label), el('p', '', (block?.text || block?.alt || ch.title).slice(0, 110) + ((block?.text?.length || 0) > 110 ? '…' : '')));
      go.addEventListener('click', () => { savePosition(); renderChapter(mark); scroller.focus({ preventScroll: true }); });
      const remove = el('button', 'icon-button', '×');
      remove.setAttribute('aria-label', `Eliminar marcador de ${ch.label}`);
      remove.addEventListener('click', () => { state.bookmarks = state.bookmarks.filter(item => item !== mark); persist(); renderSidebar(); updateBookmarkButton(); notify('Marcador eliminado.'); });
      row.append(go, remove); sidebarContent.append(row);
    });
    return;
  }
  book.chapters.forEach(chapter => {
    sidebarContent.append(chapterButton(chapter));
    if (chapter.id !== currentChapter?.id) return;
    const sections = chapter.blocks.filter(block => block.type === 'heading');
    if (!sections.length) return;
    const list = el('div', 'subsection-links');
    sections.forEach(block => {
      const button = el('button', '', block.text);
      button.addEventListener('click', () => { renderChapter({ chapterId: chapter.id, blockId: block.id }); scroller.focus({ preventScroll: true }); });
      list.append(button);
    });
    sidebarContent.append(list);
  });
}

function navigateChapter(direction) {
  if (!currentChapter) return;
  savePosition();
  const next = book.chapters.indexOf(currentChapter) + direction;
  if (next >= book.chapters.length) {
    scroller.scrollTop = scroller.scrollHeight;
    savePosition();
    closeReader();
    notify('Fin de la primera parte. Gracias por acompañar esta historia.');
    return;
  }
  if (next < 0) return;
  renderChapter({ chapterId: book.chapters[next].id });
  scroller.focus({ preventScroll: true });
}

$$('[data-read]').forEach(button => button.addEventListener('click', () => openReader(button.dataset.read)));
$('#close-reader').addEventListener('click', () => closeReader());
reader.addEventListener('cancel', event => { event.preventDefault(); closeReader(); });
$('#toggle-sidebar').addEventListener('click', () => setSidebar($('#toggle-sidebar').getAttribute('aria-expanded') !== 'true'));
$('#sidebar-scrim').addEventListener('click', () => setSidebar(false));
mobile.addEventListener('change', () => { if (reader.open) setSidebar(!mobile.matches); });
$('#toggle-settings').addEventListener('click', () => {
  const settings = $('#reader-settings');
  settings.hidden = !settings.hidden;
  $('#toggle-settings').setAttribute('aria-expanded', String(!settings.hidden));
});
reader.addEventListener('click', event => {
  if (!event.target.closest('#reader-settings, #toggle-settings')) {
    $('#reader-settings').hidden = true;
    $('#toggle-settings').setAttribute('aria-expanded', 'false');
  }
});
$$('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
  if (!state) return;
  state.theme = button.dataset.themeChoice;
  applyPreferences(); persist();
}));
$('#font-size').addEventListener('input', event => {
  if (!state) return;
  const position = capturePosition();
  state.fontSize = Number(event.target.value);
  applyPreferences();
  restorePosition(position); savePosition(); persist();
});
$('#save-bookmark').addEventListener('click', () => {
  if (!state || !currentChapter) return;
  const position = capturePosition();
  position.blockId ||= currentChapter.blocks[0]?.id;
  const existing = state.bookmarks.find(mark => mark.chapterId === position.chapterId && mark.blockId === position.blockId);
  if (existing) state.bookmarks = state.bookmarks.filter(mark => mark !== existing);
  else state.bookmarks.unshift(position);
  state.bookmarks = state.bookmarks.slice(0, 300);
  persist(); renderSidebar(); updateBookmarkButton(position);
  notify(existing ? 'Marcador eliminado.' : 'Marcador guardado. Encuéntralo en el índice del lector.');
});
$('#tab-index').addEventListener('click', () => { tab = 'index'; searchInput.value = ''; renderSidebar(); });
$('#tab-bookmarks').addEventListener('click', () => { tab = 'bookmarks'; searchInput.value = ''; renderSidebar(); });
searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderSidebar, 160); });
$('#previous-chapter').addEventListener('click', () => navigateChapter(-1));
$('#next-chapter').addEventListener('click', () => navigateChapter(1));
scroller.addEventListener('scroll', () => {
  if (restoring) return;
  updateProgress();
  clearTimeout(saveTimer); saveTimer = setTimeout(savePosition, 180);
}, { passive: true });
window.addEventListener('pagehide', savePosition);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });

async function syncRoute() {
  if (!location.hash.startsWith('#leer')) { if (reader.open) closeReader({ fromRoute: true }); return; }
  try {
    await loadBook();
    const route = parseReaderHash(location.hash, book);
    if (route) await openReader(route, { fromRoute: true });
  } catch { await openReader('prologo', { fromRoute: true }); }
}
window.addEventListener('hashchange', syncRoute);
window.addEventListener('popstate', syncRoute);

// A real CSS book: its cover hinges open while the page block stays in place.
$('#book-open').addEventListener('input', event => {
  const fraction = Number(event.target.value) / 100;
  const object = $('#book-object');
  object.style.setProperty('--opening', `${-150 * fraction}deg`);
  object.style.setProperty('--book-shift', `${(mobile.matches ? 48 : 80) * fraction}px`);
  object.style.setProperty('--book-rotation', `${-17 + 28 * fraction}deg`);
});
$$('[data-demo-theme]').forEach(button => button.addEventListener('click', () => {
  $('#reading-demo').dataset.theme = button.dataset.demoTheme;
  $$('[data-demo-theme]').forEach(item => {
    const selected = item === button;
    item.classList.toggle('active', selected); item.setAttribute('aria-pressed', String(selected));
  });
}));
$('#share-book').addEventListener('click', async () => {
  const url = new URL(location.href); url.hash = '';
  const data = { title: 'La niña de la montaña', text: 'Hay vidas que merecen quedarse. Una historia de Santiago Herrera.', url: url.href };
  try {
    if (navigator.share) await navigator.share(data);
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url.href); notify('Enlace copiado. La historia está lista para compartir.'); }
    else notify('Copia la dirección de esta página para compartir el libro.');
  } catch (error) { if (error.name !== 'AbortError') notify('Puedes compartir el libro copiando la dirección de esta página.'); }
});

if ('IntersectionObserver' in window && !reducedMotion.matches) {
  document.body.classList.add('motion-ready');
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible'); observer.unobserve(entry.target);
  }), { threshold: .08 });
  $$('.reveal').forEach(element => observer.observe(element));
}
// Preload the text after the initial image; no PDF download is required to read.
if (location.hash.startsWith('#leer')) syncRoute();
else if ('requestIdleCallback' in window) requestIdleCallback(() => loadBook().catch(() => {}), { timeout: 1600 });
else setTimeout(() => loadBook().catch(() => {}), 500);
