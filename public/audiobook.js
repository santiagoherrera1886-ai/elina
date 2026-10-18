import { SpeechNarrator, cleanAudioState } from './narration-core.js';

const AUDIO_KEY = 'elina.audio.v1';
export function mountAudiobook({ reader, book, openChapter, notify }) {
  const $ = selector => reader.querySelector(selector);
  const panel = $('#audio-panel');
  const play = $('#audio-play');
  const voiceSelect = $('#audio-voice');
  const chapterSelect = $('#audio-chapter');
  const seek = $('#audio-seek');
  let saved;
  try { saved = JSON.parse(localStorage.getItem(AUDIO_KEY) || 'null'); } catch { saved = null; }
  let preferences = cleanAudioState(book, saved);
  let currentChapter, voices = [], lastBlock = null, saveTimer, storageWarned = false, engaged = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const persist = () => {
    try { localStorage.setItem(AUDIO_KEY, JSON.stringify(preferences)); }
    catch { if (!storageWarned) { storageWarned = true; notify('Tu navegador no permite guardar el punto del audio. Puedes seguir escuchando durante esta sesión.'); } }
  };
  const narration = new SpeechNarrator({
    synth:window.speechSynthesis, Utterance:window.SpeechSynthesisUtterance,
    onChange:render,
    onComplete() {
      const next = book.chapters[book.chapters.indexOf(currentChapter) + 1];
      if (next) { openChapter({ chapterId:next.id }); narration.play(); }
      else { $('#audio-status').textContent = 'Fin de la primera parte. Gracias por escuchar.'; notify('Has llegado al final de esta primera parte. Gracias por escuchar.'); }
    },
    onError(code) {
      const message = code === 'not-allowed' || code === 'start-timeout'
        ? 'Pulsa reproducir para iniciar la voz. Si no suena, cambia de voz o abre la página en tu navegador habitual.'
        : 'La voz se interrumpió. Revisa el sonido y la conexión, prueba otra voz y pulsa reproducir para continuar.';
      $('#audio-status').textContent = message; notify(message);
    },
  });

  function render(snapshot) {
    if (!currentChapter) return;
    if (engaged) {
      preferences.chapterId = currentChapter.id;
      preferences.index = snapshot.index; preferences.offset = snapshot.offset;
      clearTimeout(saveTimer);
      if (snapshot.status === 'playing') saveTimer = setTimeout(persist, 700);
      else persist();
    }
    const active = snapshot.status === 'playing' || snapshot.status === 'loading';
    play.setAttribute('aria-label', active ? 'Pausar audiolibro' : 'Reproducir audiolibro');
    play.setAttribute('aria-pressed', String(active));
    $('#audio-play-icon').setAttribute('href', active ? '#i-pause' : '#i-play');
    $('#audio-play-label').textContent = snapshot.status === 'loading' ? 'Iniciando…' : active ? 'Pausar' : 'Reproducir';
    $('#audio-previous').disabled = snapshot.index === 0 || !narration.supported;
    $('#audio-next').disabled = snapshot.index >= snapshot.count - 1 || !narration.supported;
    seek.max = Math.max(0, snapshot.count - 1);
    seek.value = snapshot.index;
    const percent = Math.round(snapshot.progress * 100);
    seek.setAttribute('aria-valuetext', `${percent}% de ${currentChapter.title}`);
    $('#audio-progress-label').textContent = `${percent}% del capítulo`;
    const duration = Math.max(1, Math.ceil(currentChapter.words / (160 * preferences.rate)));
    $('#audio-duration').textContent = `~${duration} min a ${preferences.rate.toLocaleString('es')}×`;
    const statuses = { ready:'Pulsa reproducir para escuchar.', loading:'Preparando la voz…', playing:'Escuchando', paused:'En pausa. Continúa cuando quieras.', ended:'Capítulo completado.', error:'La narración está detenida.' };
    $('#audio-status').textContent = narration.supported ? statuses[snapshot.status] || '' : 'La narración no está disponible en este navegador. Abre el libro en un navegador con lectura en voz alta.';
    const blockId = panel.hidden || !['playing','paused'].includes(snapshot.status) ? null : snapshot.segment?.blockId;
    if (lastBlock !== blockId) {
      if (lastBlock) document.getElementById(lastBlock)?.classList.remove('audio-active');
      lastBlock = blockId;
      const block = blockId && document.getElementById(blockId);
      block?.classList.add('audio-active');
      if (block && preferences.follow && snapshot.status === 'playing') {
        const rect = block.getBoundingClientRect();
        const area = $('#reader-scroll').getBoundingClientRect();
        if (rect.top < area.top + 20 || rect.top > area.bottom - 90) block.scrollIntoView({ block:'start', behavior:reducedMotion.matches ? 'instant' : 'smooth' });
      }
    }
  }

  function refreshVoices() {
    if (!narration.supported) return;
    const all = window.speechSynthesis.getVoices();
    voices = all.filter(voice => /^es(?:-|_|$)/i.test(voice.lang));
    const rank = voice => (/^es-CO$/i.test(voice.lang) ? 30 : /^es-(MX|US)$/i.test(voice.lang) ? 20 : 0) + (voice.default ? 5 : 0);
    voices.sort((a,b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
    voiceSelect.replaceChildren();
    const automatic = document.createElement('option');
    automatic.value = ''; automatic.textContent = voices.length ? 'Español · selección automática' : 'Español · voz del dispositivo';
    voiceSelect.append(automatic);
    voices.forEach(voice => {
      const option = document.createElement('option'); option.value = voice.voiceURI;
      option.textContent = `${voice.name} · ${voice.lang}`; voiceSelect.append(option);
    });
    if (!voices.some(voice => voice.voiceURI === preferences.voiceURI)) preferences.voiceURI = '';
    voiceSelect.value = preferences.voiceURI;
    const voice = voices.find(voice => voice.voiceURI === preferences.voiceURI) || voices[0] || null;
    if (narration.voice?.voiceURI !== voice?.voiceURI) narration.setOptions({ voice });
  }

  for (const chapter of book.chapters) {
    const option = document.createElement('option'); option.value = chapter.id;
    option.textContent = `${chapter.label} · ${chapter.title}`; chapterSelect.append(option);
  }
  $('#audio-speed').value = String(preferences.rate);
  if (!$('#audio-speed').value) { preferences.rate = 1; $('#audio-speed').value = '1'; }
  $('#audio-follow').checked = preferences.follow;
  narration.rate = preferences.rate;
  play.disabled = !narration.supported;
  seek.disabled = !narration.supported;
  voiceSelect.disabled = !narration.supported;
  $('#audio-speed').disabled = !narration.supported;
  refreshVoices();
  window.speechSynthesis?.addEventListener('voiceschanged', refreshVoices);

  play.addEventListener('click', () => {
    engaged = true;
    if (narration.active) narration.pause();
    else narration.play(); // Synchronous user gesture, important for mobile browsers.
  });
  $('#audio-previous').addEventListener('click', () => narration.seek(narration.index - 1));
  $('#audio-next').addEventListener('click', () => narration.seek(narration.index + 1));
  seek.addEventListener('input', () => { if (narration.active) narration.pause(); });
  seek.addEventListener('change', () => narration.seek(Number(seek.value)));
  chapterSelect.addEventListener('change', () => openChapter({ chapterId:chapterSelect.value }));
  $('#audio-speed').addEventListener('change', event => {
    preferences.rate = Number(event.target.value); narration.setOptions({ rate:preferences.rate }); render(narration.snapshot()); persist();
  });
  voiceSelect.addEventListener('change', () => {
    preferences.voiceURI = voiceSelect.value;
    narration.setOptions({ voice:voices.find(voice => voice.voiceURI === preferences.voiceURI) || voices[0] || null }); persist();
  });
  $('#audio-follow').addEventListener('change', event => { preferences.follow = event.target.checked; persist(); });
  $('#audio-from-here').addEventListener('click', () => {
    engaged = true;
    const top = $('#reader-scroll').getBoundingClientRect().top;
    let block;
    for (const candidate of reader.querySelectorAll('#reader-article [data-block]')) {
      if (candidate.getBoundingClientRect().top <= top + 70) block = candidate;
      else { block ||= candidate; break; }
    }
    const index = narration.segments.findIndex(segment => segment.blockId === block?.id);
    narration.seek(Math.max(0, index)); narration.play();
  });
  $('#audio-from-here').disabled = !narration.supported;
  $('#audio-hide').addEventListener('click', hide);
  $('#toggle-audio').addEventListener('click', () => panel.hidden ? show() : hide());
  window.addEventListener('pagehide', () => { narration.pause(); persist(); });
  // Background synthesis differs by platform; pause visibly and preserve the position.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { narration.pause(); persist(); }
  });

  function show() {
    engaged = true;
    panel.hidden = false;
    $('#toggle-audio').setAttribute('aria-expanded', 'true');
    render(narration.snapshot());
    play.focus({ preventScroll:true });
  }
  function hide() {
    narration.pause(); panel.hidden = true;
    engaged = false;
    $('#toggle-audio').setAttribute('aria-expanded', 'false');
    render(narration.snapshot());
    $('#toggle-audio').focus({ preventScroll:true });
  }
  return {
    show, hide,
    pause() { narration.pause(); persist(); engaged = false; },
    resumeTarget() { return preferences.chapterId; },
    onReaderChapterChanged(chapter, position = {}) {
      const changed = currentChapter?.id !== chapter.id;
      currentChapter = chapter; chapterSelect.value = chapter.id;
      lastBlock = undefined;
      if (changed) {
        const resume = preferences.chapterId === chapter.id;
        narration.load(chapter, resume ? preferences.index : 0, resume ? preferences.offset : 0);
      }
      if (position.blockId && !panel.hidden) {
        const index = narration.segments.findIndex(segment => segment.blockId === position.blockId);
        if (index >= 0) narration.seek(index);
      }
      render(narration.snapshot());
    },
  };
}
