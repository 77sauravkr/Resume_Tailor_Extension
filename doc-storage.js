// doc-storage.js - Extension IndexedDB store for resume and cover letter binaries.
// Keeps multi-MB files out of chrome.storage.local's 10 MB quota.
(function (root) {
  const DB_NAME = "aegis-resume-docs";
  const STORE = "docs";
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  function dataUrlToBlob(dataUrl, fallbackType = "application/pdf") {
    const [head, b64] = String(dataUrl || "").split(",");
    if (!b64) return null;
    const typeMatch = head.match(/data:([^;]+)/i);
    const type = typeMatch ? typeMatch[1] : fallbackType;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function blobToDataUrl(blob, fallbackType = "application/pdf") {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return `data:${blob.type || fallbackType};base64,${btoa(bin)}`;
  }

  async function put(id, fileOrDoc) {
    if (!fileOrDoc) return null;
    const blob = fileOrDoc instanceof Blob
      ? fileOrDoc
      : (fileOrDoc.blob instanceof Blob ? fileOrDoc.blob : dataUrlToBlob(fileOrDoc.dataUrl, fileOrDoc.type));
    if (!blob) throw new Error("Empty file data.");
    const rec = {
      id,
      name: fileOrDoc.name || `${id}.pdf`,
      type: fileOrDoc.type || blob.type || "application/pdf",
      size: fileOrDoc.size || blob.size || 0,
      blob,
      updatedAt: Date.now()
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return { name: rec.name, type: rec.type, size: rec.size, storageId: id, updatedAt: rec.updatedAt };
  }

  async function getRecord(id) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  }

  async function getBlob(id, fallbackMeta = null) {
    const rec = await getRecord(id);
    if (rec?.blob) return { name: rec.name, type: rec.type, size: rec.size, blob: rec.blob };
    if (fallbackMeta?.dataUrl) {
      const blob = dataUrlToBlob(fallbackMeta.dataUrl, fallbackMeta.type);
      if (blob) return { name: fallbackMeta.name || `${id}.pdf`, type: fallbackMeta.type || blob.type, size: blob.size, blob };
    }
    return null;
  }

  async function get(id, fallbackMeta = null) {
    const rec = await getRecord(id);
    if (rec?.blob) {
      return {
        name: rec.name,
        type: rec.type || rec.blob.type || "application/pdf",
        size: rec.size || rec.blob.size,
        dataUrl: await blobToDataUrl(rec.blob, rec.type)
      };
    }
    if (fallbackMeta?.dataUrl) {
      return {
        name: fallbackMeta.name || `${id}.pdf`,
        type: fallbackMeta.type || "application/pdf",
        size: fallbackMeta.size || 0,
        dataUrl: fallbackMeta.dataUrl
      };
    }
    return null;
  }

  async function remove(id) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {}
  }

  root.AegisDocStore = { put, get, getBlob, remove, dataUrlToBlob, blobToDataUrl };
})(typeof window !== "undefined" ? window : globalThis);
