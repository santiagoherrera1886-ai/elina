// Small, sentence-aware utterances avoid browser limits on long speech requests.
export function speechSegments(chapter, maxLength = 180) {
  const segments = [];
  const blocks = [{ id: null, type:'title', text:`${chapter.label}. ${chapter.title}.` }, ...chapter.blocks];
  for (const block of blocks) {
    if (!block.text) continue;
    let text = block.text;
    if (block.type === 'heading') {
      text = text.replace(/^[IVXLCDM]+\.\s*/, '').toLocaleLowerCase('es');
      text = text.charAt(0).toLocaleUpperCase('es') + text.slice(1) + '.';
    }
    let chunk = '';
    const emit = () => { if (chunk) segments.push({ text:chunk, blockId:block.id, page:block.page || chapter.page }); chunk = ''; };
    for (const word of text.trim().split(/\s+/u)) {
      if (chunk && chunk.length + word.length + 1 > maxLength) emit();
      chunk += (chunk ? ' ' : '') + word;
      if (chunk.length > 40 && /[.!?…][»”"')]*$/u.test(word)) emit();
    }
    emit();
  }
  return segments;
}

export function cleanAudioState(book, value) {
  const data = value && typeof value === 'object' ? value : {};
  const chapter = book.chapters.find(chapter => chapter.id === data.chapterId) || book.chapters[0];
  const segments = speechSegments(chapter);
  const index = Number.isInteger(data.index) ? Math.max(0, Math.min(segments.length - 1, data.index)) : 0;
  return {
    chapterId:chapter.id, index,
    offset:Number.isInteger(data.offset) ? Math.max(0, Math.min(segments[index].text.length, data.offset)) : 0,
    rate:Number.isFinite(data.rate) ? Math.max(.75, Math.min(1.5, data.rate)) : 1,
    voiceURI:typeof data.voiceURI === 'string' ? data.voiceURI.slice(0, 250) : '',
    follow:data.follow !== false,
  };
}

export class SpeechNarrator {
  constructor({ synth, Utterance, onChange = () => {}, onComplete = () => {}, onError = () => {} }) {
    this.synth = synth; this.Utterance = Utterance;
    this.onChange = onChange; this.onComplete = onComplete; this.onError = onError;
    this.segments = []; this.index = 0; this.offset = 0; this.token = 0;
    this.status = 'idle'; this.rate = 1; this.voice = null; this.utterance = null;
  }
  get supported() { return !!this.synth && typeof this.Utterance === 'function'; }
  get active() { return this.status === 'playing' || this.status === 'loading'; }
  snapshot() {
    const total = this.segments.reduce((sum, segment) => sum + segment.text.length, 0);
    const before = this.segments.slice(0, this.index).reduce((sum, segment) => sum + segment.text.length, 0);
    return { status:this.status, index:this.index, offset:this.offset, count:this.segments.length,
      segment:this.segments[this.index], progress:total ? (before + this.offset) / total : 0 };
  }
  emit() { this.onChange(this.snapshot()); }
  cancel() {
    this.token++;
    clearTimeout(this.startTimer);
    this.utterance = null;
    if (this.supported) this.synth.cancel();
  }
  load(chapter, index = 0, offset = 0) {
    this.cancel(); this.chapter = chapter;
    this.segments = speechSegments(chapter);
    this.index = Math.max(0, Math.min(this.segments.length - 1, index));
    this.offset = Math.max(0, Math.min(this.segments[this.index].text.length, offset));
    this.status = 'ready'; this.emit();
  }
  play() {
    if (!this.supported || !this.segments.length || this.active) return;
    if (this.status === 'ended') { this.index = 0; this.offset = 0; }
    this.speakCurrent();
  }
  speakCurrent() {
    this.cancel();
    const token = this.token;
    const segment = this.segments[this.index];
    if (!segment) return;
    if (this.offset >= segment.text.length) { this.offset = 0; this.advance(); return; }
    const start = this.offset;
    const utterance = new this.Utterance(segment.text.slice(start));
    this.utterance = utterance; // Keep a strong reference until completion.
    utterance.lang = this.voice?.lang || 'es-CO';
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = this.rate;
    utterance.pitch = 1;
    utterance.onstart = () => { if (token !== this.token) return; clearTimeout(this.startTimer); this.status = 'playing'; this.emit(); };
    utterance.onboundary = event => {
      if (token !== this.token || !Number.isFinite(event.charIndex)) return;
      this.offset = Math.min(segment.text.length, start + event.charIndex); this.emit();
    };
    utterance.onend = () => { if (token !== this.token || !this.active) return; clearTimeout(this.startTimer); this.advance(); };
    utterance.onerror = event => {
      if (token !== this.token) return;
      this.cancel(); this.status = 'error'; this.emit(); this.onError(event.error || 'synthesis-failed');
    };
    this.status = 'loading'; this.emit();
    this.startTimer = setTimeout(() => {
      if (token !== this.token || this.status !== 'loading') return;
      this.cancel(); this.status = 'error'; this.emit(); this.onError('start-timeout');
    }, 8000);
    this.startTimer?.unref?.();
    try { this.synth.speak(utterance); }
    catch { this.cancel(); this.status = 'error'; this.emit(); this.onError('synthesis-failed'); }
  }
  advance() {
    if (this.index + 1 < this.segments.length) {
      this.index++; this.offset = 0; this.speakCurrent();
    } else {
      this.offset = this.segments[this.index].text.length;
      this.status = 'ended'; this.utterance = null; this.emit(); this.onComplete();
    }
  }
  pause() {
    if (!this.active) return;
    // cancel + saved word boundary is consistent on browsers where pause acts as stop.
    this.cancel(); this.status = 'paused'; this.emit();
  }
  seek(index, offset = 0) {
    const resume = this.active;
    this.cancel();
    this.index = Math.max(0, Math.min(this.segments.length - 1, index));
    this.offset = Math.max(0, Math.min(this.segments[this.index].text.length, offset));
    this.status = 'paused'; this.emit();
    if (resume) this.speakCurrent();
  }
  setOptions({ rate = this.rate, voice = this.voice }) {
    const resume = this.active;
    if (resume) this.pause();
    this.rate = Math.max(.75, Math.min(1.5, rate)); this.voice = voice;
    if (resume) this.play();
  }
}
