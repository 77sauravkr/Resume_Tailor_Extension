// pdf-builder.js - Pure-JS 1-page Letter PDF builder from the rendered #resume-page DOM.
// Generates a valid, searchable ATS-ready PDF Blob with clickable URI link annotations.
(function (root) {
  const PAGE_W = 612; // 8.5in * 72pt
  const PAGE_H = 792; // 11in * 72pt

  const WINANSI_MAP = {
    0x20AC: 0o200, 0x201A: 0o202, 0x0192: 0o203, 0x201E: 0o204, 0x2026: 0o205,
    0x2020: 0o206, 0x2021: 0o207, 0x02C6: 0o210, 0x2030: 0o211, 0x0160: 0o212,
    0x2039: 0o213, 0x0152: 0o214, 0x017D: 0o216, 0x2018: 0o221, 0x2019: 0o222,
    0x201C: 0o223, 0x201D: 0o224, 0x2022: 0o225, 0x2013: 0o226, 0x2014: 0o227,
    0x02DC: 0o230, 0x2122: 0o231, 0x0161: 0o232, 0x203A: 0o233, 0x0153: 0o234,
    0x017E: 0o236, 0x0178: 0o237, 0x00A0: 0x20
  };

  function pdfStr(text) {
    let out = "(";
    // The built-in PDF fonts have no rupee sign.
    for (const ch of String(text || "").replace(/\u20B9\s*/g, "Rs. ")) {
      const code = ch.charCodeAt(0);
      if (ch === "\\" || ch === "(" || ch === ")") {
        out += "\\" + ch;
      } else if (code >= 0x20 && code <= 0x7E) {
        out += ch;
      } else if (WINANSI_MAP[code] !== undefined) {
        out += "\\" + WINANSI_MAP[code].toString(8).padStart(3, "0");
      } else if (code >= 0xA0 && code <= 0xFF) {
        out += "\\" + code.toString(8).padStart(3, "0");
      } else if (ch === "\u2192") {
        out += "->";
      } else if (ch === "\u2265") {
        out += ">=";
      } else if (ch === "\u2264") {
        out += "<=";
      } else if (code >= 0x20) {
        out += "?";
      }
    }
    return out + ")";
  }

  function parseRgb(colorStr) {
    const m = String(colorStr || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return [0, 0, 0];
    return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  }

  function fontKey(cs) {
    const bold = cs.fontWeight === "bold" || Number(cs.fontWeight) >= 600;
    const italic = cs.fontStyle === "italic" || cs.fontStyle === "oblique";
    if (bold && italic) return "/F4";
    if (bold) return "/F2";
    if (italic) return "/F3";
    return "/F1";
  }

  // The PDF draws in Times while the page is laid out in Latin Modern, so widths differ.
  // Times New Roman has the same metrics as the PDF's Times fonts; measure with it.
  const measureCtx = () => document.createElement("canvas").getContext("2d");
  function timesWidth(ctx, text, size, fKey) {
    const italic = fKey === "/F3" || fKey === "/F4" ? "italic " : "";
    const bold = fKey === "/F2" || fKey === "/F4" ? "bold " : "";
    ctx.font = `${italic}${bold}${size * 20}px "Times New Roman", Times, serif`;
    return ctx.measureText(text).width / 20;
  }

  function buildFromPage(pageEl) {
    if (!pageEl) throw new Error("Resume page element not found.");
    const pageRect = pageEl.getBoundingClientRect();
    if (!pageRect.width || !pageRect.height) throw new Error("Resume page is not visible.");
    const scaleX = PAGE_W / pageRect.width;
    const scaleY = PAGE_H / pageRect.height;

    const ops = [];
    const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const ctx = measureCtx();
    let node;

    while ((node = walker.nextNode())) {
      const text = node.nodeValue || "";
      if (!text.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const cs = getComputedStyle(parent);
      if (cs.visibility === "hidden" || cs.display === "none") continue;

      const fKey = fontKey(cs);
      const baseSize = parseFloat(cs.fontSize) * scaleY;
      const [r, g, b] = parseRgb(cs.color);
      const smallCaps = cs.fontVariantCaps === "small-caps" || cs.fontVariant === "small-caps" || /Caps/i.test(cs.fontFamily);

      // One text object per line. Small caps only changes the font size inside it: the PDF advances
      // each piece itself, so a word stays one word for text extraction and ATS parsers.
      let cur = null;
      const flushRun = () => {
        const line = cur;
        cur = null;
        if (!line || !line.parts.some(p => p.text.trim())) return;
        const natural = line.parts.reduce((w, p) => w + timesWidth(ctx, p.text, p.size, fKey), 0);
        const target = (line.right - line.left) * scaleX;
        // Stretch or squeeze to the on-screen width so neighbouring runs neither gap nor overlap.
        const stretch = natural > 0 ? Math.min(130, Math.max(70, (100 * target) / natural)) : 100;
        const x = (line.left - pageRect.left) * scaleX;
        const y = PAGE_H - (line.bottom - pageRect.top) * scaleY + baseSize * 0.17;
        const shows = line.parts.map(p => `${fKey} ${p.size.toFixed(2)} Tf ${pdfStr(p.text)} Tj`).join(" ");
        ops.push(`BT ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${stretch.toFixed(2)} Tz 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${shows} ET`);
      };

      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const raw = /\s/.test(text[i]) ? " " : text[i];
        const isLower = smallCaps && raw >= "a" && raw <= "z";
        const ch = isLower ? raw.toUpperCase() : raw;
        const size = isLower ? baseSize * 0.78 : baseSize;

        if (!cur || Math.abs(rect.top - cur.top) > 2.5) {
          flushRun();
          cur = { parts: [], left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }
        const last = cur.parts[cur.parts.length - 1];
        if (last && (last.size === size || ch === " ")) last.text += ch;
        else cur.parts.push({ text: ch, size });
        cur.right = Math.max(cur.right, rect.right);
        cur.bottom = Math.max(cur.bottom, rect.bottom);
      }
      flushRun();
    }

    // Draw list bullet dots for every visible <li>
    for (const li of pageEl.querySelectorAll("ul li")) {
      const r = li.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(li);
      const fontSize = parseFloat(cs.fontSize) * scaleY;
      // Find first text char baseline in this li
      const tw = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      let firstText = tw.nextNode();
      while (firstText && !firstText.nodeValue.trim()) firstText = tw.nextNode();
      let bulletY = PAGE_H - (r.top - pageRect.top) * scaleY - fontSize * 0.9;
      if (firstText) {
        range.setStart(firstText, 0);
        range.setEnd(firstText, 1);
        const fr = range.getBoundingClientRect();
        if (fr.height) bulletY = PAGE_H - (fr.bottom - pageRect.top) * scaleY + fr.height * scaleY * 0.17;
      }
      const bx = (r.left - pageRect.left) * scaleX - 9;
      ops.push(`BT 100 Tz /F1 ${fontSize.toFixed(2)} Tf 0 0 0 rg 1 0 0 1 ${bx.toFixed(2)} ${bulletY.toFixed(2)} Tm (\\225) Tj ET`);
    }

    // Draw section title underlines
    for (const title of pageEl.querySelectorAll(".section-title")) {
      const r = title.getBoundingClientRect();
      if (!r.width) continue;
      const x1 = (r.left - pageRect.left) * scaleX;
      const x2 = (r.right - pageRect.left) * scaleX;
      const y = PAGE_H - (r.bottom - pageRect.top) * scaleY + 0.5;
      ops.push(`0 0 0 RG 0.75 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
    }

    // Collect clickable hyperlink annotations
    const linkAnnots = [];
    for (const a of pageEl.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (!/^(https?:|mailto:)/i.test(href)) continue;
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const x1 = (r.left - pageRect.left) * scaleX;
      const x2 = (r.right - pageRect.left) * scaleX;
      const y1 = PAGE_H - (r.bottom - pageRect.top) * scaleY;
      const y2 = PAGE_H - (r.top - pageRect.top) * scaleY;
      linkAnnots.push({ rect: [x1, y1, x2, y2], href });
    }

    const streamStr = ops.join("\n");
    const enc = new TextEncoder();
    const streamBytes = enc.encode(streamStr);

    // Build PDF objects
    const objects = [];
    const addObj = body => {
      objects.push(body);
      return objects.length;
    };

    const font1 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>");
    const font2 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>");
    const font3 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>");
    const font4 = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-BoldItalic /Encoding /WinAnsiEncoding >>");
    const contentId = addObj(`<< /Length ${streamBytes.length} >>\nstream\n${streamStr}\nendstream`);

    const annotIds = linkAnnots.map(l =>
      addObj(`<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(n => n.toFixed(2)).join(" ")}] /Border [0 0 0] /A << /S /URI /URI ${pdfStr(l.href)} >> >>`)
    );

    const pageId = objects.length + 3;
    const pagesId = objects.length + 2;
    const catalogId = objects.length + 1;

    addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    addObj(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
    addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R /F3 ${font3} 0 R /F4 ${font4} 0 R >> >> ` +
      `/Contents ${contentId} 0 R${annotIds.length ? ` /Annots [${annotIds.map(id => `${id} 0 R`).join(" ")}]` : ""} >>`
    );

    const chunks = [];
    let bytePos = 0;
    const pushStr = s => {
      const b = enc.encode(s);
      chunks.push(b);
      bytePos += b.length;
    };

    const headerBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]);
    chunks.push(headerBytes);
    bytePos += headerBytes.length;
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(bytePos);
      pushStr(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
    }

    const xrefPos = bytePos;
    pushStr(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i < offsets.length; i++) {
      pushStr(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
    }
    pushStr(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    return new Blob(chunks, { type: "application/pdf" });
  }

  root.AegisPdfBuilder = { buildFromPage };
})(typeof window !== "undefined" ? window : globalThis);
