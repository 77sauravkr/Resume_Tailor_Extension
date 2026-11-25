// content.js - Job detail extraction and autofill runner (runs on every page)

(function () {
  if (window.__aegisJobTailorLoaded) return;   // injected twice (manifest + panel fallback)
  window.__aegisJobTailorLoaded = true;
  
  let cachedJobData = null;

  // 1. Intelligent Job Details Scraper (LinkedIn, Greenhouse, Lever, Ashby, Workday, Portals)
  function extractJobDetails(forceRefresh = false) {
    if (!forceRefresh && cachedJobData && cachedJobData.url === window.location.href && cachedJobData.jobText.length > 80) {
      return cachedJobData;
    }

    let company = "";
    let role = "";
    let text = "";

    const url = window.location.href.toLowerCase();

    // 1. LINKEDIN SPECIALIZED SCRAPING (handles /jobs/view/..., /jobs/search/..., /jobs/collections/...)
    if (url.includes("linkedin.com")) {
      // 1A. Primary Regex extraction from document.title
      // Examples:
      // "Associate Engineer, Systems - Software Architecture at HARMAN India | LinkedIn"
      // "HARMAN India hiring Associate Engineer, Systems - Software Architecture in Bengaluru... | LinkedIn"
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

      // 1B. DOM fallback for Role if missing or generic
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
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.trim().length > 1) {
            const t = el.innerText.trim();
            const lower = t.toLowerCase();
            if (!lower.includes("search") && !lower.includes("linkedin") && t !== "Jobs" && t !== "Feed" && t !== "Home") {
              role = t;
              break;
            }
          }
        }
      }

      // 1C. DOM fallback for Company if missing or generic
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
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.trim().length > 1) {
            const t = el.innerText.trim();
            const lower = t.toLowerCase();
            if (!lower.includes("see all") && !lower.includes("apply") && lower !== "linkedin" && !lower.includes("followers") && !lower.includes("connections")) {
              company = t;
              break;
            }
          }
        }
      }

      // 1D. LinkedIn JD Selectors
      const jdSelectors = [
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
      ];
      for (const sel of jdSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 80) {
          text = el.innerText.trim();
          break;
        }
      }
    }
    // 2. GREENHOUSE
    else if (url.includes("greenhouse.io")) {
      company = document.querySelector(".company-name, #header .company-name, [class*='company']")?.innerText?.trim() || "";
      role = document.querySelector(".app-title, h1.app-title, h1")?.innerText?.trim() || "";
      text = document.querySelector("#content, .content, main")?.innerText?.trim() || "";
    }
    // 3. LEVER
    else if (url.includes("lever.co")) {
      company = document.querySelector(".posting-header .main-header, .posting-header a, .main-header")?.innerText?.split("–")[0]?.trim() || "";
      role = document.querySelector(".posting-headline h2, h2.posting-headline, h2, h1")?.innerText?.trim() || "";
      text = document.querySelector(".section-page, .content, main")?.innerText?.trim() || "";
    }
    // 4. NAUKRI
    else if (url.includes("naukri.com")) {
      role = document.querySelector(".jd-header-title, h1.jd-header-title, h1")?.innerText?.trim() || "";
      company = document.querySelector(".jd-header-comp-name, .comp-name, a.comp-name")?.innerText?.trim() || "";
      text = document.querySelector(".jd-description, .job-desc, section.job-desc-container")?.innerText?.trim() || "";
    }
    // 5. ASHBY
    else if (url.includes("ashbyhq.com")) {
      role = document.querySelector("h1, [class*='jobTitle']")?.innerText?.trim() || "";
      company = document.querySelector("h2, .company-name, [class*='companyName']")?.innerText?.trim() || "";
      text = document.querySelector(".job-description, main, article")?.innerText?.trim() || "";
    }
    // 6. WORKDAY
    else if (url.includes("myworkdayjobs.com")) {
      // Look for real job title heading (often next to or above Apply button)
      let detectedRole = "";
      const headings = Array.from(document.querySelectorAll("[data-automation-id='jobPostingHeader'], h2[data-automation-id='jobTitle'], [data-automation-id='jobTitle'], h2, h1"));
      for (const h of headings) {
        const txt = h.innerText?.trim() || "";
        if (txt.length > 3 && !/jobs|careers|welcome|sign in|home/i.test(txt)) {
          detectedRole = txt;
          break;
        }
      }
      // If still empty or generic, extract from URL slug (e.g., /job/Bangalore/AWS-Cloud-Engineer-Cariad-A...)
      if (!detectedRole) {
        const jobSlug = window.location.pathname.match(/\/job\/(?:[^\/]+\/)?([^\/\?]+)/i);
        if (jobSlug && jobSlug[1]) {
          detectedRole = jobSlug[1].replace(/[-_][A-Z0-9]{5,}$/i, "").replace(/[-_]/g, " ").trim();
        }
      }
      role = detectedRole;

      // Extract Company: from URL path (e.g. /Embitel_Technologies/job/) or subdomain
      let detectedComp = document.querySelector("[data-automation-id='companyName'], [data-automation-id='subtitle']")?.innerText?.trim() || "";
      if (!detectedComp || /myworkday/i.test(detectedComp)) {
        const pathMatch = window.location.pathname.match(/\/(?:[a-z]{2}-[A-Z]{2}\/)?([^\/]+)\/job/i);
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
      text = document.querySelector("[data-automation-id='jobPostingDescription'], .job-description, main")?.innerText?.trim() || "";
    }
    // 7. AMAZON JOBS
    else if (url.includes("amazon.jobs")) {
      company = "Amazon";
      role = document.querySelector("h1.title, h1[class*='title'], h1")?.innerText?.trim() || "";
      const descEl = document.querySelector("#job-detail-body, .description, [class*='description'], main");
      text = descEl?.innerText?.trim() || "";
    }

    // 8. GENERIC HEURISTIC FALLBACKS
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

    cachedJobData = {
      company: company || "Target Employer",
      role: role || "Software Engineer",
      jobText: text.replace(/\s+/g, " ").trim().slice(0, 5000),
      url: window.location.href
    };

    return cachedJobData;
  }

  // 2. Autofill: profile comes from the editor page (editor.html)
  async function autofillApplicationForm() {
    const store = await chrome.storage.local.get(["autofillProfile"]);
    const profile = AegisAutofillData.normalize(store.autofillProfile);
    const jobInfo = extractJobDetails();
    return AegisAutofill.run(profile, {
      answer: question => chrome.runtime.sendMessage({
        action: "ANSWER_QUESTION", question, jobContext: jobInfo.jobText
      }).then(r => (r?.success ? r.answer : "")).catch(() => "")
    });
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === "GET_JOB_DETAILS") {
      const d = extractJobDetails(!!req.force);
      sendResponse({ success: true, data: { role: d.role, company: d.company, text: d.jobText, url: d.url } });
      return false;
    }
    if (req.action === "EXECUTE_AUTOFILL") {
      autofillApplicationForm()
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
