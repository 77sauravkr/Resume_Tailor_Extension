// content.js - Job detail extraction and autofill runner (runs in top frame and embedded iframes)

(function () {
  if (window.__aegisJobTailorLoaded) return;   // injected twice (manifest + panel fallback)
  window.__aegisJobTailorLoaded = true;

  let cachedJobData = null;

  function firstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = el?.innerText?.trim();
      if (t) return t;
    }
    return "";
  }

  function firstLongText(selectors, minLen = 80) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = el?.innerText?.trim();
      if (t && t.length >= minLen) return t;
    }
    return "";
  }

  function readJsonLdJob() {
    for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const raw = JSON.parse(sc.textContent || "");
        const list = Array.isArray(raw) ? raw : (raw["@graph"] || [raw]);
        const jp = list.find(x => x && (x["@type"] === "JobPosting" || (Array.isArray(x["@type"]) && x["@type"].includes("JobPosting"))));
        if (jp) {
          const tmp = document.createElement("div");
          tmp.innerHTML = String(jp.description || "");
          return {
            role: String(jp.title || "").trim(),
            company: String(jp.hiringOrganization?.name || "").trim(),
            text: (tmp.innerText || tmp.textContent || "").trim()
          };
        }
      } catch (e) {}
    }
    return null;
  }

  // 1. Intelligent Job Details Scraper (LinkedIn, Greenhouse, Lever, Ashby, Workday, Amazon, Indeed, Wellfound, Glassdoor, Internshala, Instahyre, SmartRecruiters, Workable)
  function extractJobDetails(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedJobData &&
        cachedJobData.url === window.location.href &&
        cachedJobData.title === document.title &&
        (now - cachedJobData.at) < 4000 &&
        cachedJobData.jobText.length > 150) {
      return cachedJobData;
    }

    let company = "";
    let role = "";
    let text = "";

    const url = window.location.href.toLowerCase();
    const host = window.location.hostname.toLowerCase();

    // 1. LINKEDIN
    if (host.includes("linkedin.com")) {
      if (document.title) {
        const docTitle = document.title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
        const hiringMatch = docTitle.match(/^(.*?)\s+hiring\s+(.*?)\s+in\s+/i);
        if (hiringMatch) {
          company = hiringMatch[1].replace(/^[^\w]+/, "").trim();
          role = hiringMatch[2].trim();
        } else {
          const atMatch = docTitle.match(/^(.*?)\s+(?:at|@)\s+(.*?)$/i);
          if (atMatch) {
            role = atMatch[1].trim();
            company = atMatch[2].trim();
          }
        }
      }

      if (!role || role.toLowerCase() === "software engineer" || role.length < 3) {
        const roleSelectors = [
          ".job-details-jobs-unified-top-card__job-title",
          ".jobs-unified-top-card__job-title",
          "h1.top-card-layout__title",
          "h1.topcard__title",
          ".topcard__title",
          "h1.t-24",
          ".jobs-top-card__job-title",
          "h1[class*='job-title']",
          "h1"
        ];
        for (const sel of roleSelectors) {
          const t = firstText([sel]);
          const lower = t.toLowerCase();
          if (t.length > 1 && !lower.includes("search") && !lower.includes("linkedin") && !["jobs", "feed", "home"].includes(lower)) {
            role = t;
            break;
          }
        }
      }

      if (!company || company.toLowerCase() === "linkedin" || company.length < 2) {
        const companySelectors = [
          ".job-details-jobs-unified-top-card__company-name a",
          ".job-details-jobs-unified-top-card__company-name",
          ".jobs-unified-top-card__company-name a",
          ".jobs-unified-top-card__company-name",
          "a.topcard__org-name-link",
          ".topcard__flavor--black-link",
          ".top-card-layout__first-subline a",
          ".jobs-unified-top-card__subtitle-primary-grouping a",
          "a[data-tracking-control-name*='org_name']",
          "a[data-tracking-control-name*='company_name']",
          "a[href*='/company/']",
          ".topcard__flavor"
        ];
        for (const sel of companySelectors) {
          const t = firstText([sel]);
          const lower = t.toLowerCase();
          if (t.length > 1 && !lower.includes("see all") && !lower.includes("apply") && lower !== "linkedin" && !lower.includes("followers") && !lower.includes("connections")) {
            company = t;
            break;
          }
        }
      }

      text = firstLongText([
        "#job-details",
        ".jobs-description__content",
        ".jobs-description-content__text",
        ".jobs-description",
        ".description__text",
        ".show-more-less-html__markup",
        ".jobs-box__html-content",
        "article.jobs-description",
        "article[class*='job']",
        "[data-job-description]",
        "article",
        "main"
      ]);
    }
    // 2. GREENHOUSE
    else if (host.includes("greenhouse.io")) {
      company = firstText([".company-name", "#header .company-name", "[class*='company']"]);
      role = firstText([".app-title", "h1.app-title", "h1"]);
      text = firstLongText(["#content", ".content", "main"]);
    }
    // 3. LEVER
    else if (host.includes("lever.co")) {
      company = firstText([".posting-header .main-header", ".posting-header a", ".main-header"]).split("–")[0]?.trim() || "";
      role = firstText([".posting-headline h2", "h2.posting-headline", "h2", "h1"]);
      text = firstLongText([".section-page", ".content", "main"]);
    }
    // 4. NAUKRI
    else if (host.includes("naukri.com")) {
      role = firstText([".jd-header-title", "h1.jd-header-title", "h1"]);
      company = firstText([".jd-header-comp-name", ".comp-name", "a.comp-name"]);
      text = firstLongText([".jd-description", ".job-desc", "section.job-desc-container"]);
    }
    // 5. ASHBY
    else if (host.includes("ashbyhq.com")) {
      role = firstText(["h1", "[class*='jobTitle']"]);
      company = firstText(["h2", ".company-name", "[class*='companyName']"]);
      text = firstLongText([".job-description", "main", "article"]);
    }
    // 6. WORKDAY
    else if (host.includes("myworkdayjobs.com")) {
      const headings = Array.from(document.querySelectorAll("[data-automation-id='jobPostingHeader'], h2[data-automation-id='jobTitle'], [data-automation-id='jobTitle'], h2, h1"));
      for (const h of headings) {
        const txt = h.innerText?.trim() || "";
        if (txt.length > 3 && !/jobs|careers|welcome|sign in|home/i.test(txt)) {
          role = txt;
          break;
        }
      }
      if (!role) {
        const jobSlug = window.location.pathname.match(/\/job\/(?:[^/]+\/)?([^/?]+)/i);
        if (jobSlug && jobSlug[1]) {
          role = jobSlug[1].replace(/[-_][A-Z0-9]{5,}$/i, "").replace(/[-_]/g, " ").trim();
        }
      }

      let detectedComp = firstText(["[data-automation-id='companyName']", "[data-automation-id='subtitle']"]);
      if (!detectedComp || /myworkday/i.test(detectedComp)) {
        const pathMatch = window.location.pathname.match(/\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job/i);
        if (pathMatch && pathMatch[1] && !/myworkday|wd\d+|job|careers|en-US/i.test(pathMatch[1])) {
          detectedComp = pathMatch[1].replace(/_/g, " ").trim();
        } else {
          const subDomain = window.location.hostname.split(".")[0];
          if (subDomain && !/myworkday|wd\d+/i.test(subDomain)) {
            detectedComp = subDomain.charAt(0).toUpperCase() + subDomain.slice(1);
          }
        }
      }
      company = detectedComp;
      text = firstLongText(["[data-automation-id='jobPostingDescription']", ".job-description", "main"]);
    }
    // 7. AMAZON JOBS
    else if (host.includes("amazon.jobs")) {
      company = "Amazon";
      role = firstText(["h1.title", "h1[class*='title']", "h1"]);
      text = firstLongText(["#job-detail-body", ".description", "[class*='description']", "main"]);
    }
    // 8. INDEED
    else if (/(^|\.)indeed\./i.test(host)) {
      role = firstText(["[data-testid='jobsearch-JobInfoHeader-title']", ".jobsearch-JobInfoHeader-title", "h1[class*='JobInfoHeader']", "h2.jobTitle", "h1"]);
      company = firstText(["[data-testid='inlineHeader-companyName'] a", "[data-testid='inlineHeader-companyName']", "[data-company-name]", ".jobsearch-InlineCompanyRating-companyHeader a", ".jobsearch-CompanyInfoContainer a"]);
      text = firstLongText(["#jobDescriptionText", "[data-testid='jobsearch-JobComponent-description']", ".jobsearch-jobDescriptionText", "#viewJobSSRRoot main"]);
    }
    // 9. WELLFOUND (AngelList)
    else if (host.includes("wellfound.com") || host.includes("angel.co")) {
      role = firstText(["[data-test='JobDetailTitle']", "h1[class*='title']", "h1"]);
      company = firstText(["[data-test='StartupResult-name']", "a[href*='/company/'] h2", "a[href*='/company/']", "[class*='styles_company']"]);
      text = firstLongText(["[data-test='JobDescription']", "[class*='styles_description']", "#job-description", "main"]);
    }
    // 10. GLASSDOOR
    else if (/(^|\.)glassdoor\./i.test(host)) {
      role = firstText(["[data-test='job-title']", "[class*='JobDetails_jobTitle']", "h1"]);
      company = firstText(["[data-test='employer-name']", "[class*='EmployerProfile_employerName']", "[class*='JobDetails_companyName']"]).split("\n")[0]?.trim() || "";
      text = firstLongText(["[class*='JobDetails_jobDescription']", ".jobDescriptionContent", "#JobDescriptionContainer", "[data-test='description']"]);
    }
    // 11. INTERNSHALA
    else if (host.includes("internshala.com")) {
      role = firstText([".profile_on_detail_page", ".heading_4_5.profile", ".individual_internship_header .profile", "h1"]);
      company = firstText([".company_name a", ".company_name", ".link_display_like_text"]);
      text = firstLongText([".internship_details", ".detail_view", "#internship_detail_container"]);
    }
    // 12. INSTAHYRE
    else if (host.includes("instahyre.com")) {
      role = firstText([".job-title", "#employer-profile h1", ".profile-info h1", "h1"]);
      company = firstText([".company-name", "#employer-profile h2", ".company-title"]);
      text = firstLongText([".job-description", "#job-description", ".opportunity-description", "main"]);
    }
    // 13. SMARTRECRUITERS
    else if (host.includes("smartrecruiters.com")) {
      role = firstText(["h1.job-title", "[data-test='job-title']", "h1"]);
      company = firstText(["[data-test='company-name']", ".company-name"]) || document.querySelector(".header-logo img")?.alt?.trim() || "";
      if (!company) {
        const seg = window.location.pathname.split("/").filter(Boolean)[0];
        if (seg && !/jobs|careers/i.test(seg)) company = seg;
      }
      text = firstLongText(["[data-test='job-description']", ".job-sections", "[itemprop='description']", "main"]);
    }
    // 14. WORKABLE
    else if (host.includes("workable.com")) {
      role = firstText(["[data-ui='job-title']", "h1[data-ui]", "h1"]);
      company = firstText(["[data-ui='company-name']"]) || document.querySelector('meta[property="og:site_name"]')?.content?.trim() || "";
      text = firstLongText(["section[data-ui='job-description']", "[data-ui='job-description']", "[class*='description']", "main"]);
    }

    // 15. JSON-LD JobPosting + Generic Heuristic Fallbacks
    if (!role || !company || !text || text.length < 80) {
      const ld = readJsonLdJob();
      if (ld) {
        if (!role && ld.role) role = ld.role;
        if (!company && ld.company) company = ld.company;
        if ((!text || text.length < 80) && ld.text.length >= 80) text = ld.text;
      }
    }
    if (!role) {
      const h1 = document.querySelector("h1");
      if (h1 && h1.innerText.trim().length > 2 && h1.innerText.trim().length < 120) {
        role = h1.innerText.trim();
      }
    }
    if (!company) {
      const ogSite = document.querySelector('meta[property="og:site_name"]')?.content;
      if (ogSite && ogSite.trim().length > 1) {
        company = ogSite.trim();
      } else {
        const parts = window.location.hostname.replace(/^www\./, "").split(".");
        let cleanHost = parts.length > 2 ? parts[parts.length - 2] : parts[0];
        if (cleanHost.toLowerCase() === "myworkdayjobs" && parts.length > 3) {
          cleanHost = parts[0];
        }
        company = cleanHost.charAt(0).toUpperCase() + cleanHost.slice(1);
      }
    }
    if (!text || text.length < 80) {
      const mainEl = document.querySelector("main, article, #job-description, .job-description, [role='main']") || document.body;
      const clone = mainEl.cloneNode(true);
      clone.querySelectorAll("nav, header, footer, script, style, noscript, svg, button").forEach(el => el.remove());
      text = clone.innerText || "";
    }

    const cleanedText = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
    cachedJobData = {
      company: company || "Target Employer",
      role: role || "Software Engineer",
      jobText: cleanedText,
      url: window.location.href,
      title: document.title,
      at: now
    };

    return cachedJobData;
  }

  // 2. Autofill: profile comes from the editor page (editor.html); documents load from background IndexedDB
  async function autofillApplicationForm(jobContextOverride = "") {
    const store = await chrome.storage.local.get(["autofillProfile"]);
    const profile = AegisAutofillData.normalize(store.autofillProfile);
    const jobContext = jobContextOverride || (window === window.top ? extractJobDetails().jobText : "");
    return AegisAutofill.run(profile, {
      answer: (question, meta = {}) => chrome.runtime.sendMessage({
        action: "ANSWER_QUESTION",
        question,
        jobContext,
        inputType: meta.inputType || "textarea",
        maxLength: meta.maxLength || 0
      }).then(r => (r?.success ? r.answer : "")).catch(() => ""),
      getDocument: kind => chrome.runtime.sendMessage({
        action: "GET_DOCUMENT_DATA", kind
      }).then(r => (r?.success ? r.doc : null)).catch(() => null)
    });
  }

  window.__aegisRunAutofill = autofillApplicationForm;
  window.__aegisLocateField = id => AegisAutofill.locate(id);

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === "GET_JOB_DETAILS") {
      if (window !== window.top) return false;   // let only the top frame answer page-level job info
      const d = extractJobDetails(!!req.force);
      sendResponse({ success: true, data: { role: d.role, company: d.company, text: d.jobText, url: d.url } });
      return false;
    }
    if (req.action === "EXECUTE_AUTOFILL") {
      autofillApplicationForm(req.jobContext || "")
        .then(res => sendResponse({ success: true, ...res }))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (req.action === "LOCATE_FIELD") {
      sendResponse({ success: AegisAutofill.locate(req.id) });
      return false;
    }
    return false;
  });
})();
