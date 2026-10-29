// parsers.js — turn uploaded files into { title, author, chapters: [{title, text}] }

function splitIntoChunks(text, maxLen = 3000) {
  // Split on blank lines (paragraphs) first, then pack into chunks ~maxLen chars
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const p of paras) {
    if (len + p.length > maxLen && buf.length) {
      chunks.push(buf.join("\n\n"));
      buf = [];
      len = 0;
    }
    buf.push(p);
    len += p.length;
  }
  if (buf.length) chunks.push(buf.join("\n\n"));
  return chunks;
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach(el => el.remove());
  // Preserve paragraph breaks
  doc.querySelectorAll("p,div,br,h1,h2,h3,h4,li").forEach(el => {
    el.insertAdjacentText("afterend", "\n\n");
  });
  return doc.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

async function parseTxtFile(file) {
  const raw = await file.text();
  // Respect our own "===== PAGE N =====" markers if present (from OCR exports)
  const hasPageMarkers = /={3,}\s*PAGE\s*\d+\s*={3,}/i.test(raw);
  let chapters = [];
  if (hasPageMarkers) {
    const parts = raw.split(/={3,}\s*PAGE\s*\d+\s*={3,}/i).map(s => s.trim()).filter(Boolean);
    const joined = parts.join("\n\n");
    const chunks = splitIntoChunks(joined, 3000);
    chapters = chunks.map((c, i) => ({ title: `Section ${i + 1}`, text: c }));
  } else {
    const chunks = splitIntoChunks(raw, 3000);
    chapters = chunks.map((c, i) => ({ title: `Section ${i + 1}`, text: c }));
  }
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    author: "",
    chapters
  };
}

async function parseEpubFile(file) {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const containerXml = await zip.file("META-INF/container.xml").async("string");
  const containerDoc = new DOMParser().parseFromString(containerXml, "application/xml");
  const opfPath = containerDoc.querySelector("rootfile").getAttribute("full-path");
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const opfXml = await zip.file(opfPath).async("string");
  const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");

  // Avoid CSS namespace-wildcard selectors ("*|title") and optional
  // chaining (?.) here — some mobile browser engines (seen on Huawei
  // Browser) either throw on that selector syntax or fail to parse the
  // whole file on "?.", which silently breaks the entire import pipeline.
  function firstTextByLocalName(doc, localName) {
    const els = doc.getElementsByTagName("*");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const name = el.localName || el.nodeName;
      if (name && name.toLowerCase() === localName && el.textContent) {
        return el.textContent;
      }
    }
    return null;
  }
  const title = firstTextByLocalName(opfDoc, "title") || file.name.replace(/\.[^.]+$/, "");
  const author = firstTextByLocalName(opfDoc, "creator") || "";

  const manifestItems = {};
  opfDoc.querySelectorAll("manifest item").forEach(item => {
    manifestItems[item.getAttribute("id")] = item.getAttribute("href");
  });

  const spineIds = Array.from(opfDoc.querySelectorAll("spine itemref")).map(i => i.getAttribute("idref"));

  const chapters = [];
  for (const id of spineIds) {
    const href = manifestItems[id];
    if (!href) continue;
    const fullPath = opfDir + href;
    const zf = zip.file(fullPath) || zip.file(decodeURIComponent(fullPath));
    if (!zf) continue;
    const html = await zf.async("string");
    const text = htmlToText(html);
    if (!text || text.length < 5) continue;
    const sub = splitIntoChunks(text, 3000);
    sub.forEach((t, i) => {
      chapters.push({ title: sub.length > 1 ? `${href} (${i + 1})` : href, text: t });
    });
  }

  return { title, author, chapters: chapters.length ? chapters : [{ title: "Full text", text: "(No readable text found in this EPUB.)" }] };
}

async function parsePdfFile(file) {
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(" ");
    fullText += pageText + "\n\n";
  }

  const chunks = splitIntoChunks(fullText, 3000);
  const chapters = chunks.map((c, i) => ({ title: `Section ${i + 1}`, text: c }));
  return { title: file.name.replace(/\.[^.]+$/, ""), author: "", chapters };
}

async function parseFileToBook(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  let parsed;
  if (ext === "txt") parsed = await parseTxtFile(file);
  else if (ext === "epub") parsed = await parseEpubFile(file);
  else if (ext === "pdf") parsed = await parsePdfFile(file);
  else throw new Error("Unsupported file type: " + ext);

  return {
    id: "book_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    title: parsed.title || file.name,
    author: parsed.author || "",
    chapters: parsed.chapters,
    chapterIndex: 0,
    sentenceIndex: 0,
    addedAt: Date.now()
  };
}
