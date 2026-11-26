// resume-viewer.js - shows the tailored (or base) resume, saves inline edits,
// exports .tex / 1-page PDF, sets tailored PDF for Autofill, and compares Before/After changes.

let resume = null;
let baseResume = null;
let tailoredRecord = null;
let useTailored = false;
let diffVisible = false;
let saveTimer = null;
let renderedKeys = new Set();  // what the last render put on screen, used to detect deletions

// One key per removable element: "summary", "experience:0", "experience:0:2", "skills:1", ...
function domKeys(page) {
  const keys = new Set();
  if (page.querySelector('[data-field="summary"]')) keys.add("summary");
  for (const type of ["experience", "project", "education"]) {
    page.querySelectorAll(`.entry[data-entry-type="${type}"][data-idx]`).forEach(entry => {
      const key = `${type === "project" ? "projects" : type}:${entry.dataset.idx}`;
      keys.add(key);
      entry.querySelectorAll(".entry-bullets li[data-bidx]").forEach(li => keys.add(`${key}:${li.dataset.bidx}`));
    });
  }
  page.querySelectorAll(".skills-list li[data-idx]").forEach(li => keys.add(`skills:${li.dataset.idx}`));
  page.querySelectorAll(".achievements-list li[data-idx]").forEach(li => keys.add(`achievements:${li.dataset.idx}`));
  return keys;
}

// Copy of the resume without what the user deleted on screen. `resume` itself keeps its indices
// so they still match the DOM, and undo brings a line back.
function currentData() {
  const data = JSON.parse(JSON.stringify(resume));
  const page = document.querySelector("#resume-container .page");
  if (!page) return data;
  const now = domKeys(page);
  const gone = new Set([...renderedKeys].filter(k => !now.has(k)));
  if (gone.has("summary")) data.summary = "";
  for (const list of ["experience", "projects", "education", "skills", "achievements"]) {
    if (!Array.isArray(data[list])) continue;
    data[list] = data[list].filter((item, i) => {
      if (gone.has(`${list}:${i}`)) return false;
      if (Array.isArray(item?.bullets)) item.bullets = item.bullets.filter((_, b) => !gone.has(`${list}:${i}:${b}`));
      return true;
    });
  }
  return data;
}

