# Read To Me

A tiny, free, offline-friendly book reader that reads your own EPUB, PDF, and
TXT files aloud in the browser.

- **No backend, no account.** Everything runs client-side; your files stay
  on your device (stored in the browser's IndexedDB).
- **Formats:** `.epub`, `.pdf`, `.txt` (including the `===== PAGE N =====`
  marker format produced by OCR exports).
- **Reads aloud** sentence-by-sentence using the browser's built-in
  Web Speech API (free, offline, no API keys).
- **Controls:** play/pause, skip sentence, previous/next section, playback
  speed, voice picker.
- **Resumes** exactly where you left off, per book.
- Installable as a PWA ("Add to Home Screen") for phone use.

## Use it

Open `index.html` (or the hosted GitHub Pages URL) in Chrome, Edge, or
Safari. Click **+ Add Book**, pick a file, then tap a book to start reading.

## Run locally

```bash
cd book-reader-app
python3 -m http.server 8000
# open http://localhost:8000
```

## Notes

- Voice quality depends entirely on your OS/browser's installed voices.
- PDF text extraction quality depends on the PDF having real text (not a
  flat scanned image with no OCR layer).
- Nothing is uploaded anywhere — parsing and storage are 100% local.
