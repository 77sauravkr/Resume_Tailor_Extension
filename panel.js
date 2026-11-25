// panel.js - side panel: job card, one-click autofill, tailoring, cover letter

const $ = id => document.getElementById(id);
let job = { role: "", company: "", text: "", url: "" };
let manualJob = null;           // user-edited job overrides detection for the current tab
let currentTab = null;
let profile = AegisAutofillData.normalize(null);

function say(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = "status " + kind;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function rawSend(tabId, msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, res => resolve(chrome.runtime.lastError ? null : res));
  });
}

// Tabs opened before the extension was installed/reloaded have no content script: inject it and retry.
async function sendToTab(tabId, msg) {
  let res = await rawSend(tabId, msg);
  if (res) return res;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["autofill-data.js", "autofill-engine.js", "content.js"] });
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
  } catch (e) {
    return null;   // chrome:// pages, web store, etc.
  }
  return rawSend(tabId, msg);
}

// ---------- Profile / rows ----------
async function loadProfile() {
  const s = await chrome.storage.local.get(["autofillProfile", "coverLetterMeta", "aiConfig"]);
  const cfg = s.aiConfig || {};
  $("key-hint").hidden = !!((cfg.geminiKeys || []).some(Boolean) || (cfg.groqKeys || []).some(Boolean) || (cfg.openrouterKeys || []).some(Boolean) || cfg.groqKey);
  profile = AegisAutofillData.normalize(s.autofillProfile);
  $("setup-banner").hidden = !AegisAutofillData.isEmpty(profile);
  $("resume-name").textContent = profile.documents.resume?.name || (AegisAutofillData.isEmpty(profile) ? "No resume uploaded" : "Using your saved profile");
  const meta = s.coverLetterMeta;
  const has = !!profile.coverLetterText;
  $("cover-name").textContent = has ? `Generated${meta?.company ? " for " + meta.company : ""}` : "Not generated";
  $("cover-text").hidden = !has;
  $("cover-actions").hidden = !has;
  if (has) $("cover-text").value = profile.coverLetterText;
}

// ---------- Job ----------
let excluded = new Set();      // gap keywords the user tapped off

async function loadJob(force = false) {
  currentTab = await activeTab();
  if (manualJob && manualJob.tabUrl === currentTab?.url) { job = manualJob; return renderJob(); }
  manualJob = null;
  job = { role: "", company: "", text: "", url: currentTab?.url || "" };
  if (currentTab?.id) {
    const res = await sendToTab(currentTab.id, { action: "GET_JOB_DETAILS", force });
    if (res?.success) job = { ...res.data, url: res.data.url || currentTab.url };
  }
  excluded = new Set();
  renderJob();
}

function renderJob() {
  $("in-role").value = job.role || "";
  $("in-company").value = job.company || "";
  $("in-jd").value = job.text || "";
  $("job-avatar").textContent = (job.company || "?").trim().charAt(0).toUpperCase();
  let host = "";
  try { host = new URL(job.url).hostname.replace(/^www\./, ""); } catch (e) {}
  $("job-host").textContent = host || "No page";
  renderMatch();
}

function readJobInputs() {
  job = { role: $("in-role").value.trim(), company: $("in-company").value.trim(), text: $("in-jd").value.trim(), url: currentTab?.url || "" };
  manualJob = { ...job, tabUrl: currentTab?.url };
}

let matchTimer;
for (const id of ["in-role", "in-company", "in-jd"]) {
  $(id).addEventListener("input", () => { readJobInputs(); clearTimeout(matchTimer); matchTimer = setTimeout(renderMatch, 1200); });
}
$("btn-rescan").onclick = () => { manualJob = null; loadJob(true); };

let scan = null, scanSeq = 0;

function setScores(before) {
  $("score-before").textContent = before;
  $("after-box").hidden = true; $("score-arrow").hidden = true;   // the after-score only appears once a resume is really tailored
}

function renderMatch() {
  $("tailor-result").hidden = true;
  $("jd-count").textContent = job.text ? `${job.text.length} chars` : "";
  if (AegisAutofillData.isEmpty(profile) || job.text.length < 60) {
    scanSeq++; scan = null;
    $("kw-wrap").hidden = true; $("kw-empty").hidden = false;
    $("kw-empty").textContent = AegisAutofillData.isEmpty(profile) ? "Import your resume to see your match." : "Open a job posting (or paste the job description) to see how your resume matches.";
    $("btn-tailor").disabled = true; $("score-src").textContent = ""; $("fix-note").textContent = "";
    setScores("--");
    return;
  }
  runScan();
}

