// resume-import.js - Read a resume file, extract its text, and turn it into a profile.
// PDF text comes from the bundled pdf.js; structuring uses the user's AI key, with a
// regex-based fallback so basic details still import without a key.

const ResumeImport = (() => {
  function groupItemsToRows(items) {
    const rows = new Map();
    for (const it of items) {
      const y = Math.round(it.y / 3);
      rows.set(y, (rows.get(y) || []).concat(it));
    }
    return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([y, rowItems]) => {
      const sorted = rowItems.slice().sort((a, b) => a.x0 - b.x0);
      const text = sorted.map(i => i.s).join(" ").replace(/\s+/g, " ").trim();
      return { y, items: sorted, text };
    }).filter(r => r.text);
  }

  function detectTwoColumnSplit(items) {
    const rows = groupItemsToRows(items);
    if (rows.length < 10) return null;
    const minX = Math.min(...items.map(i => i.x0));
    const maxX = Math.max(...items.map(i => i.x1));
    const span = maxX - minX;
    if (span < 180) return null;

    // Allow up to top 25% of rows (max 7) to be a full-width name/contact banner
    const maxHeaderSkip = Math.min(7, Math.floor(rows.length * 0.25));
    let best = null;

    for (let splitX = minX + span * 0.25; splitX <= minX + span * 0.68; splitX += 6) {
      let headerEnd = 0;
      while (headerEnd < maxHeaderSkip) {
        const r = rows[headerEnd];
        const crosses = r.items.some(i => i.x0 < splitX - 4 && i.x1 > splitX + 4);
        const onlyCentered = r.items.length > 0 && r.items.every(i => i.x0 > minX + span * 0.15 && i.x1 < maxX - span * 0.15);
        if (crosses || onlyCentered) headerEnd++;
        else break;
      }
      const bodyRows = rows.slice(headerEnd);
      if (bodyRows.length < 8) continue;

      let crossings = 0, leftRows = 0, rightSubstantial = 0;
      for (const r of bodyRows) {
        const hasCross = r.items.some(i => i.x0 < splitX - 4 && i.x1 > splitX + 4);
        if (hasCross) { crossings++; continue; }
        const left = r.items.filter(i => i.x1 <= splitX + 4);
        const right = r.items.filter(i => i.x0 >= splitX - 4);
        if (left.length) leftRows++;
        if (right.length) {
          const rText = right.map(i => i.s).join(" ").trim();
          const rWidth = Math.max(...right.map(i => i.x1)) - Math.min(...right.map(i => i.x0));
          // Right-aligned dates on 1-column resumes are narrow/short; 2-column blocks have substantial lines
          if (rWidth > 95 || rText.split(/\s+/).length >= 4) rightSubstantial++;
        }
      }

      if (crossings <= Math.max(1, Math.floor(bodyRows.length * 0.1)) && leftRows >= 4 && rightSubstantial >= 4) {
        const score = leftRows + rightSubstantial - crossings * 5;
        if (!best || score > best.score) {
          best = { splitX, headerCount: headerEnd, rows, score };
        }
      }
    }
    return best;
  }

  async function pdfText(buffer) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    const out = [], links = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (!it.str.trim() && !it.hasEOL) continue;
        if (!it.str.trim()) continue;
        const x0 = it.transform[4];
        const w = Math.max(0, Number(it.width) || it.str.length * 4);
        items.push({ x0, x1: x0 + w, y: it.transform[5], s: it.str });
      }
      const split = detectTwoColumnSplit(items);
      if (split) {
        const headerRows = split.rows.slice(0, split.headerCount);
        headerRows.forEach(r => out.push(r.text));
        const headerYMin = headerRows.length ? headerRows[headerRows.length - 1].y : Infinity;
        const bodyItems = items.filter(i => Math.round(i.y / 3) < headerYMin);
        const leftItems = bodyItems.filter(i => (i.x0 + i.x1) / 2 < split.splitX);
        const rightItems = bodyItems.filter(i => (i.x0 + i.x1) / 2 >= split.splitX);
        groupItemsToRows(leftItems).forEach(r => out.push(r.text));
        groupItemsToRows(rightItems).forEach(r => out.push(r.text));
      } else {
        groupItemsToRows(items).forEach(r => out.push(r.text));
      }
      (await page.getAnnotations()).forEach(a => { if (a.url) links.push(a.url); });
    }
    return { text: out.filter(Boolean).join("\n"), links };
  }

  async function readZipEntries(buffer, wantedRe) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const td = new TextDecoder("utf-8");

    // Locate End of Central Directory (PK\x05\x06)
    let eocd = -1;
    const minPos = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Invalid DOCX archive.");

    const cdCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = new Map();

    for (let idx = 0; idx < cdCount && offset + 46 <= bytes.length; idx++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compSize = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOff = view.getUint32(offset + 42, true);
      const name = td.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      offset += 46 + nameLen + extraLen + commentLen;

      if (!wantedRe.test(name)) continue;
      if (localOff + 30 > bytes.length || view.getUint32(localOff, true) !== 0x04034b50) continue;
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const comp = bytes.subarray(start, start + compSize);

      if (method === 0) {
        entries.set(name, td.decode(comp));
      } else if (method === 8) {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("DOCX decompression is unavailable in this browser. Please upload a PDF.");
        }
        const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        entries.set(name, await new Response(stream).text());
      }
    }
    return entries;
  }

  function extractDocxParagraphText(pNode, relMap, links) {
    let text = "";
    let isBullet = false;
    const walk = node => {
      if (!node || node.nodeType !== 1) return;
      const ln = node.localName;
      if (ln === "pPr") {
        if (Array.from(node.childNodes).some(c => c.localName === "numPr")) isBullet = true;
        return;
      }
      if (ln === "t") { text += node.textContent || ""; return; }
      if (ln === "tab") { text += " "; return; }
      if (ln === "br" || ln === "cr") { text += "\n"; return; }
      if (ln === "hyperlink") {
        const rid = node.getAttribute("r:id") || node.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        if (rid && relMap[rid]) links.push(relMap[rid]);
      }
      for (const ch of node.childNodes) walk(ch);
    };
    walk(pNode);
    const cleaned = text.replace(/[ \t]+/g, " ").trim();
    if (!cleaned) return "";
    if (isBullet && !/^[•●▪◦·*\-–]/.test(cleaned)) return `- ${cleaned}`;
    return cleaned;
  }

  async function docxText(buffer) {
    const entries = await readZipEntries(buffer, /^word\/(?:document|header\d*|footer\d*)\.xml$|^word\/_rels\/document\.xml\.rels$/i);
    const docXml = entries.get("word/document.xml");
    if (!docXml) throw new Error("Could not read text from this .docx file.");

    const parser = new DOMParser();
    const relMap = {};
    const relsXml = entries.get("word/_rels/document.xml.rels");
    if (relsXml) {
      const rDoc = parser.parseFromString(relsXml, "application/xml");
      for (const el of rDoc.getElementsByTagName("*")) {
        if (el.localName === "Relationship") {
          const id = el.getAttribute("Id");
          const target = el.getAttribute("Target");
          if (id && target && /^(https?:|mailto:)/i.test(target)) relMap[id] = target;
        }
      }
    }

    const lines = [], links = [];
    const orderedKeys = [
      ...[...entries.keys()].filter(k => /^word\/header\d*\.xml$/i.test(k)).sort(),
      "word/document.xml",
      ...[...entries.keys()].filter(k => /^word\/footer\d*\.xml$/i.test(k)).sort()
    ];

    for (const key of orderedKeys) {
      const xml = entries.get(key);
      if (!xml) continue;
      const xDoc = parser.parseFromString(xml, "application/xml");
      const body = Array.from(xDoc.getElementsByTagName("*")).find(el => el.localName === "body") || xDoc.documentElement;
      if (!body) continue;

      const emitNode = node => {
        if (!node || node.nodeType !== 1) return;
        if (node.localName === "p") {
          const line = extractDocxParagraphText(node, relMap, links);
          if (line) lines.push(line);
          return;
        }
        if (node.localName === "tbl") {
          const rows = Array.from(node.childNodes).filter(c => c.localName === "tr");
          for (const tr of rows) {
            const cells = Array.from(tr.childNodes).filter(c => c.localName === "tc");
            const cellLines = cells.map(tc => {
              const out = [];
              const collect = n => {
                if (n.localName === "p") {
                  const t = extractDocxParagraphText(n, relMap, links);
                  if (t) out.push(t);
                } else {
                  for (const c of n.childNodes || []) collect(c);
                }
              };
              collect(tc);
              return out;
            });
            // Multi-paragraph columns (2-column DOCX table layout): emit column by column so text doesn't mix
            if (cellLines.some(arr => arr.length > 2)) {
              cellLines.forEach(arr => lines.push(...arr));
            } else {
              const joined = cellLines.map(arr => arr.join(" ")).filter(Boolean).join(" ");
              if (joined) lines.push(joined);
            }
          }
          return;
        }
        for (const ch of node.childNodes) emitNode(ch);
      };
      for (const ch of body.childNodes) emitNode(ch);
    }

    return { text: lines.join("\n"), links };
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 4));
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    if (file.type === "application/pdf" || name.endsWith(".pdf")) return pdfText(buf);
    if (name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || (isZip && !name.endsWith(".txt"))) {
      return docxText(buf);
    }
    if (name.endsWith(".doc") || file.type === "application/msword") {
      throw new Error("Legacy binary .doc files are not supported — please save as .docx or .pdf.");
    }
    if (file.type.startsWith("text/") || /\.(txt|md)$/.test(name)) return { text: await file.text(), links: [] };
    throw new Error("Please upload a PDF or .docx file (or paste your resume text).");
  }

  const SECTION_RE = {
    summary: /^(summary|professional summary|objective|profile|about( me)?)$/i,
    skills: /^(technical skills|skills|core skills|key skills|technical proficiencies)$/i,
    experience: /^(experience|work experience|professional experience|employment( history)?|internships?)$/i,
    projects: /^(projects|personal projects|academic projects|key projects)$/i,
    education: /^(education|academics|academic background)$/i,
    achievements: /^(achievements|awards|honors|certifications|achievements and awards|accomplishments)$/i
  };
  const MON = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
  const DATE = `(?:${MON}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
  const RANGE_RE = new RegExp(`\\s*(${DATE}\\s*(?:--|[–—-]|to)\\s*(?:${DATE}|Present|Current|Now))\\s*$`, "i");
  const BULLET_RE = /^[•●▪◦·*\-–]\s*/;
  const TWO_WORD_CITY = /^(New|San|Los|Las|Navi|Greater|St\.?|Fort|Salt|Santa|Hong|Kuala|Abu|Tel)$/i;

  // "Acme Corp Pune, MH" -> ["Acme Corp", "Pune, MH"] (location = word before the comma + the rest)
  // PDF text joins the company and the right-hand location column with a space.
  function splitCompanyLine(line) {
    const parts = line.split(",").map(p => p.trim());
    const words = parts[0].split(/\s+/);
    const joined = parts.length === 2 && words.length > 1 &&
      /^(india|usa|us|uk|canada|germany|singapore|australia|uae|[A-Z]{2})$/i.test(parts[1]) &&
      !/^(inc|ltd|llc|llp|corp|co|pvt|limited|technologies|labs|solutions)\.?$/i.test(words[words.length - 1]);
    return joined ? splitLocation(line) : [parts[0], parts.slice(1).join(", ")];
  }

  function splitLocation(line) {
    const m = line.match(/^(.*?)\s+([^\s,]+(?:\s[^\s,]+)?),\s*(.+)$/);
    if (!m) return [line.trim(), ""];
    let head = m[1], city = m[2];
    const parts = city.split(" ");
    if (parts.length === 2 && !TWO_WORD_CITY.test(parts[0])) { head = `${head} ${parts[0]}`; city = parts[1]; }
    return [head.trim(), `${city}, ${m[3]}`.trim()];
  }

  // Join lone bullet markers with the next line and merge wrapped lines into the previous bullet.
  function bulletsOf(lines) {
    const out = [];
    let open = false;
    for (let l of lines) {
      if (/^[•●▪◦·*]$/.test(l)) { out.push(""); open = true; continue; }
      if (BULLET_RE.test(l)) { out.push(l.replace(BULLET_RE, "")); open = true; continue; }
      if (open && out.length) out[out.length - 1] = (out[out.length - 1] + " " + l).trim();
      else out.push(l);
    }
    return out.map(b => b.replace(/\s+([.,;])/g, "$1").trim()).filter(Boolean);
  }

  function rangeOf(text) {
    const m = text.match(RANGE_RE);
    if (!m) return null;
    const r = AegisAutofillData.parseRange(m[1].replace(/[–—]/g, "--").replace(/\s+-\s+/, " -- "));
    return { head: text.slice(0, m.index).trim(), ...r };
  }

  // Regex-based parser for conventional resumes (Jake / single-column). Used when AI is unavailable.
  function heuristic(text, links = []) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const all = text + "\n" + links.join("\n");

    // sections
    const sections = { header: [] };
    let cur = "header";
    for (const l of lines) {
      const key = Object.keys(SECTION_RE).find(k => SECTION_RE[k].test(l));
      if (key) { cur = key; sections[cur] = sections[cur] || []; continue; }
      (sections[cur] = sections[cur] || []).push(l);
    }
    const sec = k => sections[k] || [];

    // contact
    const header = sec("header");
    const email = (all.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [""])[0];
    const pm = header.join(" ").match(/(\+\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}/);
    let digits = pm ? pm[0].replace(/\D/g, "") : "";
    let cc = "";
    if (digits.length > 10) { cc = "+" + digits.slice(0, digits.length - 10); digits = digits.slice(-10); }
    const nameLine = header.find(l => /^[A-Za-z][A-Za-z.'-]+(\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(l)) || "";
    const nameParts = nameLine.split(/\s+/);

    const urls = links.filter(u => /^https?:/i.test(u));
    const path = u => { try { return new URL(u).pathname.split("/").filter(Boolean); } catch { return []; } };
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    const linkedin = urls.find(u => /linkedin\.com/.test(u)) || (all.match(/https?:\/\/(www\.)?linkedin\.com\/[^\s)]+/i) || [""])[0];
    const github = urls.find(u => host(u) === "github.com" && path(u).length === 1) || (all.match(/https?:\/\/(www\.)?github\.com\/[^\s)/]+/i) || [""])[0];
    const social = urls.find(u => !/linkedin|github|google\.com\/document|takeuforward/.test(host(u)) && path(u).length <= 3 && /leetcode|portfolio|behance|medium|dev\.to|kaggle|codeforces|codechef|hackerrank/.test(host(u)));
    // Links left over, in document order, are consumed by project / achievement labels.
    const used = new Set([linkedin, github, social].filter(Boolean));
    const queue = urls.filter(u => !used.has(u));
    const nextLink = () => queue.shift() || "";

    // skills
    const skillGroups = [];
    for (const l of bulletsOf(sec("skills"))) {
      const m = l.match(/^([^:]{2,40}):\s*(.+)$/);
      if (m) skillGroups.push({ category: m[1].trim(), items: m[2].trim() });
      else if (skillGroups.length === 0) skillGroups.push({ category: "Skills", items: l });
    }

    // experience: a title line ends with a date range; next non-bullet line is the company
    const work = [];
    const expLines = sec("experience");
    for (let i = 0; i < expLines.length; i++) {
      const r = !BULLET_RE.test(expLines[i]) && rangeOf(expLines[i]);
      if (!r) continue;
      let company = "", location = "", j = i + 1;
      if (expLines[j] && !BULLET_RE.test(expLines[j]) && !rangeOf(expLines[j])) {
        [company, location] = splitCompanyLine(expLines[j]); j++;
      }
      let k = j;
      while (k < expLines.length && !(rangeOf(expLines[k]) && !BULLET_RE.test(expLines[k]))) k++;
      work.push({ title: r.head, company, location, type: "Full-time", start: r.start, end: r.end, current: r.current, bullets: bulletsOf(expLines.slice(j, k)) });
      i = k - 1;
    }

    // projects: "Title | stack | Code | Live" header, followed by bullets
    const projects = [];
    let curProj = null, projBullets = [];
    const flush = () => { if (curProj) { curProj.bullets = bulletsOf(projBullets); projects.push(curProj); } projBullets = []; };
    for (const l of sec("projects")) {
      if (!BULLET_RE.test(l) && !/^[•●▪◦·*]$/.test(l) && (l.includes("|") || !curProj || projBullets.length && !/^[a-z]/.test(l) && l.length < 90 && !/[.]$/.test(l))) {
        flush();
        let head = l, labels = [];
        const tail = head.match(/\s+((?:Code|Live|Demo|GitHub|Link|Website|Source)(?:\s*\|\s*(?:Code|Live|Demo|GitHub|Link|Website|Source))*)\s*$/i);
        if (tail) { labels = tail[1].split("|").map(x => x.trim().toLowerCase()); head = head.slice(0, tail.index); }
        const parts = head.split("|").map(p => p.trim());
        curProj = { title: parts[0], techStack: parts.slice(1).join(", "), codeUrl: "", liveUrl: "" };
        for (const lab of labels) { const u = nextLink(); if (/live|demo|website/.test(lab)) curProj.liveUrl = u; else if (!curProj.codeUrl) curProj.codeUrl = u; else curProj.liveUrl = u; }
      } else projBullets.push(l);
    }
    flush();

    // education: school (+ location) line followed by degree + date line
    const education = [];
    const edu = sec("education");
    for (let i = 0; i < edu.length; i++) {
      const r = rangeOf(edu[i]);
      if (!r || !i) continue;
      const [school, location] = splitLocation(edu[i - 1]);
      let head = r.head, gpa = "";
      const gm = head.match(/\s*[;|,()]?\s*(?:c?gpa|gpa|grade)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?(?:\s*\/\s*[0-9]+(?:\.[0-9]+)?)?%?)\s*\)?/i);
      if (gm) {
        gpa = gm[1].replace(/\s+/g, "");
        head = (head.slice(0, gm.index) + " " + head.slice(gm.index + gm[0].length)).replace(/[;|,\s]+$/, "").trim();
      }
      const m = head.match(/^(.*?)\s+in\s+(.*)$/i);
      education.push({ school, location, degree: m ? m[1] : head, major: m ? m[2] : "", gpa, start: r.start, end: r.end, current: r.current });
    }

    // achievements
    const achievements = bulletsOf(sec("achievements")).map(t => {
      const m = t.match(/\s*[–—-]\s*(Profile|Details|Link|Certificate|Credential|View)\s*$/i);
      return { text: (m ? t.slice(0, m.index) : t).trim(), url: m ? nextLink() : "" };
    });

    return {
      summary: sec("summary").join(" "),
      personal: { firstName: nameParts[0] || "", lastName: nameParts.slice(1).join(" "), email, countryCode: cc, phone: digits, linkedin, github, portfolio: social || "" },
      education, work, skillGroups, projects, achievements
    };
  }

  function toDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  // Returns { profile, mode: "ai" | "basic", warning }
  async function importFile(file, currentProfile, { keepDocuments = false } = {}) {
    if (file.size > 10 * 1024 * 1024) throw new Error("File is larger than 10 MB.");
    const { text, links } = await readFile(file);
    if (text.trim().length < 40) throw new Error("No readable text found (scanned PDF?). Paste your resume text instead.");
    const result = await importText(text, currentProfile, links);
    if (keepDocuments) return result;   // re-reading a stored file must not replace or delete anything
    if (typeof AegisDocStore !== "undefined") {
      result.profile.documents.resume = await AegisDocStore.put("resume", file);
      result.profile.documents.masterResume = null;
      await AegisDocStore.remove("masterResume");
    } else {
      const dataUrl = await toDataUrl(file);
      result.profile.documents.resume = { name: file.name, type: file.type || "application/pdf", dataUrl };
    }
    return result;
  }

  // Per section, keep whichever parse recovered more content (AI never silently drops items).
  function pickBetter(aiP, hP) {
    const count = {
      skills: p => p.resume.skillGroups.reduce((n, g) => n + g.items.split(",").length, 0),
      work: p => p.work.reduce((n, w) => n + 1 + w.description.split("\n").filter(Boolean).length, 0),
      education: p => p.education.length,
      projects: p => p.resume.projects.reduce((n, x) => n + 1 + x.bullets.split("\n").filter(Boolean).length, 0),
      achievements: p => p.resume.achievements.length
    };
    const out = JSON.parse(JSON.stringify(aiP));
    if (count.skills(hP) > count.skills(aiP)) { out.resume.skillGroups = hP.resume.skillGroups; out.skills = hP.skills; }
    if (count.work(hP) > count.work(aiP)) out.work = hP.work;
    if (count.education(hP) > count.education(aiP)) out.education = hP.education;
    if (count.projects(hP) > count.projects(aiP)) out.resume.projects = hP.resume.projects;
    if (count.achievements(hP) > count.achievements(aiP)) out.resume.achievements = hP.resume.achievements;
    if (!out.resume.summary) out.resume.summary = hP.resume.summary;
    for (const k of Object.keys(hP.personal)) if (!out.personal[k] && hP.personal[k]) out.personal[k] = hP.personal[k];
    return out;
  }

  async function importText(text, currentProfile, links = []) {
    const D = AegisAutofillData;
    const fromRegex = D.fromParsed(heuristic(text, links));
    let parsed = fromRegex, warning = "", mode = "basic";
    const res = await chrome.runtime.sendMessage({
      action: "PARSE_RESUME",
      text: text + (links.length ? "\n\nHYPERLINKS IN THE DOCUMENT (in order):\n" + links.join("\n") : "")
    });
    if (res?.success) { parsed = pickBetter(D.fromParsed(res.parsed), fromRegex); mode = "ai"; }
    else {
      const err = res?.error || "unknown";
      warning = err === "NO_KEY"
        ? "Imported without AI. Review each step. Add an AI key in Settings for smarter extraction on unusual resume layouts."
        : /API key not valid|API_KEY_INVALID|HTTP 40[13]/i.test(err)
          ? "Your AI key was rejected, so the resume was read without AI. Check the key in Settings."
          : "AI extraction failed, so the resume was read without AI (" + err.slice(0, 80) + "). Review each step.";
    }
    const merged = D.mergeParsed(currentProfile, parsed);
    merged.resumeText = text.slice(0, 20000);
    return { profile: merged, mode, warning };
  }

  return { importFile, importText, _heuristic: heuristic };
})();
