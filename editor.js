// editor.js - Edit everything used for autofill and resume tailoring.
// Data lives in chrome.storage.local.autofillProfile; the resume shape is derived on save.

const D = AegisAutofillData;
const DEGREES = ["", "High School", "Associate", "Bachelor of Engineering", "Bachelor of Technology", "Bachelor of Science",
  "Bachelor of Arts", "Master of Science", "Master of Technology", "MBA", "PhD", "Other"];
const YES_NO = ["Yes", "No", "Decline to answer"];
const COUNTRIES = ["United States", "Canada", "United Kingdom", "Australia", "Ireland", "New Zealand", "India"];

// Blocks: grid (object at path) | list (array at path) | custom
const SECTIONS = [
  { id: "personal", title: "Personal", hint: "Used for name, contact and address fields.", blocks: [{ grid: "personal", fields: [
    ["firstName", "First name", { req: 1 }], ["middleName", "Middle name"], ["lastName", "Last name", { req: 1 }],
    ["email", "Email", { req: 1, type: "email", w: 6 }],
    ["phoneType", "Phone type", { select: ["Mobile", "Home", "Work"] }], ["countryCode", "Country code"], ["phone", "Phone", { req: 1 }],
    ["address", "Address line", { w: 6 }],
    ["country", "Country"], ["state", "State / Province"], ["city", "City"],
    ["postalCode", "Postal code"],
    ["linkedin", "LinkedIn URL", { w: 6 }], ["github", "GitHub URL", { w: 6 }], ["portfolio", "Portfolio URL", { w: 6 }]
  ] }] },
  { id: "education", title: "Education", blocks: [{ list: "education", item: "Education", add: "Add education", fields: [
    ["school", "School name", { req: 1, w: 6 }], ["major", "Major", { req: 1 }],
    ["degree", "Degree type", { req: 1, select: DEGREES, free: 1 }], ["gpa", "GPA"],
    ["location", "Location", { w: 3 }], ["start", "Start date", { type: "month", w: 3 }], ["end", "End date", { type: "month", w: 3 }],
    ["current", "I currently study here", { check: 1, w: 6 }]
  ] }] },
  { id: "work", title: "Work experience", hint: "Put one bullet per line in the description. The resume uses these bullets.", blocks: [{ list: "work", item: "Experience", add: "Add experience", fields: [
    ["title", "Job title", { req: 1, w: 3 }], ["company", "Company", { req: 1, w: 3 }],
    ["type", "Job type", { select: ["Full-time", "Part-time", "Internship", "Contract", "Freelance"], w: 3 }], ["location", "Location", { w: 3 }],
    ["start", "Start date", { type: "month", w: 3 }], ["end", "End date", { type: "month", w: 3 }],
    ["current", "I currently work here", { check: 1, w: 6 }],
    ["description", "Description (one bullet per line)", { area: 1, w: 6 }]
  ] }] },
  { id: "skills", title: "Skills", hint: "Flat list for skill fields on application forms. Your resume skill groups are in Resume content.", blocks: [{ text: "skills", rows: 6 }] },
  { id: "resume", title: "Resume content", hint: "Used to build and tailor your 1-page resume.", blocks: [
    { sub: "Summary" }, { text: "resume.summary", rows: 4 },
    { sub: "Skill groups" }, { list: "resume.skillGroups", item: "Group", add: "Add group", fields: [
      ["category", "Category", { w: 3 }], ["items", "Items (comma separated)", { w: 6 }]] },
    { sub: "Projects" }, { list: "resume.projects", item: "Project", add: "Add project", fields: [
      ["title", "Title", { w: 3 }], ["techStack", "Tech stack", { w: 3 }],
      ["codeUrl", "Code URL", { w: 3 }], ["liveUrl", "Live URL", { w: 3 }],
      ["bullets", "Bullets (one per line)", { area: 1, w: 6 }]] },
    { sub: "Achievements" }, { list: "resume.achievements", item: "Achievement", add: "Add achievement", fields: [
      ["text", "Text", { w: 6 }], ["url", "Link (optional)", { w: 6 }]] }
  ] },
  { id: "eeo", title: "Equal employment", hint: "Only used to answer application questions. Never shared.", blocks: [{ grid: "eeo", fields: [
    ["authorized", "Authorized to work in the country you apply to", { select: YES_NO, w: 3 }],
    ["sponsorship", "Require visa sponsorship", { select: YES_NO, w: 3 }],
    ["disability", "Disability", { select: YES_NO, w: 3 }], ["veteran", "Veteran", { select: YES_NO, w: 3 }],
    ["gender", "Gender", { select: ["", "Male", "Female", "Non-binary", "Decline to answer"], w: 3 }],
    ["lgbtq", "LGBTQ+", { select: YES_NO, w: 3 }], ["race", "Race / ethnicity", { w: 3 }]
  ] }, { countries: true }] },
  { id: "preferences", title: "Preferences", blocks: [{ grid: "preferences", fields: [
    ["salary", "Expected salary", { w: 3 }], ["currentCtc", "Current salary", { w: 3 }],
    ["noticePeriod", "Notice period", { w: 3 }], ["startDate", "Available start date", { w: 3 }],
    ["source", "How did you hear about us", { w: 3 }],
    ["notes", "Anything else we should know", { area: 1, w: 6 }]
  ] }] },
  { id: "signup", title: "Sign-up", hint: "Used when a portal (e.g. Workday) requires an account. Stored only in this browser's local storage.",
    blocks: [{ grid: "signup", fields: [["email", "Registration email", { type: "email", w: 6 }], ["password", "Password", { type: "password", w: 6 }]] }] },
  { id: "documents", title: "Documents", hint: "Your resume is attached to resume upload fields. PDF or DOCX, stored in IndexedDB.", blocks: [{ documents: true }] },
  { id: "settings", title: "Settings", hint: "AI key for resume extraction, tailoring and cover letters. Stored only in this browser.", blocks: [{ settings: true }], noSave: true }
];