// Scans on every popup open / job change: the AI compares the real resume text to this job.
async function runScan() {
  const seq = ++scanSeq;
  $("kw-wrap").hidden = true; $("kw-empty").hidden = false;
  $("kw-empty").textContent = "Scanning your resume against this job…";
  $("btn-tailor").disabled = true; $("score-src").textContent = ""; $("fix-note").textContent = "";
  setScores("…");
  const res = await chrome.runtime.sendMessage({ action: "SCAN_JOB", jobText: job.text }).catch(e => ({ success: false, error: e.message }));
  if (seq !== scanSeq) return;   // a newer scan started
  if (!res?.success || !(res.matched.length + res.gaps.length)) {
    scan = null; setScores("--");
    $("kw-empty").textContent = res?.error ? "Scan failed: " + res.error : "Could not find clear requirements in this job description.";
    return;
  }
  scan = res;
  applyMode(res);
  $("kw-wrap").hidden = false; $("kw-empty").hidden = true;
  $("btn-tailor").disabled = false;
  $("matched-chips").innerHTML = res.matched.map(k => `<span class="chip">${escHtml(k)}</span>`).join("") || '<span class="muted">None yet</span>';
  $("gap-chips").innerHTML = res.gaps.map(g => {
    const tip = g.status === "related" ? "Backed by your resume: " + g.evidence : g.status === "quick" ? "Quick to learn (hours to a few days). Be ready to explain the basics in an interview." : "Hard to pick up fast and no evidence in your resume. Not added unless you tap it.";
    return `<span class="chip gap ${g.status === "quick" ? "quick" : ""} ${excluded.has(g.term) ? "off" : ""}" data-k="${escHtml(g.term)}" title="${escHtml(tip)}">${escHtml(g.term)}</span>`;
  }).join("") || '<span class="muted">No gaps. Your resume already covers this JD.</span>';
  $("matched-n").textContent = `(${res.matched.length})`;
  const rel = res.gaps.filter(g => g.status === "related").length, miss = res.gaps.filter(g => g.status === "missing").length;
  if (res.source === "ai") {
    $("score-src").textContent = "Scored by AI from your resume text";
    $("fix-note").textContent = res.gaps.length ? `${rel} gaps are backed by your resume, ${res.gaps.filter(g => g.status === "quick").length} are quick to learn.` + (miss ? ` ${miss} hard ones are skipped in Safe (tap to force).` : "") : "";
  } else {
    const failed = res.aiNote && res.aiNote !== "no-key";
    $("score-src").textContent = "Keyword match only" + (failed ? " (AI scan failed)" : "");
    if (failed) {
      const lines = res.aiNote.split(" | ").map(l => l.replace(/Invalid API Key|API key not valid[^.]*\.?/i, m => m).slice(0, 140));
      $("fix-note").replaceChildren(...lines.flatMap(l => { const d = document.createElement("div"); d.textContent = l; return [d]; }));
      const b = document.createElement("button"); b.className = "linkish"; b.textContent = "Fix keys in Settings"; b.onclick = () => openEditor("settings");
      $("fix-note").append(b);
    } else $("fix-note").textContent = "Add an AI key in Settings for an AI score.";
  }
  updateScores();
}

const tailorMode = () => document.querySelector('input[name="mode"]:checked')?.value || "safe";
// Safe: gaps with no evidence in the resume are left out. All: every JD gap is added (user's choice).
function applyMode(res = scan) {
  if (!res) return;
  excluded = new Set(tailorMode() === "all" ? [] : res.gaps.filter(g => g.status === "missing").map(g => g.term));
  document.querySelectorAll("#gap-chips .chip.gap").forEach(c => c.classList.toggle("off", excluded.has(c.dataset.k)));
  const rel = res.gaps.filter(g => g.status === "related").length, quick = res.gaps.filter(g => g.status === "quick").length, miss = res.gaps.length - rel - quick;
  const src = res.source === "ai" ? "" : " (AI scan unavailable: local check)";
  $("mode-note").textContent = !res.gaps.length ? "" : tailorMode() === "all"
    ? `All adds all ${res.gaps.length} gaps, including ${miss} hard ones with no evidence.`
    : `Safe adds ${rel} backed + ${quick} quick-to-learn gaps. Skips ${miss} hard ones.${src}`;
}
document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener("change", () => applyMode()));

function selectedGaps() { return scan ? scan.gaps.map(g => g.term).filter(k => !excluded.has(k)) : []; }

function updateScores() {
  if (!scan) return;
  setScores(scan.score + "%");
}

$("gap-chips").addEventListener("click", e => {
  const chip = e.target.closest(".chip.gap");
  if (!chip) return;
  const k = chip.dataset.k;
  excluded.has(k) ? excluded.delete(k) : excluded.add(k);
  chip.classList.toggle("off", excluded.has(k));
  updateScores();
});

const escHtml = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Autofill + completion ----------
function renderCompletion(res) {
  $("completion").hidden = false;
  $("completion-pct").textContent = res.percent + "%";
  $("completion-bar").style.width = res.percent + "%";
  const req = res.items.filter(i => i.required), opt = res.items.filter(i => !i.required);
  const row = i => `<div class="item ${i.filled ? "ok" : "no"}" data-id="${i.id}"><span class="mark">${i.filled ? "✓" : "–"}</span>${i.label.replace(/[<>&]/g, "")}</div>`;
  $("completion-body").innerHTML =
    (req.length ? `<div class="sec">Required (${res.requiredFilled}/${req.length})</div>${req.map(row).join("")}` : "") +
    (opt.length ? `<div class="sec">Optional</div>${opt.map(row).join("")}` : "") +
    (res.items.length ? `<div class="muted" style="margin-top:8px">– means unsure. Click a field to find it on the page.</div>` : `<div class="muted">No fillable fields found on this page.</div>`);
}

