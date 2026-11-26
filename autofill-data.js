// autofill-data.js - Autofill profile schema, defaults and parsing helpers.
// Shared by the editor page (autofill.html) and the content script.
(function (root) {
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  // "Dec. 2021" -> "2021-12", "Present" -> current flag
  function parseMonth(str) {
    if (!str) return { value: "", current: false };
    if (/present|current|now/i.test(str)) return { value: "", current: true };
    const m = String(str).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
    if (m) return { value: `${m[2]}-${String(MONTHS[m[1].toLowerCase()] || 1).padStart(2, "0")}`, current: false };
    const y = String(str).match(/\d{4}/);
    return { value: y ? `${y[0]}-01` : "", current: false };
  }

  function parseRange(str) {
    const [a, b] = String(str || "").split(/\s*(?:--|—|–)\s*|\s+to\s+/);
    const start = parseMonth(a);
    const end = parseMonth(b);
    return { start: start.value, end: end.value, current: end.current };
  }

  function emptyProfile() {
    return {
      personal: {
        firstName: "", middleName: "", lastName: "",
        prefFirst: "", prefMiddle: "", prefLast: "",
        email: "", phoneType: "Mobile", countryCode: "", phone: "",
        address: "", country: "", state: "", city: "", county: "", postalCode: "",
        linkedin: "", github: "", portfolio: ""
      },
      education: [],
      work: [],
      skills: "",
      eeo: {
        workCountries: [], authorized: "Yes", sponsorship: "No",
        disability: "No", veteran: "No", gender: "", lgbtq: "No", race: ""
      },
      preferences: { salary: "", currentCtc: "", noticePeriod: "", startDate: "", source: "LinkedIn", notes: "" },
      signup: { email: "", password: "" },
      documents: { resume: null, coverLetter: null, masterResume: null },
      coverLetterText: "",
      resumeText: "",
      resume: { summary: "", skillGroups: [], projects: [], achievements: [] }
    };
  }

  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (v === undefined || v === null ? "" : String(v).trim());
  const lines = v => (Array.isArray(v) ? v.map(x => str(x).replace(/\s+([.,;:])/g, "$1")).filter(Boolean).join("\n") : str(v));
  const month = v => { const m = str(v).match(/^(\d{4})-(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}` : ""; };

  // Build a profile from the structured JSON an AI (or the heuristic parser) returns.
  function fromParsed(parsed) {
    const out = emptyProfile();
    if (!parsed || typeof parsed !== "object") return out;
    const p = parsed.personal || {};
    for (const k of Object.keys(out.personal)) if (p[k] !== undefined && p[k] !== null && k !== "phoneType") out.personal[k] = str(p[k]);
    out.personal.phone = out.personal.phone.replace(/\D/g, "").slice(-10) || out.personal.phone;
    if (!/^\+/.test(out.personal.countryCode)) out.personal.countryCode = out.personal.countryCode ? "+" + out.personal.countryCode.replace(/\D/g, "") : "";

    out.work = arr(parsed.work).map(w => ({
      title: str(w.title), company: str(w.company), type: str(w.type) || "Full-time", location: str(w.location),
      start: month(w.start), end: month(w.end), current: !!w.current || /present|current/i.test(str(w.end)),
      description: lines(w.bullets || w.description)
    }));
    out.education = arr(parsed.education).map(e => ({
      school: str(e.school), location: str(e.location), degree: str(e.degree), major: str(e.major), gpa: str(e.gpa),
      start: month(e.start), end: month(e.end), current: !!e.current
    }));
    out.resume.summary = str(parsed.summary);
    out.resume.skillGroups = arr(parsed.skillGroups).map(g => ({
      category: str(g.category), items: Array.isArray(g.items) ? g.items.map(str).join(", ") : str(g.items)
    })).filter(g => g.items);
    out.resume.projects = arr(parsed.projects).map(x => ({
      title: str(x.title), techStack: Array.isArray(x.techStack) ? x.techStack.join(", ") : str(x.techStack),
      codeUrl: str(x.codeUrl), liveUrl: str(x.liveUrl), bullets: lines(x.bullets || x.description)
    })).filter(x => x.title);
    out.resume.achievements = arr(parsed.achievements).map(a => ({
      text: (typeof a === "string" ? a : str(a.text)).replace(/\s+([.,;:])/g, "$1").replace(/\s*[-–—]\s*(Profile|Details|Link|Certificate|Credential)\s*$/i, "").trim(), url: typeof a === "string" ? "" : str(a.url)
    })).filter(a => a.text);

    const seen = new Set();
    out.skills = out.resume.skillGroups.flatMap(g => g.items.split(","))
      .map(s => s.trim())
      .filter(s => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
      .join(", ");
    out.signup.email = out.personal.email;
    return out;
  }

  // Overlay a freshly parsed profile on the current one: parsed values win, but
  // anything the user already typed for fields the parser left empty is kept.
  function mergeParsed(current, parsed) {
    const base = normalize(current);
    const next = normalize(parsed);
    for (const k of Object.keys(next.personal)) if (next.personal[k]) base.personal[k] = next.personal[k];
    for (const k of ["education", "work"]) if (next[k].length) base[k] = next[k];
    if (next.skills) base.skills = next.skills;
    if (next.resume.summary) base.resume.summary = next.resume.summary;
    for (const k of ["skillGroups", "projects", "achievements"]) if (next.resume[k].length) base.resume[k] = next.resume[k];
    if (!base.signup.email) base.signup.email = base.personal.email;
    return base;
  }

  const MONTH_LABEL = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
  const label = v => { const m = month(v); return m ? `${MONTH_LABEL[+m.slice(5) - 1]} ${m.slice(0, 4)}` : ""; };
  const rangeLabel = e => [label(e.start), e.current ? "Present" : label(e.end)].filter(Boolean).join(" -- ");
  const splitLines = v => str(v).split(/\r?\n/).map(s => s.replace(/^[\s\-•*·]+/, "").trim()).filter(Boolean);

  // Derive the resume shape that the tailoring engine and Overleaf renderer use.
  function toResumeProfile(profile) {
    const p = normalize(profile);
    const pe = p.personal, r = p.resume;
    const links = [["LinkedIn", pe.linkedin], ["GitHub", pe.github], ["Portfolio", pe.portfolio]]
      .filter(([, u]) => u).map(([label, url]) => ({ label, url }));
    return {
      name: [pe.firstName, pe.middleName, pe.lastName].filter(Boolean).join(" "),
      contact: {
        phone: [pe.countryCode, pe.phone].filter(Boolean).join(" "),
        email: pe.email,
        city: [pe.city, pe.state].filter(Boolean).join(", "),
        links
      },
      summary: r.summary,
      skills: r.skillGroups.length ? r.skillGroups.map(g => ({ category: g.category, items: g.items }))
        : (p.skills ? [{ category: "Skills", items: p.skills }] : []),
      experience: p.work.filter(w => w.title || w.company).map(w => ({
        role: w.title, company: w.company, location: w.location,
        date: rangeLabel(w), bullets: splitLines(w.description)
      })),
      projects: r.projects.map(x => ({
        title: x.title, techStack: x.techStack,
        links: [["Code", x.codeUrl], ["Live", x.liveUrl]].filter(([, u]) => u).map(([label, url]) => ({ label, url })),
        bullets: splitLines(x.bullets)
      })),
      education: p.education.filter(e => e.school).map(e => ({
        institution: e.school, location: e.location,
        degree: e.major && !new RegExp("\\b" + e.major.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i").test(e.degree) ? `${e.degree} in ${e.major}`.trim() : e.degree,
        gpa: e.gpa || "",
        date: rangeLabel(e)
      })),
      achievements: r.achievements.map(a => ({
        text: a.text, ...(a.url ? { link: { label: "Details", url: a.url } } : {})
      }))
    };
  }

  function isEmpty(profile) {
    const p = normalize(profile);
    return !p.personal.firstName && !p.personal.email && !p.work.length && !p.education.length;
  }

  // Merge stored data over defaults so newly added keys always exist.
  function normalize(stored, seed) {
    const base = emptyProfile();
    const src = stored || seed || base;
    return {
      personal: { ...base.personal, ...src.personal },
      education: Array.isArray(src.education) ? src.education : [],
      work: Array.isArray(src.work) ? src.work : [],
      skills: src.skills || "",
      eeo: { ...base.eeo, ...src.eeo },
      preferences: { ...base.preferences, ...src.preferences },
      signup: { ...base.signup, ...src.signup },
      documents: { ...base.documents, ...src.documents },
      coverLetterText: src.coverLetterText || "",
      resumeText: src.resumeText || "",
      resume: {
        summary: src.resume?.summary || "",
        skillGroups: Array.isArray(src.resume?.skillGroups) ? src.resume.skillGroups : [],
        projects: Array.isArray(src.resume?.projects) ? src.resume.projects : [],
        achievements: Array.isArray(src.resume?.achievements) ? src.resume.achievements : []
      }
    };
  }

  function yearsOfExperience(work) {
    const now = new Date();
    let months = 0;
    for (const w of work || []) {
      if (!w.start) continue;
      const [sy, sm] = w.start.split("-").map(Number);
      const [ey, em] = w.current || !w.end ? [now.getFullYear(), now.getMonth() + 1] : w.end.split("-").map(Number);
      months += Math.max(0, (ey - sy) * 12 + (em - sm));
    }
    return (Math.round(months / 12 * 10) / 10).toString();
  }

  root.AegisAutofillData = { emptyProfile, fromParsed, mergeParsed, normalize, toResumeProfile, isEmpty, yearsOfExperience, parseRange };
})(typeof window !== "undefined" ? window : globalThis);