function fileTitle(name, company) {
  const first = (name || "").trim().split(/\s+/)[0] || "Resume";
  const comp = (company || "").replace(/[,|–-].*$/, "")
    .replace(/\b(Inc\.?|LLC\.?|Ltd\.?|Pvt\.?|Corporation|Corp\.?)\b/gi, "")
    .replace(/[\\/:*?"<>|#%&{}$!'`+@=.]/g, "").trim().replace(/\s+/g, "_");
  return comp ? `${first}_${comp}` : `${first}_Resume`;
}

function setSaveStatus(text, isErr = false) {
  const el = document.getElementById("save-status");
  if (!text) { el.hidden = true; return; }
  el.textContent = text;
  el.className = "save-status" + (isErr ? " err" : "");
  el.hidden = false;
}

function nodeToMarkdown(el) {
  if (!el) return "";
  let out = "";
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      out += child.nodeValue;
    } else if (child.nodeType === 1) {
      const tag = child.tagName;
      if (tag === "BR") out += " ";
      else if (tag === "STRONG" || tag === "B") out += `**${nodeToMarkdown(child)}**`;
      else out += nodeToMarkdown(child);
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function syncDomToResume() {
  if (!resume) return;
  const page = document.querySelector("#resume-container .page");
  if (!page) return;

  const qText = sel => page.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim();
  const qMd = sel => {
    const el = page.querySelector(sel);
    return el ? nodeToMarkdown(el) : undefined;
  };

  const name = qText('[data-field="name"]');
  if (name) resume.name = name;

  const summary = qMd('[data-field="summary"]');
  if (summary !== undefined) resume.summary = summary;

  page.querySelectorAll(".skills-list li[data-idx]").forEach(li => {
    const idx = +li.dataset.idx;
    if (!resume.skills?.[idx]) return;
    const cat = li.querySelector('[data-field="skill-cat"]')?.textContent?.replace(/:\s*$/, "").trim();
    const items = nodeToMarkdown(li.querySelector('[data-field="skill-items"]'));
    if (cat) resume.skills[idx].category = cat;
    if (items !== undefined) resume.skills[idx].items = items;
  });

  page.querySelectorAll('.entry[data-entry-type="experience"][data-idx]').forEach(entry => {
    const idx = +entry.dataset.idx;
    const exp = resume.experience?.[idx];
    if (!exp) return;
    const role = nodeToMarkdown(entry.querySelector('[data-field="exp-role"]'));
    const date = entry.querySelector('[data-field="exp-date"]')?.textContent?.trim();
    const company = nodeToMarkdown(entry.querySelector('[data-field="exp-company"]'));
    const loc = nodeToMarkdown(entry.querySelector('[data-field="exp-location"]'));
    if (role !== undefined) exp.role = role;
    if (date !== undefined) exp.date = date;
    if (company !== undefined) exp.company = company;
    if (loc !== undefined) exp.location = loc;
    entry.querySelectorAll(".entry-bullets li[data-bidx]").forEach(li => {
      const bi = +li.dataset.bidx;
      if (Array.isArray(exp.bullets) && bi >= 0 && bi < exp.bullets.length) {
        exp.bullets[bi] = nodeToMarkdown(li);
      }
    });
  });

  page.querySelectorAll('.entry[data-entry-type="project"][data-idx]').forEach(entry => {
    const idx = +entry.dataset.idx;
    const proj = resume.projects?.[idx];
    if (!proj) return;
    const title = nodeToMarkdown(entry.querySelector('[data-field="proj-title"]'));
    const stack = entry.querySelector('[data-field="proj-stack"]')?.textContent?.trim();
    if (title !== undefined) proj.title = title;
    if (stack !== undefined) proj.techStack = stack;
    entry.querySelectorAll(".entry-bullets li[data-bidx]").forEach(li => {
      const bi = +li.dataset.bidx;
      if (Array.isArray(proj.bullets) && bi >= 0 && bi < proj.bullets.length) {
        proj.bullets[bi] = nodeToMarkdown(li);
      }
    });
  });

  page.querySelectorAll('.entry[data-entry-type="education"][data-idx]').forEach(entry => {
    const idx = +entry.dataset.idx;
    const edu = resume.education?.[idx];
    if (!edu) return;
    const inst = nodeToMarkdown(entry.querySelector('[data-field="edu-institution"]'));
    const loc = nodeToMarkdown(entry.querySelector('[data-field="edu-location"]'));
    const degLine = nodeToMarkdown(entry.querySelector('[data-field="edu-degree"]'));
    const date = entry.querySelector('[data-field="edu-date"]')?.textContent?.trim();
    if (inst !== undefined) edu.institution = inst;
    if (loc !== undefined) edu.location = loc;
    if (date !== undefined) edu.date = date;
    if (degLine !== undefined) {
      const m = degLine.match(/^(.*?)\s*;\s*((?:c?gpa|grade|percentage|marks)\b.*?|GPA:\s*.*)$/i);
      if (m) {
        edu.degree = m[1].trim();
        edu.gpa = m[2].replace(/^GPA:\s*/i, "").trim();
      } else {
        edu.degree = degLine;
        edu.gpa = "";
      }
    }
  });

  page.querySelectorAll(".achievements-list li[data-idx]").forEach(li => {
    const idx = +li.dataset.idx;
    const text = nodeToMarkdown(li.querySelector('[data-field="ach-text"]'));
    if (text === undefined || !resume.achievements?.[idx]) return;
    if (typeof resume.achievements[idx] === "object") resume.achievements[idx].text = text;
    else resume.achievements[idx] = text;
  });
}

async function saveEdits() {
  syncDomToResume();
  if (useTailored && tailoredRecord) {
    tailoredRecord.data = currentData();
    tailoredRecord.editedAt = Date.now();
    await chrome.storage.local.set({ latestTailoredResume: tailoredRecord });
  } else {
    const data = currentData();
    await chrome.storage.local.set({ masterGenericResume: data, candidateProfile: data });
  }
  setSaveStatus("Edits saved");
  if (diffVisible) renderDiffPanel();
}

// ---------- Before / After Diff ----------
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const stripMd = s => String(s || "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

function diffWords(oldText, newText) {
  const a = stripMd(oldText).split(/\s+/).filter(Boolean);
  const b = stripMd(newText).split(/\s+/).filter(Boolean);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { parts.push(esc(a[i])); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { parts.push(`<del class="diff-del">${esc(a[i++])}</del>`); }
    else { parts.push(`<ins class="diff-add">${esc(b[j++])}</ins>`); }
  }
  while (i < m) parts.push(`<del class="diff-del">${esc(a[i++])}</del>`);
  while (j < n) parts.push(`<ins class="diff-add">${esc(b[j++])}</ins>`);
  return parts.join(" ");
}

function bestBulletMatch(bullet, origBullets) {
  const words = new Set(stripMd(bullet).toLowerCase().split(/\W+/).filter(w => w.length > 2));
  let best = origBullets[0] || "", bestScore = -1;
  for (const ob of origBullets) {
    const ow = new Set(stripMd(ob).toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const inter = [...words].filter(w => ow.has(w)).length;
    const union = new Set([...words, ...ow]).size || 1;
    const score = inter / union;
    if (score > bestScore) { bestScore = score; best = ob; }
  }
  return best;
}

function renderDiffPanel() {
  const panel = document.getElementById("diff-panel");
  if (!diffVisible || !useTailored || !baseResume || !resume) {
    panel.hidden = true;
    applyInlineHighlights(false);
    return;
  }

  const sections = [];

  if (stripMd(baseResume.summary) !== stripMd(resume.summary)) {
    sections.push({
      title: "Summary",
      rows: [{ tag: "Rewritten summary", html: diffWords(baseResume.summary, resume.summary) }]
    });
  }

  const skillRows = [];
  (resume.skills || []).forEach(sk => {
    const orig = (baseResume.skills || []).find(o => o.category.toLowerCase() === sk.category.toLowerCase());
    if (!orig) {
      skillRows.push({ tag: `${sk.category} (new line)`, html: `<ins class="diff-add">${esc(sk.items)}</ins>` });
    } else if (orig.items !== sk.items) {
      const origSet = new Set(orig.items.split(",").map(s => s.trim().toLowerCase()));
      const rendered = sk.items.split(",").map(s => s.trim()).filter(Boolean).map(item =>
        origSet.has(item.toLowerCase()) ? esc(item) : `<ins class="diff-add">${esc(item)}</ins>`
      ).join(", ");
      skillRows.push({ tag: `${sk.category} (added/reordered)`, html: rendered });
    }
  });
  if (skillRows.length) sections.push({ title: "Technical Skills", rows: skillRows });

  const bulletRows = [];
  (resume.experience || []).forEach((exp, i) => {
    const orig = (baseResume.experience || []).find(o => o.role === exp.role && o.company === exp.company) || baseResume.experience?.[i];
    if (!orig) return;
    (exp.bullets || []).forEach(b => {
      const match = bestBulletMatch(b, orig.bullets || []);
      if (stripMd(match) !== stripMd(b)) {
        bulletRows.push({ tag: `${exp.role} · ${exp.company}`, html: diffWords(match, b) });
      }
    });
  });
  (resume.projects || []).forEach((pr, i) => {
    const orig = (baseResume.projects || []).find(o => o.title === pr.title) || baseResume.projects?.[i];
    if (!orig) return;
    if (orig.techStack !== pr.techStack) {
      bulletRows.push({ tag: `${pr.title} (Tech stack reordered)`, html: `${esc(pr.techStack)}` });
    }
    (pr.bullets || []).forEach(b => {
      const match = bestBulletMatch(b, orig.bullets || []);
      if (stripMd(match) !== stripMd(b)) {
        bulletRows.push({ tag: pr.title, html: diffWords(match, b) });
      }
    });
  });
  if (bulletRows.length) sections.push({ title: "Experience & Projects", rows: bulletRows });

  panel.innerHTML = `
    <div class="diff-head">
      <h3>Before vs After Tailoring</h3>
      <span>${sections.length ? "Green = added, Red = removed" : "Only keyword emphasis or ordering changed."}</span>
    </div>
    ${sections.map(sec => `
      <div class="diff-sec">
        <div class="diff-sec-title">${esc(sec.title)}</div>
        ${sec.rows.map(r => `<div class="diff-row"><div class="diff-tag">${esc(r.tag)}</div><div>${r.html}</div></div>`).join("")}
      </div>
    `).join("")}`;
  panel.hidden = false;
  applyInlineHighlights(true);
}

function applyInlineHighlights(on) {
  const page = document.querySelector("#resume-container .page");
  if (!page) return;
  page.querySelectorAll(".diff-hl").forEach(el => el.classList.remove("diff-hl"));
  if (!on || !baseResume || !resume) return;

  const sumEl = page.querySelector('[data-field="summary"]');
  if (sumEl && stripMd(baseResume.summary) !== stripMd(resume.summary)) sumEl.classList.add("diff-hl");

  page.querySelectorAll(".skills-list li[data-idx]").forEach(li => {
    const sk = resume.skills?.[+li.dataset.idx];
    const orig = (baseResume.skills || []).find(o => o.category.toLowerCase() === sk?.category?.toLowerCase());
    if (sk && (!orig || orig.items !== sk.items)) li.classList.add("diff-hl");
  });

  page.querySelectorAll('.entry[data-entry-type="experience"][data-idx]').forEach(entry => {
    const idx = +entry.dataset.idx;
    const exp = resume.experience?.[idx];
    const orig = (baseResume.experience || []).find(o => o.role === exp?.role && o.company === exp?.company) || baseResume.experience?.[idx];
    if (!exp || !orig) return;
    entry.querySelectorAll(".entry-bullets li[data-bidx]").forEach(li => {
      const b = exp.bullets?.[+li.dataset.bidx];
      if (b && stripMd(bestBulletMatch(b, orig.bullets || [])) !== stripMd(b)) li.classList.add("diff-hl");
    });
  });

  page.querySelectorAll('.entry[data-entry-type="project"][data-idx]').forEach(entry => {
    const idx = +entry.dataset.idx;
    const pr = resume.projects?.[idx];
    const orig = (baseResume.projects || []).find(o => o.title === pr?.title) || baseResume.projects?.[idx];
    if (!pr || !orig) return;
    entry.querySelectorAll(".entry-bullets li[data-bidx]").forEach(li => {
      const b = pr.bullets?.[+li.dataset.bidx];
      if (b && stripMd(bestBulletMatch(b, orig.bullets || [])) !== stripMd(b)) li.classList.add("diff-hl");
    });
  });
}

function render() {
  const container = document.getElementById("resume-container");
  if (!document.getElementById("resume-renderer-style")) {
    const style = document.createElement("style");
    style.id = "resume-renderer-style";
    style.textContent = RESUME_CSS;
    document.head.appendChild(style);
  }
  container.innerHTML = buildOverleafResumeHTML(resume, { bodyOnly: true });
  renderedKeys = domKeys(container.querySelector(".page"));
  const fit = () => fitResumePage(container.querySelector(".page"));
  fit();
  if (document.fonts?.ready) document.fonts.ready.then(fit);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const s = await chrome.storage.local.get(["latestTailoredResume", "masterGenericResume", "candidateProfile"]);
  baseResume = s.masterGenericResume || s.candidateProfile || null;
  tailoredRecord = s.latestTailoredResume || null;
  useTailored = params.get("mode") !== "master" && !!tailoredRecord?.data;
  resume = JSON.parse(JSON.stringify(useTailored ? tailoredRecord.data : baseResume));

  if (!resume) {
    document.getElementById("title").textContent = "No resume yet";
    document.getElementById("sub").textContent = "Import your resume from the extension setup page first.";
    return;
  }

  const company = params.get("company") || tailoredRecord?.targetCompany || "";
  const role = params.get("role") || tailoredRecord?.targetRole || "";
  document.getElementById("title").textContent = useTailored ? `Resume for ${company || "this job"}` : "Your resume";
  document.getElementById("sub").textContent = useTailored
    ? [role, resume.atsBefore != null ? `ATS match ${resume.atsBefore}% → ${resume.atsAfter}%` + (resume.atsTotal ? ` (${resume.atsMatched}/${resume.atsTotal} keywords)` : "") : "",
      resume.atsSkipped?.length ? `Not added: ${resume.atsSkipped.join(", ")}` : ""].filter(Boolean).join(" · ")
    : resume.name || "";
  document.title = fileTitle(resume.name, useTailored ? company : "");

  if (useTailored && baseResume) document.getElementById("btn-diff").hidden = false;
  if (tailoredRecord?.editedAt && useTailored) setSaveStatus("Edited");

  render();
}

const container = document.getElementById("resume-container");
container.addEventListener("input", () => {
  setSaveStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveEdits().catch(e => setSaveStatus(e.message, true)), 350);
});
container.addEventListener("blur", () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveEdits().catch(e => setSaveStatus(e.message, true));
  }
  fitResumePage(document.querySelector("#resume-container .page"));
});

document.getElementById("btn-diff").addEventListener("click", () => {
  diffVisible = !diffVisible;
  document.getElementById("btn-diff").classList.toggle("active", diffVisible);
  document.getElementById("btn-diff").textContent = diffVisible ? "Hide Changes" : "Compare Changes";
  renderDiffPanel();
});

document.getElementById("btn-copy-tex").addEventListener("click", async () => {
  if (!resume) return;
  syncDomToResume();
  const tex = buildOverleafLatexCode(currentData());
  await navigator.clipboard.writeText(tex);
  const btn = document.getElementById("btn-copy-tex");
  const prev = btn.textContent;
  btn.textContent = "Copied .tex!";
  setTimeout(() => { btn.textContent = prev; }, 1600);
});

document.getElementById("btn-dl-tex").addEventListener("click", () => {
  if (!resume) return;
  syncDomToResume();
  const tex = buildOverleafLatexCode(currentData());
  const blob = new Blob([tex], { type: "application/x-tex;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${document.title || "Resume"}.tex`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById("btn-use-autofill").addEventListener("click", async () => {
  const page = document.querySelector("#resume-container .page");
  if (!page || !resume) return;
  const btn = document.getElementById("btn-use-autofill");
  btn.disabled = true;
  btn.textContent = "Saving PDF…";
  try {
    syncDomToResume();
    fitResumePage(page);
    const pdfBlob = AegisPdfBuilder.buildFromPage(page);
    const filename = `${document.title || "Tailored_Resume"}.pdf`;
    const file = new File([pdfBlob], filename, { type: "application/pdf" });

    const store = await chrome.storage.local.get("autofillProfile");
    const profile = store.autofillProfile || {};
    profile.documents = profile.documents || {};

    // Back up original uploaded resume the first time a tailored PDF becomes active
    if (profile.documents.resume && !profile.documents.masterResume && !profile.documents.resume.isTailored) {
      const orig = await AegisDocStore.getBlob("resume", profile.documents.resume);
      if (orig?.blob) {
        profile.documents.masterResume = await AegisDocStore.put("masterResume", new File([orig.blob], orig.name, { type: orig.type }));
      }
    }

    const meta = await AegisDocStore.put("resume", file);
    meta.isTailored = true;
    profile.documents.resume = meta;
    await chrome.storage.local.set({ autofillProfile: profile });

    setSaveStatus(`Active for Autofill: ${filename}`);
    btn.textContent = "Active for Autofill ✓";
    setTimeout(() => { btn.textContent = "Use for Autofill"; }, 2200);
  } catch (e) {
    setSaveStatus("Could not build PDF: " + e.message, true);
    btn.textContent = "Use for Autofill";
  }
  btn.disabled = false;
});

document.getElementById("btn-pdf").addEventListener("click", () => {
  syncDomToResume();
  window.print();
});
window.addEventListener("beforeprint", () => fitResumePage(document.querySelector("#resume-container .page")));
init();
