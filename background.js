// background.js - AI-backed actions (tailor, cover letter, answers) and opening pages

importScripts("profile-defaults.js", "autofill-data.js", "ai-service.js", "doc-storage.js");

function enableSidePanelOnClick() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}
enableSidePanelOnClick();

chrome.runtime.onInstalled.addListener(async details => {
  enableSidePanelOnClick();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("editor.html?setup=1") });
  }
});

async function load() {
  const s = await chrome.storage.local.get(["autofillProfile", "aiConfig"]);
  const profile = AegisAutofillData.normalize(s.autofillProfile);
  const aiConfig = { ...DEFAULT_AI_CONFIG, ...(s.aiConfig || {}) };
  return { profile, resume: AegisAutofillData.toResumeProfile(profile), ai: new AIService(aiConfig), aiConfig };
}

const handlers = {
  async OPEN_EDITOR(m) {
    const q = new URLSearchParams();
    if (m.section) q.set("section", m.section);
    if (m.setup) q.set("setup", "1");
    await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html" + (q.toString() ? "?" + q : "")) });
    return { success: true };
  },

  async SCAN_JOB(m) {
    const { resume, ai } = await load();
    const text = String(m.jobText || "");
    const key = "scan:" + [...(text + "|" + ai._profileText(resume) + "|" + ai.hasKey)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
    const store = await chrome.storage.local.get("scanCache");
    const cache = store.scanCache || {};
    if (cache[key]) return { success: true, ...cache[key].res };
    const res = await ai.scanJobFit(text, resume);
    if (res.source === "ai") {   // only cache real AI results
      cache[key] = { res, at: Date.now() };
      const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 15);
      await chrome.storage.local.set({ scanCache: Object.fromEntries(keep) });
    }
    return { success: true, ...res };
  },

  async TAILOR_RESUME(m) {
    const { resume, ai } = await load();
    if (!resume.experience.length && !resume.projects.length && !resume.education.length) {
      return { success: false, error: "Your resume details are empty. Opening setup so you can re-read your resume." };
    }
    const data = await ai.tailorResume(m.jobText, resume, m.targetRole, m.targetCompany, m.addKeywords || []);
    // Real re-check: does each scanned requirement now appear in the tailored resume text?
    let after = data.atsAfter, before = data.atsBefore, hit = 0, total = 0, skipped = [];
    if (Array.isArray(m.requirements) && m.requirements.length) {
      const text = ai._profileText(data);
      const isHit = r => r.status === "matched" || ai.hasTerm(text, r.term);
      hit = m.requirements.filter(isHit).length; total = m.requirements.length;
      skipped = m.requirements.filter(r => !isHit(r)).map(r => r.term);
      after = Math.round(100 * hit / total);
      before = Math.round(100 * m.requirements.filter(r => r.status === "matched").length / m.requirements.length);
    }
    data.atsBefore = before; data.atsAfter = after; data.atsMatched = hit; data.atsTotal = total; data.atsSkipped = skipped;   // the viewer header shows these
    await chrome.storage.local.set({
      latestTailoredResume: {
        data, targetRole: m.targetRole, targetCompany: m.targetCompany,
        matchScore: after, usedAI: ai.hasKey, timestamp: Date.now()
      }
    });
    return { success: true, before, after, hit, total, skipped, added: data.addedKeywords, usedAI: ai.hasKey && !data.aiNote, aiNote: data.aiNote || "" };
  },

  async COVER_LETTER(m) {
    const { resume, ai, profile } = await load();
    if (!ai.hasKey) return { success: false, error: "Add a Gemini or Groq API key in Settings to generate a cover letter." };
    try {
      const text = await ai.generateCoverLetter(m.jobText, resume, m.role, m.company);
      const next = { ...profile, coverLetterText: text };
      await chrome.storage.local.set({ autofillProfile: next, coverLetterMeta: { role: m.role, company: m.company, at: Date.now() } });
      return { success: true, text };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async ANSWER_QUESTION(m) {
    const { resume, ai, profile } = await load();
    if (!ai.hasKey) return { success: true, answer: "" };
    const answer = await ai.answerScreeningQuestion(m.question, m.jobContext, resume, {
      noticePeriod: profile.preferences.noticePeriod,
      expectedSalary: profile.preferences.salary,
      currentSalary: profile.preferences.currentCtc,
      location: [profile.personal.city, profile.personal.country].filter(Boolean).join(", "),
      inputType: m.inputType || "textarea",
      maxLength: m.maxLength || 0
    });
    return { success: true, answer };
  },

  async GET_GEMINI_MODELS(m) {
    const { ai, aiConfig } = await load();
    const key = m.apiKey || (aiConfig.geminiKeys || []).find(Boolean) || "";
    if (!key) return { success: false, error: "Enter a Gemini API key first." };
    try {
      const models = await ai.listGeminiModels(key, !!m.refresh);
      return { success: true, models };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async GET_DOCUMENT_DATA(m) {
    const kind = m.kind === "coverLetter" ? "coverLetter" : "resume";
    const s = await chrome.storage.local.get("autofillProfile");
    const profile = AegisAutofillData.normalize(s.autofillProfile);
    const meta = profile.documents?.[kind];
    if (!meta) return { success: true, doc: null };
    const doc = await AegisDocStore.get(kind, meta);
    return { success: true, doc };
  },

  async PARSE_RESUME(m) {
    const { ai } = await load();
    if (!ai.hasKey) return { success: false, error: "NO_KEY" };
    try {
      return { success: true, parsed: await ai.parseResumeText(m.text) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async TEST_AI() {
    const { ai } = await load();
    if (!ai.hasKey) return { success: false, error: "No API key saved." };
    try { return { success: await ai.ping() }; } catch (e) { return { success: false, error: e.message }; }
  },

  async OPEN_RESUME_VIEWER(m) {
    const q = new URLSearchParams();
    ["mode", "company", "role"].forEach(k => m[k] && q.set(k, m[k]));
    await chrome.tabs.create({ url: chrome.runtime.getURL("resume-viewer.html" + (q.toString() ? "?" + q : "")) });
    return { success: true };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fn = handlers[message?.action];
  if (!fn) return false;
  fn(message).then(sendResponse).catch(e => sendResponse({ success: false, error: e.message }));
  return true;
});
