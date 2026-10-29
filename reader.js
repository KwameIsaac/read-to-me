// reader.js — sentence splitting + TTS playback engine
//
// Some browsers (seen on Huawei Browser, which lacks Google services and
// therefore has no system TTS engine registered) have NO `speechSynthesis`
// global at all — referencing it throws ReferenceError and crashes the
// whole script. So TTS is split into two backends, chosen at runtime:
//   - "native": the real Web Speech API (better voices, used when present)
//   - "mespeak": meSpeak.js, a 100% pure-JS/WASM-free TTS engine (eSpeak
//     ported to JS) loaded from CDN on demand — works even with no native
//     TTS support at all, just with a more robotic voice.
// Nothing in this file may reference `speechSynthesis` or
// `SpeechSynthesisUtterance` outside of the "native" branches below.

const TTS_HAS_NATIVE = (typeof window !== "undefined") &&
  !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;

const MESPEAK_JS_URL = "vendor/mespeak/mespeak.js";
const MESPEAK_VOICE_URL = "vendor/mespeak/voices/en/en-us.json";

let _mespeakReadyPromise = null;
function loadMeSpeak() {
  if (_mespeakReadyPromise) return _mespeakReadyPromise;
  _mespeakReadyPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MESPEAK_JS_URL;
    script.onload = () => {
      try {
        window.meSpeak.loadVoice(MESPEAK_VOICE_URL, (success) => {
          if (success) resolve();
          else reject(new Error("meSpeak voice failed to load"));
        });
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () => reject(new Error("Couldn't load the fallback speech engine (meSpeak) — check your internet connection."));
    document.head.appendChild(script);
  });
  return _mespeakReadyPromise;
}

// Call once at app start. Resolves when whichever backend is available
// is ready to speak. Never throws past this point for TTS-support reasons.
function initTTSBackend() {
  if (TTS_HAS_NATIVE) return Promise.resolve("native");
  return loadMeSpeak().then(() => "mespeak");
}

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
    this.voice = null; // native SpeechSynthesisVoice, when backend === "native"
    this.backend = TTS_HAS_NATIVE ? "native" : "mespeak";
    this.onSentenceChange = null;
    this.onChapterEnd = null;
    this.onStateChange = null;
    this._keepAliveTimer = null;
    this._meSpeakId = null;
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
    if (this.onSentenceChange) this.onSentenceChange(idx);

    if (this.backend === "native") {
      this._speakCurrentNative(idx);
    } else {
      this._speakCurrentMeSpeak(idx);
    }
  }

  _speakCurrentNative(idx) {
    const utter = new SpeechSynthesisUtterance(this.sentences[idx]);
    utter.rate = this.rate;
    if (this.voice) utter.voice = this.voice;

    utter.onend = () => {
      if (!this.isPlaying) return; // paused/stopped mid-utterance
      this.book.sentenceIndex++;
      this._persist();
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
  }

  _speakCurrentMeSpeak(idx) {
    // meSpeak speed: ~80 (slow) .. 390 (fast) words/min, default ~175.
    const speed = Math.round(175 * this.rate);
    this._meSpeakId = window.meSpeak.speak(this.sentences[idx], {
      speed: Math.max(80, Math.min(390, speed)),
      amplitude: 100
    }, (success) => {
      if (!this.isPlaying) return; // paused/stopped mid-utterance
      this.book.sentenceIndex++;
      this._persist();
      this._speakCurrent();
    });
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
    if (this.backend === "native") {
      speechSynthesis.cancel();
    } else if (window.meSpeak) {
      window.meSpeak.stop(this._meSpeakId || undefined);
    }
    this._stopKeepAlive();
    if (this.onStateChange) this.onStateChange(false);
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  skipSentence(delta) {
    const wasPlaying = this.isPlaying;
    if (this.backend === "native") {
      speechSynthesis.cancel();
    } else if (window.meSpeak) {
      window.meSpeak.stop(this._meSpeakId || undefined);
    }
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
  // (Not needed for the meSpeak backend.)
  _startKeepAlive() {
    if (this.backend !== "native") return;
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