const WIZARD = ["import", "personal", "education", "work", "skills", "eeo"];
const WIZARD_TITLES = { import: "Import", personal: "Personal", education: "Education", work: "Work Experience", skills: "Skill", eeo: "Equal Employment" };

let state = D.normalize(null);
let active = "personal";
const params = new URLSearchParams(location.search);
let setup = params.get("setup") === "1";
let step = 0;

const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else el[k] = v; }
  kids.flat().forEach(k => k != null && k !== false && el.append(k));
  return el;
};
const getPath = (path, root = state) => path.split(".").reduce((o, k) => o[k], root);

function fieldEl(obj, [key, label, o = {}]) {
  const id = "f" + Math.random().toString(36).slice(2, 8);
  let input;
  if (o.check) {
    input = h("input", { type: "checkbox", id, checked: !!obj[key] });
    input.onchange = () => { obj[key] = input.checked; };
    return h("div", { class: "f check w6" }, input, h("label", { htmlFor: id, text: label }));
  }
  if (o.select) {
    input = h("select", { id });
    (o.free && obj[key] && !o.select.includes(obj[key]) ? [...o.select, obj[key]] : o.select)
      .forEach(v => input.append(h("option", { value: v, text: v || "Select" })));
    input.value = obj[key] || "";
    input.onchange = () => { obj[key] = input.value; };
  } else if (o.area) {
    input = h("textarea", { id, value: obj[key] || "" });
    input.oninput = () => { obj[key] = input.value; };
  } else {
    input = h("input", { id, type: o.type || "text", value: obj[key] || "" });
    input.oninput = () => { obj[key] = input.value; };
  }
  return h("div", { class: `f ${o.w === 3 ? "w3" : o.w === 6 ? "w6" : ""}` },
    h("label", { htmlFor: id, class: o.req ? "req" : "", text: label }), input);
}

const grid = (obj, fields) => h("div", { class: "grid" }, fields.map(f => fieldEl(obj, f)));

