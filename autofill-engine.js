// autofill-engine.js - Field detection, filling and the completion panel.
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
    R("currentCompany", /current[\s_-]*(company|employer|organi[sz]ation)|present[\s_-]*employer/),
    R("currentTitle", /current[\s_-]*(title|role|position|designation)|job[\s_-]*title|designation/),
    R("school", /school|university|college|institution/),
    R("degree", /degree|qualification/),
    R("major", /\bmajor\b|field[\s_-]*of[\s_-]*study|discipline|specializ|\bstream\b/),
    R("gpa", /\bgpa\b|cgpa|grade[\s_-]*point/),
    R("currentCtc", /current[\s_-]*(ctc|salary|compensation)|present[\s_-]*salary/),
    R("salary", /expected|desired|salary|\bctc\b|compensation/),
    R("notice", /notice/),
    R("startDate", /available.*(start|join)|start[\s_-]*date|earliest|when can you (start|join)|date[\s_-]*of[\s_-]*joining/),
    R("yearsExp", /years?[\s_-]*of[\s_-]*(\w+[\s_-]*)?experience|total[\s_-]*experience|experience[\s_-]*in[\s_-]*years|\byoe\b/),
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

  // Keys that identify what a field is but have no answer unless set in the profile.
  function valuesFrom(profile, hasPassword) {
    const p = profile.personal, w = profile.work[0] || {}, e = profile.education[0] || {};
    const pref = profile.preferences, eeo = profile.eeo;
    return {
      firstName: p.firstName, middleName: p.middleName, lastName: p.lastName,
      prefFirst: p.prefFirst || p.firstName, prefLast: p.prefLast || p.lastName,
      fullName: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "),
      email: hasPassword && profile.signup.email ? profile.signup.email : p.email,
      phoneType: p.phoneType, countryCode: p.countryCode, phone: p.phone,
      address: p.address, city: p.city, state: p.state, country: p.country,
      county: p.county, postalCode: p.postalCode,
      linkedin: p.linkedin, github: p.github, portfolio: p.portfolio,
      currentCompany: w.company, currentTitle: w.title,
      school: e.school, degree: e.degree, major: e.major, gpa: e.gpa,
      salary: pref.salary, currentCtc: pref.currentCtc, notice: pref.noticePeriod,
      startDate: pref.startDate, source: pref.source,
      yearsExp: root.AegisAutofillData.yearsOfExperience(profile.work),
      authorized: eeo.authorized, sponsorship: eeo.sponsorship, veteran: eeo.veteran,
      disability: eeo.disability, lgbtq: eeo.lgbtq, gender: eeo.gender, race: eeo.race,
      password: profile.signup.password,
      coverLetter: profile.coverLetterText, notes: pref.notes
    };
  }

  // ---------- DOM helpers ----------
  const clean = s => String(s || "").replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const textOf = el => (el ? el.textContent || "" : "");

  function labelFor(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map(id => textOf(document.getElementById(id))).join(" ");
      if (clean(t)) return t;
    }
    if (el.labels && el.labels.length) return Array.from(el.labels).map(textOf).join(" ");
    const wrap = el.closest("label");
    if (wrap) return textOf(wrap);
    // Walk up a few levels looking for a label-like node that precedes the field.
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      const cand = node.querySelector("label, legend, [class*='label' i], [class*='question' i], h3, h4");
      if (cand && !cand.contains(el) && !cand.querySelector("input, select, textarea") &&
          (cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && clean(textOf(cand))) {
        return textOf(cand);
      }
    }
    return el.placeholder || el.name || "";
  }

  // Question text for a radio group without a <fieldset>: nearest preceding text block.
  function groupQuestion(radio) {
    let node = radio.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      const cand = Array.from(node.querySelectorAll("label, legend, p, h3, h4, [class*='label' i], [class*='question' i]"))
        .find(c => !c.querySelector("input") && !c.contains(radio) && clean(textOf(c)).length > 3 &&
          (c.compareDocumentPosition(radio) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (cand) return clean(textOf(cand));
    }
    return "";
  }

  function describe(el) {
    const label = clean(labelFor(el)).slice(0, 140);
    const attrs = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.autocomplete,
      el.getAttribute("data-automation-id"), el.getAttribute("data-qa")];
    const sig = [label, ...attrs].filter(Boolean).join(" ").toLowerCase();
    const required = el.required || el.getAttribute("aria-required") === "true" || /\*/.test(labelFor(el));
    return { label: label || el.name || el.id || "Field", sig, required };
  }

  function match(sig) {
    for (const r of RULES) if (r.re.test(sig) && !(r.not && r.not.test(sig))) return r.key;
    return null;
  }

  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // Turn a wanted value into ordered regex candidates for option text.
  function candidates(key, value) {
    const v = String(value).trim().toLowerCase();
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (v === "yes") return [/^yes\b/, /\byes\b/];
    if (v === "no") return [/^no\b/, /\bnot\b/, /\bnone\b/, /do not|don'?t/];
    const list = [new RegExp(`^${esc}$`), new RegExp(`^${esc}\\b`), new RegExp(`\\b${esc}\\b`)];
    if (key === "phoneType") list.push(/mobile|cell/);
    if (key === "countryCode") list.push(new RegExp(esc + "(?!\\d)"), new RegExp("\\b" + v.replace(/\D/g, "") + "\\b"));
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

  function fillRadio(group, key, value) {
    const options = group.map(r => ({ text: clean(labelFor(r)) || r.value, ref: r }));
    const hit = pickOption(options, key, value);
    if (!hit) return false;
    hit.ref.click();
    return true;
  }

  function attachFile(el, doc) {
    if (!doc || !doc.dataUrl) return false;
    const [meta, b64] = doc.dataUrl.split(",");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], doc.name || "document.pdf", { type: doc.type || "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ---------- Main run ----------
  async function run(profile, opts = {}) {
    const fields = Array.from(document.querySelectorAll("input, select, textarea"))
      .filter(el => !el.closest("#aegis-autofill-panel") && !el.disabled && !el.readOnly);
    const hasPassword = fields.some(el => el.type === "password" && visible(el));
    const values = valuesFrom(profile, hasPassword);
    const hasCountryCodeField = fields.some(el => match(describe(el).sig) === "countryCode");

    const items = [];           // {label, required, filled, el}
    const radioGroups = new Map();
    let aiBudget = 5;

    for (const el of fields) {
      const type = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "search", "checkbox"].includes(type)) continue;

      if (type === "file") {
        const d = describe(el);
        const kind = /cover/.test(d.sig) ? "coverLetter" : /resume|cv\b|curriculum/.test(d.sig) ? "resume" : null;
        if (!kind) continue;
        const done = attachFile(el, profile.documents[kind]);
        items.push({ label: kind === "resume" ? "Resume/CV" : "Cover letter", required: d.required, filled: done, el });
        continue;
      }
      if (!visible(el)) continue;

      if (type === "radio") {
        const key = (el.form ? "f" : "") + el.name;
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key).push(el);
        continue;
      }

      const d = describe(el);
      const key = type === "email" ? "email" : type === "tel" ? "phone" : type === "password" ? "password" : match(d.sig);
      let value = key ? values[key] : "";
      let filled = false;

      if (key === "phone" && value && (/\+/.test(el.placeholder || "") && !hasCountryCodeField)) {
        value = `${profile.personal.countryCode}${value}`;
      }

      if (key && value) {
        if (el.tagName === "SELECT") filled = fillSelect(el, key, value);
        else { setValue(el, value); filled = true; }
      } else if (el.tagName === "TEXTAREA" && !key && d.label.length > 8 && !el.value && opts.answer && aiBudget > 0) {
        aiBudget--;
        const answer = await opts.answer(d.label);
        if (answer) { setValue(el, answer); filled = true; }
      } else if (el.value && el.tagName !== "SELECT") {
        filled = true; // already answered by the user or the page
      }
      if (filled) el.classList.add("aegis-field-autofilled");
      if (key || d.required) items.push({ label: d.label, required: d.required, filled, el });
    }

    for (const group of radioGroups.values()) {
      const first = group[0];
      const legend = first.closest("fieldset")?.querySelector("legend");
      const question = clean(textOf(legend)) || groupQuestion(first);
      const sig = `${question} ${first.name}`.toLowerCase();
      const key = match(sig);
      const already = group.some(r => r.checked);
      const filled = key && values[key] ? fillRadio(group, key, values[key]) : already;
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
    const el = item.el;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus?.({ preventScroll: true });
    const prev = el.style.outline;
    el.style.outline = "2px solid #f59e0b";
    setTimeout(() => { el.style.outline = prev; }, 1800);
    return true;
  }

  root.AegisAutofill = { run, locate, match, RULES };
})(typeof window !== "undefined" ? window : globalThis);