$("completion-body").addEventListener("click", e => {
  const item = e.target.closest(".item");
  if (item && currentTab?.id) sendToTab(currentTab.id, { action: "LOCATE_FIELD", id: +item.dataset.id });
});
$("completion-toggle").onclick = () => { $("completion-body").hidden = !$("completion-body").hidden; };

$("btn-autofill").onclick = async () => {
  if (AegisAutofillData.isEmpty(profile)) { say("Import your resume or fill your information first.", "err"); return; }
  const tab = await activeTab();
  if (!tab?.id) return;
  const btn = $("btn-autofill");
  btn.disabled = true; btn.textContent = "Filling…";
  say("");
  const res = await sendToTab(tab.id, { action: "EXECUTE_AUTOFILL" });
  btn.disabled = false; btn.textContent = "Autofill";
  if (!res?.success) { say("Could not reach this page. Reload the tab and try again.", "err"); return; }
  renderCompletion(res);
  say(`Filled ${res.filled} field(s).`, "ok");
};

// ---------- Tailor ----------
$("btn-tailor").onclick = async () => {
  if (AegisAutofillData.isEmpty(profile)) { say("Import your resume first.", "err"); return; }
  readJobInputs();
  const btn = $("btn-tailor");
  btn.disabled = true; btn.textContent = "Tailoring…";
  const res = await chrome.runtime.sendMessage({
    action: "TAILOR_RESUME", jobText: job.text, targetRole: job.role, targetCompany: job.company, addKeywords: selectedGaps(), requirements: scan?.requirements || []
  });
  btn.disabled = false; btn.textContent = "Tailor Resume";
  if (!res?.success) {
    say(res?.error || "Tailoring failed.", "err");
    if (/empty/i.test(res?.error || "")) openEditor("documents");
    return;
  }
  $("score-after").textContent = res.after + "%";
  $("after-label").textContent = "After tailoring";
  $("after-box").hidden = false; $("score-arrow").hidden = false;
  const r = $("tailor-result");
  r.hidden = false;
  const why = res.usedAI ? "" : res.aiNote && res.aiNote !== "no-key"
    ? ` AI failed (${res.aiNote.slice(0, 70)}), so only Skills and Summary were updated.`
    : " No AI key, so only Skills and Summary were updated.";
  r.textContent = `ATS ${res.before}% → ${res.after}%` + (res.total ? ` (${res.hit} of ${res.total} job keywords are on your tailored resume).` : ".") + (res.skipped?.length ? ` Not added: ${res.skipped.join(", ")}.` : "") + (res.added?.length ? ` Added: ${res.added.join(", ")}.` : "") + why + " Opening your resume…";
  chrome.runtime.sendMessage({ action: "OPEN_RESUME_VIEWER", mode: "tailored", company: job.company, role: job.role });
};

// ---------- Cover letter ----------
$("btn-cover").onclick = async () => {
  readJobInputs();
  if (!job.text || job.text.length < 80) { say("Paste the job description first.", "err"); return; }
  const btn = $("btn-cover");
  btn.disabled = true; btn.textContent = "Writing…";
  const res = await chrome.runtime.sendMessage({ action: "COVER_LETTER", jobText: job.text, role: job.role, company: job.company });
  btn.disabled = false; btn.textContent = "Generate Cover Letter";
  if (!res?.success) { say(res?.error || "Could not generate.", "err"); return; }
  await loadProfile();
  say("Cover letter ready. Autofill will use it for cover letter boxes.", "ok");
};
$("cover-text").addEventListener("change", async () => {
  const s = await chrome.storage.local.get("autofillProfile");
  const p = AegisAutofillData.normalize(s.autofillProfile);
  p.coverLetterText = $("cover-text").value;
  await chrome.storage.local.set({ autofillProfile: p });
});
$("btn-copy-cover").onclick = async () => { await navigator.clipboard.writeText($("cover-text").value); say("Copied.", "ok"); };

// ---------- Navigation ----------
const openEditor = (section, setup) => chrome.runtime.sendMessage({ action: "OPEN_EDITOR", section, setup });
$("btn-settings").onclick = () => openEditor("settings");
$("btn-addkey").onclick = () => openEditor("settings");
$("row-info").onclick = () => openEditor("personal");
$("row-resume").onclick = () => openEditor("documents");
$("btn-setup").onclick = () => openEditor("", true);
$("btn-another").onclick = () => { $("completion").hidden = true; say(""); manualJob = null; loadJob(true); };

// ---------- Live updates ----------
chrome.tabs.onActivated.addListener(() => loadJob());
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "complete" && currentTab?.id === id) loadJob(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.autofillProfile) loadProfile().then(renderMatch); });

(async function init() {
  await loadProfile();
  await loadJob();
})();
