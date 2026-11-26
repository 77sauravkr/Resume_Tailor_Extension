// autofill-engine.js - Field detection, filling (native, custom ARIA/React-Select, checkboxes, multi-entry, shadow DOM) and completion tracking.
(function (root) {
  const R = (key, re, not) => ({ key, re, not });

  // Order matters: first match wins.
  const RULES = [
    R("password", /pass(word|wd)/),
    R("prefFirst", /preferred.*first|nick[\s_-]*name/),
    R("prefLast", /preferred.*last/),
    R("firstName", /first[\s_-]*name|given[\s_-]*name|\bfname\b|forename/),
    R("middleName", /middle[\s_-]*(name|initial)|\bmname\b/),
    R("lastName", /last[\s_-]*name|family[\s_-]*name|surname|\blname\b/),
    R("email", /e-?mail/),
    R("phoneType", /phone[\s_-]*(device[\s_-]*)?type/),
    R("countryCode", /country[\s_-]*(phone[\s_-]*)?code|phone[\s_-]*(country[\s_-]*)?code|dial[\s_-]*code/),
    R("phone", /phone|mobile|\btel\b|\bcell\b|contact[\s_-]*(no|number)/),
    R("linkedin", /linked[\s_-]*in/),
    R("github", /git[\s_-]*hub/),
    R("portfolio", /portfolio|website|personal[\s_-]*(site|url|web)|\bblog\b|other[\s_-]*(url|link)/),
    R("postalCode", /\bzip|postal|pin[\s_-]*code/),
    R("address", /address|street/),
    R("city", /\bcity\b|\btown\b|current[\s_-]*location|\blocation\b/),
    R("state", /\bstate\b|province|\bregion\b/),
    R("county", /\bcounty\b|\bdistrict\b/),
    R("country", /country|nationality/),
    R("currentlyWork", /currently[\s_-]*work|presently[\s_-]*work|i still work here|current[\s_-]*role\b.*check/),
    R("currentlyStudy", /currently[\s_-]*(study|enrolled|attend)|still[\s_-]*enrolled/),
    R("currentCompany", /current[\s_-]*(company|employer|organi[sz]ation)|present[\s_-]*employer|\bcompany[\s_-]*name\b|\bemployer\b|\bcompany\b/, /reference|emergency/),
    R("currentTitle", /current[\s_-]*(title|role|position|designation)|job[\s_-]*title|designation|\brole[\s_-]*title\b|\btitle\b/, /project|page|section|degree|mr|mrs|ms|salutation|courtesy|document|file/),
    R("jobType", /employment[\s_-]*type|job[\s_-]*type|work[\s_-]*type/),
    R("workDescription", /responsibilities|role[\s_-]*description|job[\s_-]*description|work[\s_-]*description|summary[\s_-]*of[\s_-]*duties/),
    R("school", /school|university|college|institution/),
    R("degree", /degree|qualification/),
    R("major", /\bmajor\b|field[\s_-]*of[\s_-]*study|discipline|specializ|\bstream\b/),
    R("gpa", /\bgpa\b|cgpa|grade[\s_-]*point/),
    R("startMonth", /start[\s_-]*month|from[\s_-]*month/),
    R("startYear", /start[\s_-]*year|from[\s_-]*year/),
    R("endMonth", /end[\s_-]*month|to[\s_-]*month|grad(?:uation)?[\s_-]*month/),
    R("endYear", /end[\s_-]*year|to[\s_-]*year|grad(?:uation)?[\s_-]*year/),
    R("startDate", /available.*(start|join)|earliest.*(start|join)|when can you (start|join)|date[\s_-]*of[\s_-]*joining/),
    R("entryStartDate", /start[\s_-]*date|\bfrom\b[\s_-]*date|date[\s_-]*from/),
    R("entryEndDate", /end[\s_-]*date|\bto\b[\s_-]*date|graduation[\s_-]*date|completion[\s_-]*date/),
    R("currentCtc", /current[\s_-]*(ctc|salary|compensation)|present[\s_-]*salary/),
    R("salary", /expected|desired|salary|\bctc\b|compensation/),
    R("notice", /notice/),
    R("yearsExp", /years?[\s_-]*of[\s_-]*(\w+[\s_-]*)?experience|total[\s_-]*experience|experience[\s_-]*in[\s_-]*years|\byoe\b/),
    R("skills", /\bskills?\b|technical[\s_-]*skills?|key[\s_-]*skills?|core[\s_-]*competenc|technologies|tech[\s_-]*stack/, /soft[\s_-]*skills?|language[\s_-]*skill/),
    R("authorized", /authori[sz]ed|legally|right[\s_-]*to[\s_-]*work|eligible[\s_-]*to[\s_-]*work/, /(require|need).*sponsor/),
    R("sponsorship", /sponsor|\bvisa\b/),
    R("veteran", /veteran/),
    R("disability", /disabilit/),
    R("lgbtq", /lgbt|sexual[\s_-]*orientation/),
    R("gender", /gender|\bsex\b/),
    R("race", /\brace\b|ethnic/),
    R("source", /how[\s_-]*did[\s_-]*you[\s_-]*(hear|find)|referral[\s_-]*source/),
    R("coverLetter", /cover[\s_-]*letter/),
    R("notes", /anything else|additional[\s_-]*(info|information|comments?)|\bcomments?\b/),
    R("fullName", /full[\s_-]*name|legal[\s_-]*name|your[\s_-]*name|candidate[\s_-]*name|^name\b/, /company|user|school|manager|reference|employer|file/)
  ];

  const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function valuesFrom(profile, hasPassword) {
    const p = profile.personal, w = profile.work[0] || {}, e = profile.education[0] || {};
    const pref = profile.preferences, eeo = profile.eeo;
    const flatSkills = profile.skills || (profile.resume?.skillGroups || []).map(g => g.items).filter(Boolean).join(", ");
    return {
      firstName: p.firstName, middleName: p.middleName, lastName: p.lastName,
      prefFirst: p.prefFirst || p.firstName, prefLast: p.prefLast || p.lastName,
      fullName: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "),
      email: hasPassword && profile.signup.email ? profile.signup.email : p.email,
      phoneType: p.phoneType, countryCode: p.countryCode, phone: p.phone,
      address: p.address, city: p.city, state: p.state, country: p.country,
      county: p.county, postalCode: p.postalCode,
      linkedin: p.linkedin, github: p.github, portfolio: p.portfolio,
      currentCompany: w.company, currentTitle: w.title, jobType: w.type, workDescription: w.description,
      currentlyWork: !!w.current, currentlyStudy: !!e.current,
      school: e.school, degree: e.degree, major: e.major, gpa: e.gpa,
      salary: pref.salary, currentCtc: pref.currentCtc, notice: pref.noticePeriod,
      startDate: pref.startDate, source: pref.source,
      skills: flatSkills,
      yearsExp: root.AegisAutofillData.yearsOfExperience(profile.work),
      authorized: eeo.authorized, sponsorship: eeo.sponsorship, veteran: eeo.veteran,
      disability: eeo.disability, lgbtq: eeo.lgbtq, gender: eeo.gender, race: eeo.race,
      password: profile.signup.password,
      coverLetter: profile.coverLetterText, notes: pref.notes
    };
  }

  // ---------- DOM & Shadow DOM helpers ----------
  const clean = s => String(s || "").replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  const textOf = el => (el ? el.textContent || "" : "");
  const parentOrHost = el => el?.parentElement || el?.getRootNode?.()?.host || null;

  function queryAllDeep(rootNode, selector, out = [], seen = new Set()) {
    if (!rootNode) return out;
    if (rootNode.querySelectorAll) {
      for (const el of rootNode.querySelectorAll(selector)) {
        if (!seen.has(el)) { seen.add(el); out.push(el); }
      }
    }
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) queryAllDeep(node.shadowRoot, selector, out, seen);
    }
    return out;
  }

  function controlBox(el) {
    if (el.tagName === "INPUT") {
      const wrap = el.closest(".select__control, [class*='react-select' i], [data-baseweb='select']");
      if (wrap) return wrap;
    }
    return el;
  }

  const visible = el => {
    const box = controlBox(el);
    const r = box.getBoundingClientRect();
    const st = getComputedStyle(box);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };

  function findById(el, id) {
    const rootNode = el.getRootNode?.();
    return (rootNode?.getElementById ? rootNode.getElementById(id) : null) || document.getElementById(id);
  }

  function labelFor(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map(id => textOf(findById(el, id))).join(" ");
      if (clean(t)) return t;
    }
    if (el.labels && el.labels.length) return Array.from(el.labels).map(textOf).join(" ");
    const wrap = el.closest("label");
    if (wrap) return textOf(wrap);
    let node = parentOrHost(el);
    for (let i = 0; i < 4 && node; i++, node = parentOrHost(node)) {
      const cand = node.querySelector("label, legend, [class*='label' i], [class*='question' i], h3, h4");
      if (cand && !cand.contains(el) && !cand.querySelector("input, select, textarea") &&
          (cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && clean(textOf(cand))) {
        return textOf(cand);
      }
    }
    return el.placeholder || el.name || "";
  }

  function groupQuestion(radio) {
    let node = parentOrHost(radio);
    for (let i = 0; i < 4 && node; i++, node = parentOrHost(node)) {
      const cand = Array.from(node.querySelectorAll("label, legend, p, h3, h4, [class*='label' i], [class*='question' i]"))
        .find(c => !c.querySelector("input") && !c.contains(radio) && clean(textOf(c)).length > 3 &&
          (c.compareDocumentPosition(radio) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (cand) return clean(textOf(cand));
    }
    return "";
  }

  function fieldWrapperAutomationId(el) {
    let cur = el;
    for (let i = 0; i < 3 && cur; i++, cur = parentOrHost(cur)) {
      const aid = cur.getAttribute?.("data-automation-id") || "";
      if (aid && cur !== el && (/formField-/i.test(aid) || cur.querySelectorAll("input, select, textarea").length <= 2)) {
        return aid;
      }
    }
    return "";
  }

  function describe(el) {
    const rawLabel = labelFor(el);
    const label = clean(rawLabel).slice(0, 140);
    const attrs = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.autocomplete,
      el.getAttribute("data-automation-id"), el.getAttribute("data-qa"), fieldWrapperAutomationId(el)];
    const sig = [label, ...attrs].filter(Boolean).join(" ").toLowerCase();
    const required = el.required || el.getAttribute("aria-required") === "true" || /\*/.test(rawLabel);
    return { label: label || el.name || el.id || "Field", sig, required };
  }

  function match(sig) {
    for (const r of RULES) if (r.re.test(sig) && !(r.not && r.not.test(sig))) return r.key;
    return null;
  }

  // ---------- Multiple Work / Education Entry Indexing ----------
  function buildEntryIndexMap(fields) {
    const workNums = new Set(), eduNums = new Set();
    const rawCtx = new Map();
    const getExplicit = el => {
      const parts = [el.name, el.id, el.getAttribute("data-automation-id")];
      let p = parentOrHost(el);
      for (let i = 0; i < 4 && p; i++, p = parentOrHost(p)) {
        const aid = p.getAttribute?.("data-automation-id");
        if (aid) parts.push(aid);
      }
      const joined = parts.filter(Boolean).join(" ");
      if (!/years?[\s_-]*of[\s_-]*experience/i.test(joined)) {
        const wm = joined.match(/(?:work(?:experience)?|experience|exp|jobs?|employment)[_\-.\[]*(\d+)/i);
        if (wm && Number(wm[1]) <= 20) return { kind: "work", rawIdx: Number(wm[1]) };
        const em = joined.match(/(?:education|edu|schools?|academics?)[_\-.\[]*(\d+)/i);
        if (em && Number(em[1]) <= 20) return { kind: "edu", rawIdx: Number(em[1]) };
      }
      return null;
    };
    for (const el of fields) {
      const c = getExplicit(el);
      if (c) {
        rawCtx.set(el, c);
        (c.kind === "work" ? workNums : eduNums).add(c.rawIdx);
      }
    }
    const workSorted = [...workNums].sort((a, b) => a - b);
    const eduSorted = [...eduNums].sort((a, b) => a - b);

    // Fallback: repeating DOM card/fieldset containers when attributes aren't numbered
    const controlSel = "input, select, textarea, [role='combobox'], button[aria-haspopup='listbox']";
    const repeatBlockIndex = (el, kind) => {
      const kw = kind === "work" ? /company|employer|title|role/i : /school|university|college|degree|major/i;
      let cur = parentOrHost(el);
      for (let depth = 0; depth < 5 && cur && cur !== document.body; depth++, cur = parentOrHost(cur)) {
        const parent = parentOrHost(cur);
        if (!parent) break;
        const sibs = Array.from(parent.children || []).filter(s =>
          s.tagName === cur.tagName &&
          kw.test(s.textContent || "") &&
          queryAllDeep(s, controlSel).length >= 2
        );
        if (sibs.length >= 2) {
          const idx = sibs.indexOf(cur);
          if (idx >= 0) return idx;
        }
      }
      return 0;
    };

    return (el, sig) => {
      const exp = rawCtx.get(el);
      if (exp) {
        const sorted = exp.kind === "work" ? workSorted : eduSorted;
        const idx = sorted.indexOf(exp.rawIdx);
        return { kind: exp.kind, index: idx >= 0 ? idx : 0 };
      }
      if (/school|university|college|degree|major|gpa|currently[\s_-]*study|grad/i.test(sig)) return { kind: "edu", index: repeatBlockIndex(el, "edu") };
      if (/currently[\s_-]*work|job[\s_-]*type|responsibilities/i.test(sig)) return { kind: "work", index: repeatBlockIndex(el, "work") };
      let p = parentOrHost(el);
      for (let i = 0; i < 5 && p; i++, p = parentOrHost(p)) {
        const aid = `${p.getAttribute?.("data-automation-id") || ""} ${typeof p.className === "string" ? p.className : ""}`;
        if (/(?:work[-_ ]?(?:experience|history)|employment[-_ ]?history|experience[-_ ]?(?:section|list|item|card)|workExperience)/i.test(aid) && !/education/i.test(aid)) {
          return { kind: "work", index: repeatBlockIndex(el, "work") };
        }
        if (/(?:education[-_ ]?(?:section|list|item|card)|academic[-_ ]?(?:history|background)|educationSection)/i.test(aid)) {
          return { kind: "edu", index: repeatBlockIndex(el, "edu") };
        }
      }
      if (/company|employer/i.test(sig)) return { kind: "work", index: repeatBlockIndex(el, "work") };
      return { kind: "general", index: 0 };
    };
  }

  const WORK_ENTRY_KEYS = new Set(["currentCompany", "currentTitle", "jobType", "workDescription", "currentlyWork", "entryStartDate", "entryEndDate", "startMonth", "startYear", "endMonth", "endYear"]);
  const EDU_ENTRY_KEYS = new Set(["school", "degree", "major", "gpa", "currentlyStudy", "entryStartDate", "entryEndDate", "startMonth", "startYear", "endMonth", "endYear"]);

  function formatDateValue(ym, el, part) {
    if (!ym) return "";
    const [year, monStr] = ym.split("-");
    const monNum = parseInt(monStr || "1", 10);
    if (part === "year") return year || "";
    if (part === "month") {
      if (el.tagName === "INPUT") {
        if (el.type === "number" || el.maxLength === 2) return String(monNum);
        return MONTHS_FULL[monNum - 1] || monStr;
      }
      return `${monNum}|${MONTHS_FULL[monNum - 1] || ""}`;
    }
    if (el.type === "month") return ym;
    if (el.type === "date") return `${ym}-01`;
    const ph = el.placeholder || "";
    if (/yyyy[-\/]mm/i.test(ph)) return ym;
    if (/mm[-\/]dd[-\/]yyyy/i.test(ph)) return `${monStr}/01/${year}`;
    if (/dd[-\/]mm[-\/]yyyy/i.test(ph)) return `01/${monStr}/${year}`;
    return `${monStr}/${year}`;
  }

  function resolveFieldValue(key, el, ctx, profile, baseValues) {
    if (!key) return "";
    if (ctx.kind === "work") {
      const isLoc = key === "city" && /\blocation\b/i.test(describe(el).sig);
      const isStart = key === "startDate" && !/available|earliest|join/i.test(describe(el).sig);
      if (WORK_ENTRY_KEYS.has(key) || isLoc || isStart) {
        const w = profile.work[ctx.index];
        if (!w) return "";
        if (key === "currentCompany") return w.company || "";
        if (key === "currentTitle") return w.title || "";
        if (key === "jobType") return w.type || "";
        if (isLoc) return w.location || profile.personal.city || "";
        if (key === "workDescription") return w.description || "";
        if (key === "currentlyWork") return !!w.current;
        if (key === "entryStartDate" || isStart) return formatDateValue(w.start, el, "full");
        if (key === "startMonth") return formatDateValue(w.start, el, "month");
        if (key === "startYear") return formatDateValue(w.start, el, "year");
        if (key === "entryEndDate") return w.current ? "" : formatDateValue(w.end, el, "full");
        if (key === "endMonth") return w.current ? "" : formatDateValue(w.end, el, "month");
        if (key === "endYear") return w.current ? "" : formatDateValue(w.end, el, "year");
      }
    }
    if (ctx.kind === "edu") {
      const isLoc = key === "city" && /\blocation\b/i.test(describe(el).sig);
      const isStart = key === "startDate" && !/available|earliest|join/i.test(describe(el).sig);
      if (EDU_ENTRY_KEYS.has(key) || isLoc || isStart) {
        const e = profile.education[ctx.index];
        if (!e) return "";
        if (key === "school") return e.school || "";
        if (key === "degree") return e.degree || "";
        if (key === "major") return e.major || "";
        if (key === "gpa") return e.gpa || "";
        if (isLoc) return e.location || profile.personal.city || "";
        if (key === "currentlyStudy") return !!e.current;
        if (key === "entryStartDate" || isStart) return formatDateValue(e.start, el, "full");
        if (key === "startMonth") return formatDateValue(e.start, el, "month");
        if (key === "startYear") return formatDateValue(e.start, el, "year");
        if (key === "entryEndDate") return e.current ? "" : formatDateValue(e.end, el, "full");
        if (key === "endMonth") return e.current ? "" : formatDateValue(e.end, el, "month");
        if (key === "endYear") return e.current ? "" : formatDateValue(e.end, el, "year");
      }
    }
    if (key === "entryStartDate") return formatDateValue(profile.work[0]?.start || profile.education[0]?.start, el, "full");
    if (key === "entryEndDate") return formatDateValue(profile.work[0]?.end || profile.education[0]?.end, el, "full");
    if (key === "startMonth") return formatDateValue(profile.work[0]?.start || profile.education[0]?.start, el, "month");
    if (key === "startYear") return formatDateValue(profile.work[0]?.start || profile.education[0]?.start, el, "year");
    if (key === "endMonth") return formatDateValue(profile.work[0]?.end || profile.education[0]?.end, el, "month");
    if (key === "endYear") return formatDateValue(profile.work[0]?.end || profile.education[0]?.end, el, "year");
    return baseValues[key];
  }

  // ---------- Control writers ----------
  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function candidates(key, value) {
    const raw = String(value).trim();
    if ((key === "startMonth" || key === "endMonth") && raw.includes("|")) {
      const [numStr, full] = raw.split("|");
      const n = parseInt(numStr, 10);
      const pad = String(n).padStart(2, "0");
      const abbr = MONTHS_SHORT[n - 1] || full.slice(0, 3);
      return [new RegExp(`^${full}$`, "i"), new RegExp(`^${abbr}\\b`, "i"), new RegExp(`^0?${n}$`), new RegExp(`^${pad}\\b`)];
    }
    const v = raw.toLowerCase();
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (v === "yes") return [/^yes\b/, /\byes\b/];
    if (v === "no") return [/^no\b/, /\bnot\b/, /\bnone\b/, /do not|don'?t/];
    const list = [new RegExp(`^${esc}$`), new RegExp(`^${esc}\\b`), new RegExp(`\\b${esc}\\b`)];
    if (key === "phoneType") list.push(/mobile|cell/);
    if (key === "countryCode") list.push(new RegExp(esc + "(?!\\d)"), new RegExp("\\b" + v.replace(/\D/g, "") + "\\b"));
    if (key === "degree") {
      if (/bachelor/i.test(v)) list.push(/\bbachelor|\bb\.?\s?(tech|e|s|sc|a)\b/);
      if (/master/i.test(v)) list.push(/\bmaster|\bm\.?\s?(tech|e|s|sc|a)\b/);
    }
    return list;
  }

  const isPlaceholder = t => !t || /^(select|choose|please|--)/i.test(t);

  function pickOption(options, key, value) {
    const opts = options.filter(o => !isPlaceholder(o.text.trim()));
    for (const re of candidates(key, value)) {
      const hit = opts.find(o => re.test(o.text.trim().toLowerCase()));
      if (hit) return hit;
    }
    return null;
  }

  function fillSelect(el, key, value) {
    const hit = pickOption(Array.from(el.options).map(o => ({ text: o.text, ref: o })), key, value);
    if (!hit) return false;
    el.value = hit.ref.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function isCustomDropdown(el) {
    if (!el || el.tagName === "SELECT") return false;
    if (el.getAttribute("role") === "combobox") return true;
    if (el.getAttribute("aria-haspopup") === "listbox") return true;
    if (el.tagName === "BUTTON" && el.hasAttribute("aria-expanded") && !/submit|save|cancel|next|back|upload|attach|remove|delete|add/i.test(clean(el.textContent))) {
      return !!el.closest("[data-automation-id], [class*='select' i], [class*='dropdown' i], [class*='field' i]");
    }
    return !!el.closest(".select__control, [class*='react-select' i], [data-baseweb='select'], [class*='MuiSelect']");
  }

  function clickLikeUser(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click?.();
  }

  function findOpenOptions(el) {
    const ctrlId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    if (ctrlId) {
      for (const id of ctrlId.split(/\s+/)) {
        const listEl = findById(el, id);
        if (listEl) {
          const opts = queryAllDeep(listEl, "[role='option'], li, [data-automation-id='promptOption']").filter(visible);
          if (opts.length) return opts;
        }
      }
    }
    return queryAllDeep(
      document,
      "[role='listbox'] [role='option'], [role='option'], [data-automation-id='promptOption'], [class*='select__option'], [class*='menu'] li"
    ).filter(visible);
  }

  async function fillCustomDropdown(el, key, value) {
    const trigger = controlBox(el);
    trigger.focus?.({ preventScroll: true });
    clickLikeUser(trigger);
    if (trigger !== el) el.focus?.({ preventScroll: true });

    let options = [];
    for (let i = 0; i < 5; i++) {
      await sleep(60);
      options = findOpenOptions(el);
      if (options.length) break;
    }

    if (!options.length && el.tagName === "INPUT" && !el.readOnly) {
      setValue(el, String(value).split(",")[0].trim().slice(0, 18));
      for (let i = 0; i < 5; i++) {
        await sleep(70);
        options = findOpenOptions(el);
        if (options.length) break;
      }
    }

    const hit = options.length
      ? pickOption(options.map(o => ({ text: clean(o.textContent), ref: o })), key, value)
      : null;

    if (hit) {
      hit.ref.scrollIntoView?.({ block: "nearest" });
      clickLikeUser(hit.ref);
      await sleep(40);
      return true;
    }

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    el.blur?.();
    return false;
  }

  function fillRadio(group, key, value) {
    const options = group.map(r => ({ text: clean(labelFor(r)) || r.value, ref: r }));
    const hit = pickOption(options, key, value);
    if (!hit) return false;
    hit.ref.click();
    return true;
  }

  function fillCheckbox(el, key, value) {
    if (typeof value === "boolean") {
      if (el.checked !== value) el.click();
      return true;
    }
    const v = String(value || "").trim().toLowerCase();
    if (v === "yes" || v === "true") {
      if (!el.checked) el.click();
      return true;
    }
    if (v === "no" || v === "false") {
      if (el.checked) el.click();
      return true;
    }
    const lbl = clean(labelFor(el)).toLowerCase();
    if (v && lbl && lbl.includes(v)) {
      if (!el.checked) el.click();
      return true;
    }
    return el.checked;
  }

  async function attachFile(el, docMeta, kind, opts) {
    let doc = docMeta;
    if ((!doc || !doc.dataUrl) && doc?.name && typeof opts.getDocument === "function") {
      doc = await opts.getDocument(kind);
    }
    if (!doc || !doc.dataUrl) return false;
    const [, b64] = doc.dataUrl.split(",");
    if (!b64) return false;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], doc.name || "document.pdf", { type: doc.type || "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function skillMentioned(skillsStr, term) {
    if (!skillsStr || !term) return false;
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9_+#])${esc}(?![a-z0-9_+#])`, "i").test(skillsStr);
  }

  function isSpecificYearsQuestion(sig, key) {
    if (key !== "yearsExp") return false;
    const m = sig.match(/years?[\s_-]*of[\s_-]*([a-z0-9+#.]+)[\s_-]*experience/);
    if (!m) return false;
    const word = m[1].toLowerCase();
    return !/^(total|overall|work|relevant|professional|industry|software|practical|prior|full|hands)$/.test(word);
  }

  function canAskAiForField(el, type, d, key, opts) {
    if (!opts.answer || el.value) return false;
    if (isSpecificYearsQuestion(d.sig, key)) return true;
    if (key) return false;
    const isTextarea = el.tagName === "TEXTAREA";
    const isShortInput = el.tagName === "INPUT" && ["", "text", "number"].includes(type);
    if (!isTextarea && !isShortInput) return false;
    if (el.getAttribute("role") === "searchbox" || /search|filter|captcha|otp|coupon|promo|signature|verify/i.test(d.sig)) return false;
    if (d.label.length <= 8) return false;
    if (isTextarea) return true;
    const words = d.label.trim().split(/\s+/).length;
    return /\?/.test(d.label) || words >= 3 || /\b(years|notice|salary|ctc|relocat|willing|eligible|available|experience)\b/i.test(d.label);
  }

  // ---------- Main run ----------
  async function run(profile, opts = {}) {
    const rawFields = queryAllDeep(document, "input, select, textarea, [role='combobox'], button[aria-haspopup='listbox']")
      .filter(el => {
        if (el.closest("#aegis-autofill-panel") || el.disabled) return false;
        if (el.readOnly && !isCustomDropdown(el)) return false;
        return true;
      });

    // Deduplicate wrapper comboboxes that contain an interactive child already in rawFields
    const fieldSet = new Set(rawFields);
    const fields = rawFields.filter(el => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return true;
      return !Array.from(el.querySelectorAll("input, button")).some(c => fieldSet.has(c));
    });

    const hasPassword = fields.some(el => el.type === "password" && visible(el));
    const baseValues = valuesFrom(profile, hasPassword);
    const hasCountryCodeField = fields.some(el => match(describe(el).sig) === "countryCode");
    const getCtx = buildEntryIndexMap(fields);

    const items = [];
    const radioGroups = new Map();
    let aiBudget = 5;

    for (const el of fields) {
      const type = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "search"].includes(type) && !isCustomDropdown(el)) continue;

      if (type === "file") {
        const d = describe(el);
        const kind = /cover/.test(d.sig) ? "coverLetter" : /resume|cv\b|curriculum/.test(d.sig) ? "resume" : null;
        if (!kind) continue;
        const done = await attachFile(el, profile.documents[kind], kind, opts);
        items.push({ label: kind === "resume" ? "Resume/CV" : "Cover letter", required: d.required, filled: done, el });
        continue;
      }
      if (!visible(el)) continue;

      if (type === "radio") {
        const key = (el.form ? "f" : "") + (el.name || labelFor(el));
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key).push(el);
        continue;
      }

      const d = describe(el);
      const ctx = getCtx(el, d.sig);
      const key = type === "email" ? "email" : type === "tel" ? "phone" : type === "password" ? "password" : match(d.sig);

      if (type === "checkbox") {
        const val = resolveFieldValue(key, el, ctx, profile, baseValues);
        let filled = el.checked;
        if (key && val !== undefined && val !== "") filled = fillCheckbox(el, key, val);
        if (filled) el.classList.add("aegis-field-autofilled");
        if (key || d.required) items.push({ label: d.label, required: d.required, filled: !!filled, el });
        continue;
      }

      let value = resolveFieldValue(key, el, ctx, profile, baseValues);
      let filled = false;

      if (key === "phone" && value && (/\+/.test(el.placeholder || "") && !hasCountryCodeField)) {
        value = `${profile.personal.countryCode}${value}`;
      }

      const specificYears = isSpecificYearsQuestion(d.sig, key);
      if (key && value && !specificYears) {
        if (el.tagName === "SELECT") filled = fillSelect(el, key, value);
        else if (isCustomDropdown(el)) filled = await fillCustomDropdown(el, key, value);
        else { setValue(el, value); filled = true; }
      } else if (canAskAiForField(el, type, d, key, opts) && aiBudget > 0) {
        aiBudget--;
        const inputType = type === "number" ? "number" : el.tagName === "TEXTAREA" ? "textarea" : "text";
        const answer = await opts.answer(d.label, { inputType, maxLength: el.maxLength > 0 ? el.maxLength : 0 });
        if (answer) {
          setValue(el, answer);
          filled = true;
        } else if (specificYears && value && skillMentioned(baseValues.skills, d.sig.match(/years?[\s_-]*of[\s_-]*([a-z0-9+#.]+)/i)?.[1])) {
          setValue(el, value);
          filled = true;
        }
      } else if (el.value && el.tagName !== "SELECT" && !isPlaceholder(el.value)) {
        filled = true;
      }

      if (filled) controlBox(el).classList.add("aegis-field-autofilled");
      if (key || d.required) items.push({ label: d.label, required: d.required, filled, el });
    }

    for (const group of radioGroups.values()) {
      const first = group[0];
      const legend = first.closest("fieldset")?.querySelector("legend");
      const question = clean(textOf(legend)) || groupQuestion(first);
      const sig = `${question} ${first.name}`.toLowerCase();
      const key = match(sig);
      const already = group.some(r => r.checked);
      const filled = key && baseValues[key] ? fillRadio(group, key, baseValues[key]) : already;
      items.push({
        label: question || first.name, required: group.some(r => r.required), filled: !!filled, el: first
      });
    }

    lastItems = items;
    const result = summarize(items);
    result.items = items.map((i, id) => ({ id, label: i.label, required: i.required, filled: i.filled }));
    return result;
  }

  function summarize(items) {
    const req = items.filter(i => i.required);
    const filled = items.filter(i => i.filled).length;
    const reqDone = req.filter(i => i.filled).length;
    return { filled, total: items.length, required: req.length, requiredFilled: reqDone,
      percent: req.length ? Math.round(100 * reqDone / req.length) : 100 };
  }

  // ---------- Result handling ----------
  let lastItems = [];

  function locate(id) {
    const item = lastItems[id];
    if (!item) return false;
    const el = controlBox(item.el);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    item.el.focus?.({ preventScroll: true });
    const prev = el.style.outline;
    el.style.outline = "2px solid #f59e0b";
    setTimeout(() => { el.style.outline = prev; }, 1800);
    return true;
  }

  root.AegisAutofill = { run, locate, match, RULES };
})(typeof window !== "undefined" ? window : globalThis);
