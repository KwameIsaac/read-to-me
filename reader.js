// reader.js — sentence splitting + Web Speech API playback engine

function splitIntoSentences(text) {
  // Naive sentence splitter: good enough for TTS pacing, not perfect grammar.
  const cleaned = text.replace(/\s+\n/g, "\n").trim();
  const parts = cleaned.match(/[^.!?\n]+[.!?]+(\s+|$)|[^.!?\n]+$/g) || [cleaned];
  return parts.map(s => s.trim()).filter(Boolean);
}

class ReaderEngine {
  constructor() {
    this.book = null;
    this.sentences = [];
    this.isPlaying = false;
    this.rate = 1.0;
    this.voice = null;
    this.onSentenceChange = null;
    this.onChapterEnd = null;
    this.onStateChange = null;
    this._keepAliveTimer = null;
  }

  loadChapter(book, chapterIndex, startSentence = 0) {
    this.book = book;
    this.book.chapterIndex = chapterIndex;
    this.sentences = splitIntoSentences(book.chapters[chapterIndex].text);
    this.book.sentenceIndex = Math.min(startSentence, Math.max(this.sentences.length - 1, 0));
  }

  _speakCurrent() {
    if (!this.sentences.length) return;
    const idx = this.book.sentenceIndex;
    if (idx >= this.sentences.length) {
      this._handleChapterEnd();
      return;
    }
    const utter = new SpeechSynthesisUtterance(this.sentences[idx]);
    utter.rate = this.rate;
    if (this.voice) utter.voice = this.voice;

    utter.onend = () => {
      if (!this.isPlaying) return; // paused/stopped mid-utterance
      this.book.sentenceIndex++;
      this._persist();
      if (this.onSentenceChange) this.onSentenceChange(this.book.sentenceIndex);
      this._speakCurrent();
    };
    utter.onerror = () => {
      // skip bad sentence rather than stall forever
      if (!this.isPlaying) return;
      this.book.sentenceIndex++;
      this._speakCurrent();
    };

    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
    if (this.onSentenceChange) this.onSentenceChange(idx);
  }

  _handleChapterEnd() {
    this.pause();
    if (this.onChapterEnd) this.onChapterEnd();
  }

  play() {
    this.isPlaying = true;
    this._startKeepAlive();
    this._speakCurrent();
    if (this.onStateChange) this.onStateChange(true);
  }

  pause() {
    this.isPlaying = false;
    speechSynthesis.cancel();
    this._stopKeepAlive();
    if (this.onStateChange) this.onStateChange(false);
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  skipSentence(delta) {
    const wasPlaying = this.isPlaying;
    speechSynthesis.cancel();
    this.book.sentenceIndex = Math.max(0, Math.min(this.sentences.length - 1, this.book.sentenceIndex + delta));
    this._persist();
    if (this.onSentenceChange) this.onSentenceChange(this.book.sentenceIndex);
    if (wasPlaying) this._speakCurrent();
  }

  _persist() {
    if (this._onPersist) this._onPersist(this.book);
  }

  // Chrome/Edge pause speechSynthesis after ~15s of inactivity on some
  // platforms; nudging it keeps long-form reading from silently dying.
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveTimer = setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 10000);
  }
  _stopKeepAlive() {
    if (this._keepAliveTimer) clearInterval(this._keepAliveTimer);
    this._keepAliveTimer = null;
  }
}
