// db.js — tiny IndexedDB wrapper for storing books in the browser
const DB_NAME = "read-to-me-db";
const DB_VERSION = 1;
const STORE = "books";

function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("This browser doesn't support local storage (IndexedDB) — try a different browser."));
      return;
    }
    // Some mobile browsers (notably in certain privacy modes) leave the
    // open() request permanently pending instead of erroring, so a plain
    // await here hangs forever with zero feedback. A hard timeout turns
    // that silent hang into a message the user can actually act on.
    const timeout = setTimeout(() => {
      reject(new Error("Local storage (IndexedDB) didn't respond in time — your browser may be blocking site storage. Check privacy/incognito settings."));
    }, 6000);

    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
      return;
    }
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => { clearTimeout(timeout); resolve(req.result); };
    req.onerror = () => { clearTimeout(timeout); reject(req.error || new Error("IndexedDB open failed")); };
    req.onblocked = () => { clearTimeout(timeout); reject(new Error("IndexedDB open was blocked (another tab may be using an older version).")); };
  });
}

async function dbPutBook(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAllBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbDeleteBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
