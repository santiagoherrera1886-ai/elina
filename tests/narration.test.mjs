import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { speechSegments, cleanAudioState, SpeechNarrator } from '../public/narration-core.js';
const book = JSON.parse(await readFile(new URL('../public/data/book.json', import.meta.url), 'utf8'));
const compact = text => text.replace(/\s+/gu, '');
function setup(chapter = book.chapters[0]) {
  const spoken = [], errors = [];
  let completes = 0;
  const synth = { cancel() {}, speak(utterance) { spoken.push(utterance); utterance.onstart(); } };
  class Utterance { constructor(text) { this.text = text; } }
  const narrator = new SpeechNarrator({ synth, Utterance, onError:error => errors.push(error), onComplete:() => completes++ });
  narrator.load(chapter);
  return { narrator, spoken, errors, completes:() => completes };
}
test('narration covers every paragraph of all six reading sections without losing words', () => {
  for (const chapter of book.chapters) {
    const segments = speechSegments(chapter);
    assert.ok(segments.every(segment => segment.text.length <= 180));
    for (const block of chapter.blocks.filter(block => ['paragraph','epigraph','ending'].includes(block.type))) {
      const actual = segments.filter(segment => segment.blockId === block.id).map(segment => segment.text).join(' ');
      assert.equal(compact(actual), compact(block.text), block.id);
    }
  }
});
test('pause and resume keep the word boundary and discard stale end/error events', () => {
  const { narrator, spoken, errors } = setup();
  narrator.play();
  const old = spoken.at(-1);
  old.onboundary({ charIndex:8 });
  narrator.pause();
  assert.equal(narrator.status, 'paused');
  old.onend(); old.onerror({ error:'canceled' });
  assert.equal(spoken.length, 1);
  assert.deepEqual(errors, []);
  narrator.play();
  assert.equal(spoken.at(-1).text, narrator.segments[0].text.slice(8));
  narrator.pause();
});
test('changing the playing position cancels the old queue and starts the selected text', () => {
  const { narrator, spoken } = setup();
  narrator.play(); const old = spoken.at(-1);
  narrator.seek(4);
  assert.equal(spoken.at(-1).text, narrator.segments[4].text);
  old.onend();
  assert.equal(narrator.index, 4);
  narrator.pause();
});
test('voice and speed changes retain the current position', () => {
  const { narrator, spoken } = setup();
  narrator.play(); spoken.at(-1).onboundary({ charIndex:5 });
  const voice = { voiceURI:'test-spanish', lang:'es-CO' };
  narrator.setOptions({ rate:1.3, voice });
  assert.equal(spoken.at(-1).rate, 1.3);
  assert.equal(spoken.at(-1).voice, voice);
  assert.equal(spoken.at(-1).text, narrator.segments[0].text.slice(5));
  narrator.pause();
});
test('a chapter completes exactly once at 100 percent, without queuing an extra utterance', () => {
  const chapter = { label:'Prólogo', title:'Inicio', page:5, blocks:[{ id:'p1', type:'paragraph', text:'El primer recuerdo.' }] };
  const { narrator, spoken, completes } = setup(chapter);
  narrator.play();
  while (narrator.active) spoken.at(-1).onend();
  assert.equal(completes(), 1);
  assert.equal(narrator.snapshot().progress, 1);
  const count = spoken.length;
  spoken.at(-1).onend();
  assert.equal(spoken.length, count);
  assert.equal(completes(), 1);
});
test('speech failures stop playback visibly and allow an explicit retry', () => {
  const { narrator, spoken, errors } = setup();
  narrator.play(); spoken.at(-1).onerror({ error:'not-allowed' });
  assert.equal(narrator.status, 'error');
  assert.deepEqual(errors, ['not-allowed']);
  narrator.play(); assert.equal(narrator.status, 'playing'); narrator.pause();
});
test('loading another chapter cancels old speech before preparing the new chapter', () => {
  const { narrator, spoken } = setup();
  narrator.play(); const previous = spoken.at(-1);
  narrator.load(book.chapters[4]);
  previous.onend();
  assert.equal(narrator.status, 'ready');
  assert.equal(spoken.length, 1);
  narrator.play(); assert.match(spoken.at(-1).text, /La ciudad y la libertad/); narrator.pause();
});
test('corrupt audio state and unavailable speech do not break reading', () => {
  const safe = cleanAudioState(book, { chapterId:'invalid', index:999999, offset:-5, rate:Infinity, voiceURI:12 });
  assert.equal(safe.chapterId, 'prologo'); assert.equal(safe.rate, 1); assert.equal(safe.offset, 0);
  const narrator = new SpeechNarrator({ synth:undefined, Utterance:undefined });
  narrator.load(book.chapters[0]); assert.equal(narrator.supported, false);
  assert.doesNotThrow(() => narrator.play());
});