function listBlock(b) {
  const arr = getPath(b.list);
  const wrap = h("div");
  arr.forEach((item, i) => {
    const rm = h("button", { class: "link", text: "Remove" });
    rm.onclick = () => { arr.splice(i, 1); render(); };
    wrap.append(h("div", { class: "card" }, h("div", { class: "card-head" }, h("span", { text: `${b.item} ${i + 1}` }), rm), grid(item, b.fields)));
  });
  const add = h("button", { class: "add", text: "+ " + b.add });
  add.onclick = () => { arr.push({}); render(); };
  wrap.append(add);
  return wrap;
}

function textBlock(b) {
  const keys = b.text.split(".");
  const last = keys.pop();
  const obj = keys.reduce((o, k) => o[k], state);
  const t = h("textarea", { value: obj[last] || "", style: `min-height:${(b.rows || 4) * 24}px` });
  t.oninput = () => { obj[last] = t.value; };
  return t;
}

function countriesBlock() {
  const sel = state.eeo.workCountries;
  return h("div", { style: "margin-top:18px" }, h("div", { class: "lbl", text: "Countries where you want to work", style: "margin-bottom:8px" }),
    h("div", { class: "chips" }, COUNTRIES.map(c => {
      const cb = h("input", { type: "checkbox", checked: sel.includes(c) });
      cb.onchange = () => { const at = sel.indexOf(c); if (cb.checked && at < 0) sel.push(c); else if (!cb.checked && at >= 0) sel.splice(at, 1); };
      return h("label", {}, cb, c);
    })));
}

// ---------- Resume import / documents ----------
function notice(msg, kind = "") { return h("div", { class: "notice " + kind, text: msg }); }

async function loadAiConfig() {
  const { aiConfig } = await chrome.storage.local.get("aiConfig");
  return { ...DEFAULT_AI_CONFIG, ...(aiConfig || {}) };
}

