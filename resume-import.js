// resume-import.js - Read a resume file, extract its text, and turn it into a profile.
// PDF text comes from the bundled pdf.js; structuring uses the user's AI key, with a
// regex-based fallback so basic details still import without a key.

const ResumeImport = (() => {
  async function pdfText(buffer) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    const out = [], links = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const it of content.items) {
        if (!it.str.trim() && !it.hasEOL) continue;
        const y = Math.round(it.transform[5] / 3);
        rows.set(y, (rows.get(y) || []).concat({ x: it.transform[4], s: it.str }));
      }
      [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
        out.push(items.sort((a, b) => a.x - b.x).map(i => i.s).join(" ").replace(/\s+/g, " ").trim());
      });
      (await page.getAnnotations()).forEach(a => { if (a.url) links.push(a.url); });
    }
    return { text: out.filter(Boolean).join("\n"), links };
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (file.type === "application/pdf" || name.endsWith(".pdf")) return pdfText(await file.arrayBuffer());
    if (file.type.startsWith("text/") || /\.(txt|md)$/.test(name)) return { text: await file.text(), links: [] };
    throw new Error("Please upload a PDF (or paste your resume text). Word files are not supported.");
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
        const parts = expLines[j].split(",").map(p => p.trim());
        company = parts[0]; location = parts.slice(1).join(", "); j++;
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
      const m = r.head.match(/^(.*?)\s+in\s+(.*)$/i);
      education.push({ school, location, degree: m ? m[1] : r.head, major: m ? m[2] : "", gpa: "", start: r.start, end: r.end, current: r.current });
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
  async function importFile(file, currentProfile) {
    if (file.size > 4 * 1024 * 1024) throw new Error("File is larger than 4 MB.");
    const { text, links } = await readFile(file);
    if (text.trim().length < 40) throw new Error("No readable text found (scanned PDF?). Paste your resume text instead.");
    const dataUrl = await toDataUrl(file);
    const doc = { name: file.name, type: file.type || "application/pdf", dataUrl };
    const result = await importText(text, currentProfile, links);
    result.profile.documents.resume = doc;
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
