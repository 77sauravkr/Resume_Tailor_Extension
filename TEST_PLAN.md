# Auto Job Resume Tailor - issues fixed and how to test

Folder: auto-job-resume-tailor-public (Chrome MV3, no build). Load unpacked at chrome://extensions, then Reload after every code change.

## Fixed so far
1. Resume import with no AI key: regex parser (resume-import.js `heuristic`) reads Jake-style resumes: contact, links (PDF hyperlinks), summary, skill groups, jobs + bullets, projects (+Code/Live links), education, achievements.
2. AI import (Gemini/Groq): per section, the richer of AI vs regex result is kept, so AI cannot drop skills/bullets.
3. Stale/empty profile: if a resume file is stored but work/education are empty, editor re-reads it automatically on open. Button "Documents -> Re-read resume" does the same.
4. Job not detected on tabs opened before install: panel injects content scripts (chrome.scripting) and retries.
5. Groq JSON-mode ping failed (prompt lacked the word JSON).
6. Country-code select ("India (+91)") now matches.
7. Tailoring honesty: a bullet may only use skills that job/project already has; proper nouns (CloudStack, Ceph...) must survive; single sentence; no JD keyword the candidate lacks; original resume data never mutated. Tailoring = new summary, reordered skills, JD keywords bolded (max 2/bullet), most relevant bullets/projects first.
8. Cover letter: no invented years/agile/scale; plain hyphens only.
9. Viewer simplified (header + Download PDF only). Panel/editor/viewer share one theme.

10. Panel redesigned: job title/company/JD always visible and editable; ATS card shows "Your resume X% -> After tailoring Y%", matched keywords, gap keywords (tap to exclude). "Tailor Resume" adds the chosen gap keywords to Skills (best-fit line) + Summary, bolds JD keywords already in bullets, opens the viewer (Download PDF). Score = JD keywords found in resume text.
11. Fixed: panel.js `esc` clashed with ai-service.js `esc` (SyntaxError that would blank the panel). Do not declare top-level names that exist in ai-service.js (esc, termRe, canon, ALT, TECH_TERMS...).

12. AI tailoring places gap keywords: Skills (always, best-fit line) + Summary (AI-written, modest wording) + a few bullets/projects (max 4) ONLY for practice keywords (test plans, test cases, automation frameworks, monitoring...) and only where the bullet already relates; the AI may change 3-4 words, never append clauses. Tools/languages/clouds (AWS, Docker, CI/CD...) never go into bullets. Validator rejects anything else and keeps the original bullet. JSON template is built per job/project (fixes AI returning one entry / misaligned bullets).
   Test with an AI key: gaps selected -> Tailor -> compare bullets vs original; expect 0-4 lightly reworded bullets, score "after" = 100%.

13. UI is now a real toolbar POPUP (action.default_popup = panel.html, 400px wide, scrolls), not the docked side panel. No sidePanel permission.
14. Without an AI key only Skills + Summary change (panel shows a yellow hint and the result line says why). If the AI call fails (rate limit/bad key) the same fallback runs and the error is shown.

## Manual test steps
1. Reload extension. Editor opens with ?setup=1 (or open editor.html). Upload a resume PDF.
   - Expect: Personal (name, email, phone, LinkedIn/GitHub/portfolio), Education (2), Work (jobs with bullets), Skill, Resume content (summary, skill groups, projects with Code/Live links, achievements).
2. Settings (gear in panel): paste a Groq or Gemini key, choose engine, Test -> "Key works". Re-import the resume: check nothing is dropped.
3. Open a job page (e.g. an amazon.jobs posting) WITHOUT reloading it. Open side panel.
   - Expect: company, title, match % ring, Keywords row (matched / to add). If not detected: "Edit job details" -> paste JD -> Save.
4. Tailor Resume (below the keyword chips) -> new tab "Resume for <company>": 1 page, JD keywords bold, no new skills/claims vs original. Download PDF -> print dialog, Save as PDF, 1 page, no headers.
5. Generate Cover Letter: plain text, only facts from resume; Copy works.
6. Autofill on a real application form (Greenhouse/Lever/Ashby/Workday): Completion % + Required/Optional list in the panel; click an item -> field highlights. Resume file input gets the uploaded resume. Cover letter textarea gets the letter.
7. Regressions to look for: console errors in panel/editor/service worker; panel shows "No job detected" on a normal job page; "resume data is empty" after import; AI result missing skills or bullets.

## Known limits
Custom dropdowns (React-select, some Workday widgets) are not filled and show as unsure. Word (.docx) resumes are not parsed; use PDF or paste text. Country code/city/state/country are not in most resumes: fill once in Personal.
