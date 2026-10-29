// app.js — UI wiring

const engine = new ReaderEngine();
engine._onPersist = (book) => dbPutBook(book);

let currentBook = null;

const $ = (sel) => document.querySelector(sel);
const libraryView = $("#libraryView");
const readerView = $("#readerView");
const libraryGrid = $("#libraryGrid");
const libraryEmpty = $("#libraryEmpty");
const fileInput = $("#fileInput");
const toast = $("#toast");

function showToast(msg, ms = 2500) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add("hidden"), ms);
}

function bookProgressPct(book) {
  const totalChapters = book.chapters.length || 1;
  return Math.min(100, Math.round(((book.chapterIndex || 0) / totalChapters) * 100));
}

async function renderLibrary() {
  const books = await dbGetAllBooks();
  books.sort((a, b) => b.addedAt - a.addedAt);
  libraryGrid.innerHTML = "";
  libraryEmpty.classList.toggle("hidden", books.length > 0);

  for (const book of books) {
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML = `
      <div class="book-emoji">📘</div>
      <div class="book-title">${escapeHtml(book.title)}</div>
      <div class="book-meta">${book.chapters.length} sections${book.author ? " · " + escapeHtml(book.author) : ""}</div>
      <div class="book-progress"><div class="book-progress-fill" style="width:${bookProgressPct(book)}%"></div></div>
    `;
    card.addEventListener("click", () => openBook(book.id));
    libraryGrid.appendChild(card);
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

async function openBook(id) {
  const book = await dbGetBook(id);
  if (!book) return;
  currentBook = book;
  libraryView.classList.add("hidden");
  readerView.classList.remove("hidden");
  $("#readerBookTitle").textContent = book.title;
  loadChapterIntoView(book.chapterIndex || 0, book.sentenceIndex || 0);
}

function loadChapterIntoView(chapterIndex, sentenceIndex) {
  chapterIndex = Math.max(0, Math.min(currentBook.chapters.length - 1, chapterIndex));
  engine.loadChapter(currentBook, chapterIndex, sentenceIndex);
  dbPutBook(currentBook);

  $("#readerChapterLabel").textContent =
    `${currentBook.chapters[chapterIndex].title} — ${chapterIndex + 1} of ${currentBook.chapters.length}`;

  const textEl = $("#readerText");
  textEl.innerHTML = engine.sentences
    .map((s, i) => `<span class="sentence" data-i="${i}">${escapeHtml(s)} </span>`)
    .join("");

  highlightSentence(currentBook.sentenceIndex || 0);
  updateProgressBar();
}

function highlightSentence(i) {
  document.querySelectorAll("#readerText .sentence.active").forEach(el => el.classList.remove("active"));
  const el = document.querySelector(`#readerText .sentence[data-i="${i}"]`);
  if (el) {
    el.classList.add("active");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  updateProgressBar();
}

function updateProgressBar() {
  const total = engine.sentences.length || 1;
  const pct = Math.min(100, Math.round(((currentBook.sentenceIndex || 0) / total) * 100));
  $("#progressBar").style.width = pct + "%";
}

engine.onSentenceChange = (i) => {
  currentBook.sentenceIndex = i;
  highlightSentence(i);
};

engine.onStateChange = (isPlaying) => {
  $("#playPauseBtn").textContent = isPlaying ? "⏸️" : "▶️";
};

engine.onChapterEnd = () => {
  if (currentBook.chapterIndex < currentBook.chapters.length - 1) {
    showToast("Section finished — moving to next section");
    loadChapterIntoView(currentBook.chapterIndex + 1, 0);
  } else {
    showToast("You've reached the end of the book 🎉");
  }
};

// --- Voices ---
function populateVoices() {
  const voices = speechSynthesis.getVoices();
  const select = $("#voiceSelect");
  select.innerHTML = "";
  voices.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });
  const savedIdx = localStorage.getItem("preferredVoiceIndex");
  if (savedIdx !== null && voices[savedIdx]) {
    select.value = savedIdx;
    engine.voice = voices[savedIdx];
  } else if (voices.length) {
    engine.voice = voices[0];
  }
}
speechSynthesis.onvoiceschanged = populateVoices;
populateVoices();

$("#voiceSelect").addEventListener("change", (e) => {
  const voices = speechSynthesis.getVoices();
  engine.voice = voices[e.target.value];
  localStorage.setItem("preferredVoiceIndex", e.target.value);
});

$("#rateSlider").addEventListener("input", (e) => {
  engine.rate = parseFloat(e.target.value);
  $("#rateLabel").textContent = engine.rate.toFixed(1) + "x";
  localStorage.setItem("preferredRate", engine.rate);
});
const savedRate = localStorage.getItem("preferredRate");
if (savedRate) {
  engine.rate = parseFloat(savedRate);
  $("#rateSlider").value = savedRate;
  $("#rateLabel").textContent = engine.rate.toFixed(1) + "x";
}

// --- Controls ---
$("#playPauseBtn").addEventListener("click", () => engine.togglePlay());
$("#prevSentenceBtn").addEventListener("click", () => engine.skipSentence(-1));
$("#nextSentenceBtn").addEventListener("click", () => engine.skipSentence(1));
$("#prevChapterBtn").addEventListener("click", () => {
  engine.pause();
  loadChapterIntoView(currentBook.chapterIndex - 1, 0);
});
$("#nextChapterBtn").addEventListener("click", () => {
  engine.pause();
  loadChapterIntoView(currentBook.chapterIndex + 1, 0);
});

$("#backToLibraryBtn").addEventListener("click", () => {
  engine.pause();
  readerView.classList.add("hidden");
  libraryView.classList.remove("hidden");
  renderLibrary();
});

$("#deleteBookBtn").addEventListener("click", async () => {
  if (!confirm(`Delete "${currentBook.title}"? This can't be undone.`)) return;
  engine.pause();
  await dbDeleteBook(currentBook.id);
  readerView.classList.add("hidden");
  libraryView.classList.remove("hidden");
  renderLibrary();
});

// --- Adding books ---
// The "+ Add Book" control is a native <label for="fileInput">, so the
// browser opens the file picker itself — no JS click-forwarding needed
// (more reliable across mobile browsers/webviews than input.click()).

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    try {
      showToast(`Importing "${file.name}"…`);
      const book = await parseFileToBook(file);
      await dbPutBook(book);
      showToast(`Added "${book.title}"`);
    } catch (err) {
      console.error(err);
      showToast(`Couldn't import "${file.name}": ${err.message}`);
    }
  }
  fileInput.value = "";
  renderLibrary();
});

// Drag & drop onto the library view
["dragover", "drop"].forEach(evt => {
  document.addEventListener(evt, (e) => e.preventDefault());
});
document.addEventListener("drop", async (e) => {
  if (readerView.classList.contains("hidden") === false) return; // only in library view
  const files = Array.from(e.dataTransfer.files || []);
  for (const file of files) {
    try {
      showToast(`Importing "${file.name}"…`);
      const book = await parseFileToBook(file);
      await dbPutBook(book);
    } catch (err) {
      showToast(`Couldn't import "${file.name}"`);
    }
  }
  renderLibrary();
});

renderLibrary();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