function importCard() {
  const msg = h("div");
  const input = h("input", { type: "file", accept: ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document", hidden: true });
  const pick = h("button", { class: "mint", text: "Upload resume (PDF / DOCX)" });
  const pasteBtn = h("button", { class: "secondary", text: "Import pasted text" });
  const paste = h("textarea", { placeholder: "…or paste your resume text here", style: "margin-top:14px;min-height:110px" });
  const keyInput = h("input", { type: "password", placeholder: "Gemini API key (free at aistudio.google.com)" });
  loadAiConfig().then(c => { keyInput.value = c.geminiKeys?.[0] || ""; });

  const run = async fn => {
    pick.disabled = pasteBtn.disabled = true;
    msg.replaceChildren(notice("Reading your resume…"));
    try {
      if (keyInput.value.trim()) {
        const cfg = await loadAiConfig();
        await chrome.storage.local.set({ aiConfig: { ...cfg, geminiKeys: [keyInput.value.trim(), ...(cfg.geminiKeys || []).slice(1).filter(Boolean)] } });
      }
      const { profile, mode, warning } = await fn();
      state = profile;
      await persist();
      msg.replaceChildren(notice(warning || "Done. Review each step and fix anything that looks off.", warning ? "warn" : ""));
      if (setup && !warning) { step = 1; render(); }
    } catch (e) {
      msg.replaceChildren(notice(e.message, "err"));
    }
    pick.disabled = pasteBtn.disabled = false;
  };
  pick.onclick = () => input.click();
  input.onchange = () => input.files[0] && run(() => ResumeImport.importFile(input.files[0], state));
  pasteBtn.onclick = () => paste.value.trim() && run(() => ResumeImport.importText(paste.value, state));

  return h("div", {},
    h("div", { class: "drop" }, h("b", { text: "Import your resume" }),
      h("p", { text: "We extract your details and fill the profile for you. Everything stays in this browser." }), pick, input),
    h("div", { class: "f w6" }, h("label", { text: "AI key (recommended: needed for full extraction, tailoring and cover letters)" }), keyInput),
    paste, h("div", { style: "margin-top:10px" }, pasteBtn), h("div", { style: "margin-top:14px" }, msg));
}

// Re-run extraction on the resume file already stored in IndexedDB (or legacy storage).
async function reimportStored() {
  // When a tailored PDF is active for autofill, read the backed-up original instead.
  const key = state.documents.masterResume?.name ? "masterResume" : "resume";
  const loaded = await AegisDocStore.getBlob(key, state.documents[key]);
  if (!loaded?.blob) throw new Error("Upload your resume first.");
  const file = new File([loaded.blob], loaded.name || "resume.pdf", { type: loaded.type || "application/pdf" });
  const { profile, warning } = await ResumeImport.importFile(file, state, { keepDocuments: true });
  state = profile;
  await persist();
  return warning;
}

function documentsBlock() {
  const wrap = h("div", {}, importCard(), h("div", { class: "sub-h", text: "Files used for upload fields" }));
  [["resume", "Resume"], ["coverLetter", "Cover letter"]].forEach(([key, title]) => {
    const name = h("span", { text: state.documents[key]?.name || "Not uploaded" });
    const input = h("input", { type: "file", accept: ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document", hidden: true });
    const pick = h("button", { class: "secondary", text: "Upload" });
    const clear = h("button", { class: "link", text: "Remove" });
    pick.onclick = () => input.click();
    clear.onclick = async () => {
      await AegisDocStore.remove(key);
      state.documents[key] = null;
      if (key === "resume") {
        await AegisDocStore.remove("masterResume");
        state.documents.masterResume = null;
      }
      await persist();
      render();
      setStatus("Removed.");
    };
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) return setStatus("File is larger than 10 MB", true);
      try {
        state.documents[key] = await AegisDocStore.put(key, f);
        if (key === "resume") {
          await AegisDocStore.remove("masterResume");
          state.documents.masterResume = null;
        }
        await persist();
        name.textContent = f.name;
        render();
        setStatus("Saved to browser storage.");
      } catch (e) {
        setStatus("Could not save file: " + e.message, true);
      }
    };
    const extra = [];
    if (key === "resume") {
      if (state.documents.masterResume?.name) {
        const restore = h("button", { class: "secondary", text: "Restore original", title: `Switch back to ${state.documents.masterResume.name}` });
        restore.onclick = async () => {
          const orig = await AegisDocStore.getBlob("masterResume", state.documents.masterResume);
          if (!orig?.blob) return setStatus("Original resume backup not found.", true);
          state.documents.resume = await AegisDocStore.put("resume", new File([orig.blob], orig.name, { type: orig.type }));
          state.documents.masterResume = null;
          await AegisDocStore.remove("masterResume");
          await persist();
          render();
          setStatus("Restored original resume.");
        };
        extra.push(restore);
      }
      const reread = h("button", { class: "secondary", text: "Re-read resume" });
      reread.onclick = async () => {
        reread.disabled = true;
        try { const w = await reimportStored(); render(); setStatus(w || "Resume read again. Check Work experience and Education."); }
        catch (e) { setStatus(e.message, true); }
        reread.disabled = false;
      };
      extra.push(reread);
    }
    wrap.append(h("div", { class: "doc" }, h("b", { text: title }), name, pick, ...extra, clear, input));
  });
  return wrap;
}

function settingsBlock() {
  const wrap = h("div");
  // One list of key inputs per engine; "+" adds another key, "x" removes one. Keys are tried in order.
  const keyList = (placeholder) => {
    const box = h("div", { class: "keylist" });
    const add = (v = "") => {
      const input = h("input", { type: "password", placeholder, value: v });
      const del = h("button", { class: "secondary keydel", text: "×", title: "Remove this key", type: "button" });
      const row = h("div", { class: "keyrow" }, input, del);
      del.onclick = () => { row.remove(); if (!box.children.length) add(); };
      box.append(row);
    };
    const plus = h("button", { class: "secondary keyadd", text: "+", title: "Add another key (used if the one above hits its limit)", type: "button" });
    plus.onclick = () => add();
    const values = () => [...box.querySelectorAll("input")].map(i => i.value.trim()).filter(Boolean);
    const fill = vals => { box.replaceChildren(); (vals.length ? vals : [""]).forEach(add); };
    fill([]);
    return { box, plus, values, fill };
  };
  const gem = keyList("AIza…");
  const groq = keyList("gsk_…");
  const orr = keyList("sk-or-v1-…");
  const eng = h("select", {}, ...[["gemini", "Gemini (recommended)"], ["groq", "Groq"], ["openrouter", "OpenRouter"]].map(([v, t]) => h("option", { value: v, text: t })));
  const gemModel = h("select", {}, h("option", { value: "auto", text: "Auto (recommended — live models)" }));
  const refreshModelsBtn = h("button", { class: "secondary", text: "Refresh", type: "button", title: "Fetch available Gemini models from API" });
  const msg = h("div", { style: "margin-top:12px" });

  const populateGemModels = (models, selectedVal) => {
    const cur = selectedVal ?? gemModel.value ?? "auto";
    const opts = [["auto", "Auto (recommended — live models)"]];
    (models || []).forEach(id => { if (id && id !== "auto") opts.push([id, id]); });
    if (cur && cur !== "auto" && !opts.some(([v]) => v === cur)) opts.push([cur, `${cur} (saved)`]);
    gemModel.replaceChildren(...opts.map(([v, t]) => h("option", { value: v, text: t })));
    gemModel.value = cur;
  };

  const fetchGemModels = async (refresh = false, selectedVal) => {
    const apiKey = gem.values()[0] || "";
    if (!apiKey) {
      if (refresh) msg.replaceChildren(notice("Enter a Gemini API key first.", "err"));
      return;
    }
    refreshModelsBtn.disabled = true;
    const r = await chrome.runtime.sendMessage({ action: "GET_GEMINI_MODELS", apiKey, refresh }).catch(() => null);
    refreshModelsBtn.disabled = false;
    if (r?.success && Array.isArray(r.models)) {
      populateGemModels(r.models, selectedVal);
      if (refresh) msg.replaceChildren(notice(`Loaded ${r.models.length} Gemini models.`));
    } else if (refresh && r?.error) {
      msg.replaceChildren(notice(r.error, "err"));
    }
  };
  refreshModelsBtn.onclick = () => fetchGemModels(true);

  loadAiConfig().then(c => {
    gem.fill((c.geminiKeys || []).filter(Boolean));
    groq.fill([...(c.groqKeys || []), c.groqKey].filter(Boolean).filter((k, i, a) => a.indexOf(k) === i));
    orr.fill((c.openrouterKeys || []).filter(Boolean));
    eng.value = c.preferredProvider || "gemini";
    const savedModel = c.geminiModel || "auto";
    populateGemModels([], savedModel);
    if ((c.geminiKeys || []).some(Boolean)) fetchGemModels(false, savedModel);
  });
  const save = async () => chrome.storage.local.set({
    aiConfig: {
      geminiKeys: gem.values(),
      groqKeys: groq.values(),
      openrouterKeys: orr.values(),
      groqKey: "",
      geminiModel: gemModel.value || "auto",
      preferredProvider: eng.value
    }
  });
  const saveBtn = h("button", { class: "mint", text: "Save keys" });
  const testBtn = h("button", { class: "secondary", text: "Test" });
  saveBtn.onclick = async () => { await save(); msg.replaceChildren(notice("Saved.")); };
  testBtn.onclick = async () => {
    await save();
    msg.replaceChildren(notice("Testing…"));
    const r = await chrome.runtime.sendMessage({ action: "TEST_AI" });
    msg.replaceChildren(r?.success ? notice("Key works.") : notice(r?.error || "Key did not work.", "err"));
  };
  const keyField = (label, kl) => h("div", { class: "f w6" }, h("label", { text: label }), kl.box, h("div", {}, kl.plus));
  wrap.append(
    h("div", { class: "grid" },
      keyField("Gemini API keys", gem),
      keyField("Groq API keys (optional fallback)", groq),
      keyField("OpenRouter API keys (optional fallback, free models need no card)", orr),
      h("div", { class: "f w3" }, h("label", { text: "Preferred engine" }), eng),
      h("div", { class: "f w3" }, h("label", { text: "Gemini model" }), h("div", { style: "display:flex;gap:8px" }, gemModel, refreshModelsBtn))),
    h("div", { class: "muted", style: "margin-top:10px" }, "If a key hits its limit or fails, the next key is used, then the other engine."),
    h("div", { style: "margin-top:16px;display:flex;gap:10px" }, saveBtn, testBtn), msg);
  return wrap;
}

// ---------- Render ----------
function renderBlock(b) {
  if (b.sub) return h("div", { class: "sub-h", text: b.sub });
  if (b.grid) return grid(getPath(b.grid), b.fields);
  if (b.list) return listBlock(b);
  if (b.text) return textBlock(b);
  if (b.countries) return countriesBlock();
  if (b.documents) return documentsBlock();
  if (b.settings) return settingsBlock();
}

function render() {
  document.body.classList.toggle("setup", setup);
  $("#aside").hidden = setup;
  $("#steps").hidden = !setup;
  $("#back").hidden = !setup || step === 0;
  $("#next").hidden = !setup;
  $("#next").textContent = step === WIZARD.length - 1 ? "Finish" : "Next";
  $("#save").hidden = setup;

  const id = setup ? WIZARD[step] : active;
  if (setup) {
    $("#steps").replaceChildren(...WIZARD.map((w, i) =>
      h("div", { class: "step " + (i === step ? "on" : i < step ? "done" : "") }, h("i", { text: i < step ? "✓" : String(i) }), WIZARD_TITLES[w])));
  } else {
    $("#nav").replaceChildren(...SECTIONS.map(s => {
      const b = h("button", { text: s.title, class: s.id === active ? "active" : "" });
      b.onclick = () => { active = s.id; render(); };
      return b;
    }));
  }

  const pane = $("#pane");
  if (id === "import") {
    pane.replaceChildren(h("h2", { text: "Set up your profile" }), h("p", { class: "hint", text: "Import your resume once. You can review and edit everything in the next steps." }), importCard());
    return;
  }
  const sec = SECTIONS.find(s => s.id === id);
  $("#save").hidden = setup || !!sec.noSave;
  pane.replaceChildren(h("h2", { text: sec.title }), h("p", { class: "hint", text: sec.hint || "" }), ...sec.blocks.map(renderBlock));
}

function setStatus(msg, bad) {
  const el = $("#status");
  el.textContent = msg;
  el.style.color = bad ? "#b91c1c" : "#15803d";
  clearTimeout(setStatus.t);
  setStatus.t = setTimeout(() => { el.textContent = ""; }, 2500);
}

async function persist() {
  for (const key of ["resume", "coverLetter"]) {
    if (state.documents[key]?.dataUrl) {
      state.documents[key] = await AegisDocStore.put(key, state.documents[key]);
    }
  }
  const resume = D.toResumeProfile(state);
  await chrome.storage.local.set({ autofillProfile: state, candidateProfile: resume, masterGenericResume: resume });
}

async function init() {
  const store = await chrome.storage.local.get("autofillProfile");
  state = D.normalize(store.autofillProfile);
  // Migrate any legacy base64 blobs out of chrome.storage.local into IndexedDB
  let migrated = false;
  for (const key of ["resume", "coverLetter"]) {
    if (state.documents[key]?.dataUrl) {
      state.documents[key] = await AegisDocStore.put(key, state.documents[key]);
      migrated = true;
    }
  }
  if (migrated) await persist();
  if (params.get("section") && SECTIONS.some(s => s.id === params.get("section"))) active = params.get("section");
  if (setup && !D.isEmpty(state)) step = 1;

  $("#save").onclick = async () => {
    try { await persist(); setStatus("Saved"); } catch (e) { setStatus("Could not save: " + e.message, true); }
  };
  $("#back").onclick = () => { step = Math.max(0, step - 1); render(); };
  $("#next").onclick = async () => {
    await persist();
    if (step === WIZARD.length - 1) {
      setup = false; active = "personal";
      history.replaceState(null, "", "editor.html");
      render();
      setStatus("All set. Open a job application and click Autofill in the side panel.");
      return;
    }
    step++; render();
  };
  render();

  // A resume was uploaded earlier but nothing was extracted (older version / failed parse): read it again.
  if (state.documents.resume?.name && !state.work.length && !state.education.length && !state.resume.projects.length) {
    try { await reimportStored(); render(); setStatus("Re-read your saved resume. Please review the details."); }
    catch (e) { /* leave the form as is */ }
  }
}

init();
