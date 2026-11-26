// overleaf-renderer.js - Overleaf-Grade 1-Page ATS Resume HTML & LaTeX Generator

function escapeHtml(str) {
  if (!str) return "";
  // LaTeX-style dashes: "--" -> en dash, "---" -> em dash (matches the compiled Overleaf PDF)
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/---/g, "\u2014").replace(/--/g, "\u2013");
}

function escapeAttr(str) {
  if (!str) return "";
  return String(str).replace(/"/g, "&quot;");
}

// Convert markdown **bold** to <strong>bold</strong> safely
function formatHtmlText(str) {
  if (!str) return "";
  const escaped = escapeHtml(str);
  return escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function escapeLatex(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/–/g, "--")
    .replace(/—/g, "---");
}

// Convert markdown **bold** to \textbf{bold} in LaTeX
function formatLatexText(str) {
  if (!str) return "";
  const parts = str.split(/(\*\*.*?\*\*)/g);
  return parts.map(part => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return `\\textbf{${escapeLatex(part.slice(2, -2))}}`;
    }
    return escapeLatex(part);
  }).join("");
}

function formatDegreeWithGpa(e) {
  const deg = String(e?.degree || "").trim();
  const rawGpa = String(e?.gpa || "").trim();
  if (!rawGpa) return deg;
  const gpaText = /^(c?gpa|grade|percentage|marks)\b/i.test(rawGpa) ? rawGpa : `GPA: ${rawGpa}`;
  return deg ? `${deg}; ${gpaText}` : gpaText;
}

const _fontUrl = file => (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getURL === "function")
  ? chrome.runtime.getURL(`fonts/${file}`)
  : `fonts/${file}`;

// ---- Shared stylesheet (Jake Gutierrez template look). All sizes are em-relative to
// .page so fitResumePage() can scale the whole sheet to fill exactly one Letter page.
const RESUME_CSS = `
  @font-face {
    font-family: 'Latin Modern Roman';
    src: url('${_fontUrl("lmroman10-regular.woff")}') format('woff');
    font-weight: 400; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: 'Latin Modern Roman';
    src: url('${_fontUrl("lmroman10-bold.woff")}') format('woff');
    font-weight: 700; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: 'Latin Modern Roman';
    src: url('${_fontUrl("lmroman10-italic.woff")}') format('woff');
    font-weight: 400; font-style: italic; font-display: swap;
  }
  @font-face {
    font-family: 'Latin Modern Roman Caps';
    src: url('${_fontUrl("lmromancaps10-regular.woff")}') format('woff');
    font-weight: 400 700; font-style: normal; font-display: swap;
  }
  .page, .page * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page {
    --fs: 1; --extra: 0px; --entry-gap: 0px; --skill-gap: 0px;
    width: 8.5in; height: 11in; padding: 0.5in; overflow: hidden; background: #fff; color: #000;
    font-family: 'Latin Modern Roman', 'LMRoman10', 'Computer Modern', 'CMU Serif', 'Times New Roman', serif;
    font-size: calc(10.5pt * var(--fs)); line-height: 1.28;
  }
  .page a { color: #0000ff; text-decoration: none; }
  .page .content { display: flow-root; }
  .page .header { text-align: center; margin-bottom: 0.2em; }
  .page .header h1 {
    font-family: 'Latin Modern Roman Caps', 'Latin Modern Roman', serif;
    font-size: 2.3em; font-weight: 700; font-variant: normal; letter-spacing: 0.03em;
    margin: 0; padding: 0; line-height: 1.1;
  }
  .page .contact-info { font-size: 0.9em; margin-top: 0.15em; }
  .page .section-title {
    font-family: 'Latin Modern Roman Caps', 'Latin Modern Roman', serif;
    font-variant: normal; font-size: 1.2em; letter-spacing: 0.03em;
    margin-top: calc(0.6em + var(--extra, 0px)); margin-bottom: 0.25em;
    border-bottom: 0.75pt solid #000; padding-bottom: 0.1em; line-height: 1.15;
  }
  .page .content > .section-title:first-of-type { margin-top: calc(0.3em + var(--extra, 0px)); }
  .page .summary-text { text-align: justify; font-size: 0.95em; }
  .page ul { list-style-type: disc; margin: 0.15em 0 0.2em 1.4em; padding: 0; }
  .page ul.skills-list { margin-left: 0.6cm; }
  .page ul.skills-list li { margin-bottom: calc(0.35em + var(--skill-gap, 0px)); }
  .page ul li { font-size: 0.95em; margin-bottom: 0.12em; }
  .page .entry { margin-top: calc(0.3em + var(--entry-gap, 0px)); }
  .page .entry-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .page .entry-row > span:first-child { flex: 1; min-width: 0; }
  .page .entry-row > span:last-child { flex-shrink: 0; white-space: nowrap; }
  .page .entry-row.sub { font-size: 0.9em; font-style: italic; }
  .page .entry-row.main { font-weight: 700; }
  .page .entry-row.main span:last-child { font-weight: 400; font-style: normal; }
  .page ul.entry-bullets { margin-left: 1.4em; }
  .page ul.achievements-list { margin-left: 1.4em; }
`;

function _linksHtml(links) {
  return (links || []).map(l => `<a href="${escapeAttr(l.url)}" target="_blank">${escapeHtml(l.label)}</a>`).join(" | ");
}

// 1. Build the resume as a full HTML document (one fixed Letter page)
function buildOverleafResumeHTML(data, opts = {}) {
  const contact = [];
  if (data.contact?.phone) contact.push(`<span>${escapeHtml(data.contact.phone)}</span>`);
  if (data.contact?.email) contact.push(`<a href="mailto:${escapeAttr(data.contact.email)}">${escapeHtml(data.contact.email)}</a>`);
  (data.contact?.links || []).forEach(l => contact.push(`<a href="${escapeAttr(l.url)}" target="_blank">${escapeHtml(l.label)}</a>`));

  const bullets = (arr, max) => (arr || []).map((b, bi) => ({ b, bi }))
    .filter(({ b }) => b && String(b).trim().length > 3).slice(0, max)
    .map(({ b, bi }) => `<li data-bidx="${bi}">${formatHtmlText(b)}</li>`).join("");

  const skillsHtml = (data.skills || []).map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s && s.category && s.items)
    .map(({ s, idx }) => `<li data-idx="${idx}"><strong data-field="skill-cat">${formatHtmlText(s.category)}:</strong> <span data-field="skill-items">${formatHtmlText(s.items)}</span></li>`).join("");

  const expHtml = (data.experience || []).map((exp, idx) => `
    <div class="entry" data-entry-type="experience" data-idx="${idx}">
      <div class="entry-row main"><span data-field="exp-role">${formatHtmlText(exp.role)}</span><span data-field="exp-date">${escapeHtml(exp.date)}</span></div>
      <div class="entry-row sub"><span data-field="exp-company">${formatHtmlText(exp.company)}</span><span data-field="exp-location">${formatHtmlText(exp.location || "")}</span></div>
      <ul class="entry-bullets">${bullets(exp.bullets, 4)}</ul>
    </div>`).join("");

  const projHtml = (data.projects || []).slice(0, 3).map((proj, idx) => `
    <div class="entry" data-entry-type="project" data-idx="${idx}">
      <div class="entry-row">
        <span><strong data-field="proj-title">${formatHtmlText(proj.title)}</strong>${proj.techStack ? ` | <em data-field="proj-stack">${escapeHtml(proj.techStack)}</em>` : ""}</span>
        <span>${_linksHtml(proj.links)}</span>
      </div>
      <ul class="entry-bullets">${bullets(proj.bullets, 3)}</ul>
    </div>`).join("");

  const eduHtml = (data.education || []).map((e, idx) => ({ e, idx }))
    .filter(({ e }) => e && (e.institution || e.degree)).map(({ e, idx }) => `
    <div class="entry" data-entry-type="education" data-idx="${idx}">
      <div class="entry-row main"><span data-field="edu-institution">${formatHtmlText(e.institution)}</span><span data-field="edu-location">${formatHtmlText(e.location || "")}</span></div>
      <div class="entry-row sub"><span data-field="edu-degree">${formatHtmlText(formatDegreeWithGpa(e))}</span><span data-field="edu-date">${formatHtmlText(e.date || "")}</span></div>
    </div>`).join("");

  const achHtml = (data.achievements || []).slice(0, 3).map((a, idx) => {
    if (a && typeof a === "object" && a.text) {
      const link = a.link?.url ? ` &mdash; <a href="${escapeAttr(a.link.url)}" target="_blank">${escapeHtml(a.link.label || "Details")}</a>` : "";
      return `<li data-idx="${idx}"><span data-field="ach-text">${formatHtmlText(a.text)}</span>${link}</li>`;
    }
    return `<li data-idx="${idx}"><span data-field="ach-text">${formatHtmlText(String(a))}</span></li>`;
  }).join("");

  const body = `
  <div class="page" id="resume-page">
    <div class="content">
      <div class="header">
        <h1 data-field="name">${escapeHtml(data.name || "Candidate")}</h1>
        <div class="contact-info">${contact.join(" | ")}</div>
      </div>
      ${data.summary ? `<div class="section-title">Summary</div><div class="summary-text" data-field="summary">${formatHtmlText(data.summary)}</div>` : ""}
      ${skillsHtml ? `<div class="section-title">Technical Skills</div><ul class="skills-list">${skillsHtml}</ul>` : ""}
      ${expHtml ? `<div class="section-title">Experience</div>${expHtml}` : ""}
      ${projHtml ? `<div class="section-title">Projects</div>${projHtml}` : ""}
      ${eduHtml ? `<div class="section-title">Education</div>${eduHtml}` : ""}
      ${achHtml ? `<div class="section-title">Achievements</div><ul class="achievements-list">${achHtml}</ul>` : ""}
    </div>
  </div>`;

  if (opts.bodyOnly) return body;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(data.name || "Candidate")} - Resume</title>
<style>
  @page { size: letter portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; height: 11in; overflow: hidden; }
  ${RESUME_CSS}
</style></head>
<body>${body}
<script>${fitResumePage.toString()}; window.addEventListener('load', function(){ fitResumePage(document.getElementById('resume-page')); });</script>
</body></html>`;
}

// 3-phase fit algorithm:
// Phase A (shrink): font scale down to 0.82
// Phase B (trim): remove content in priority order if still overflowing at 0.82, then scale to 0.70
// Phase C (spread): distribute leftover slack across section titles, entries, and skills
function fitResumePage(page) {
  if (!page) return;
  const content = page.querySelector(".content");
  if (!content) return;
  const cs = getComputedStyle(page);
  const avail = page.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

  const isOverflowing = () => (content.offsetHeight > avail || page.scrollHeight > page.clientHeight);

  // Reset spacing variables
  page.style.setProperty("--extra", "0px");
  page.style.setProperty("--entry-gap", "0px");
  page.style.setProperty("--skill-gap", "0px");

  // Phase A: Shrink font scale down to 0.82
  let fs = 1.06;
  page.style.setProperty("--fs", fs.toFixed(2));
  while (isOverflowing() && fs > 0.82) {
    fs -= 0.01;
    page.style.setProperty("--fs", fs.toFixed(2));
  }

  // Phase B: Trim content if still overflowing at 0.82
  if (isOverflowing()) {
    const projectEntries = page.querySelectorAll('.entry[data-entry-type="project"]');
    const expEntries = page.querySelectorAll('.entry[data-entry-type="experience"]');
    const achItems = page.querySelectorAll('.achievements-list li');

    // 1. Last bullet of last project
    if (isOverflowing() && projectEntries.length > 0) {
      const lastProj = projectEntries[projectEntries.length - 1];
      const bullets = lastProj.querySelectorAll('.entry-bullets li');
      if (bullets.length > 1) {
        bullets[bullets.length - 1].remove();
      }
    }

    // 2. Last bullet of first project
    if (isOverflowing() && projectEntries.length > 0) {
      const firstProj = projectEntries[0];
      const bullets = firstProj.querySelectorAll('.entry-bullets li');
      if (bullets.length > 1) {
        bullets[bullets.length - 1].remove();
      }
    }

    // 3. Second achievement
    if (isOverflowing() && achItems.length > 1) {
      achItems[achItems.length - 1].remove();
    }

    // 4. Last bullet of the oldest job
    if (isOverflowing() && expEntries.length > 1) {
      const oldestJob = expEntries[expEntries.length - 1];
      const bullets = oldestJob.querySelectorAll('.entry-bullets li');
      if (bullets.length > 1) {
        bullets[bullets.length - 1].remove();
      }
    }

    // Re-run Phase A from 0.82 down to 0.70
    while (isOverflowing() && fs > 0.70) {
      fs -= 0.01;
      page.style.setProperty("--fs", fs.toFixed(2));
    }
  }

  // Phase C: Spread leftover slack evenly
  const slack = avail - content.offsetHeight;
  if (slack > 0) {
    const titles = page.querySelectorAll(".section-title");
    const entries = page.querySelectorAll(".entry");
    const skillItems = page.querySelectorAll(".skills-list li");

    const usableSlack = Math.max(0, slack - 4);
    const extraGap = titles.length > 0 ? Math.min(14, (usableSlack * 0.45) / titles.length) : 0;
    const entryGap = entries.length > 0 ? Math.min(14, (usableSlack * 0.25) / entries.length) : 0;
    const skillGap = skillItems.length > 0 ? Math.min(14, (usableSlack * 0.30) / skillItems.length) : 0;

    page.style.setProperty("--extra", extraGap.toFixed(1) + "px");
    page.style.setProperty("--entry-gap", entryGap.toFixed(1) + "px");
    page.style.setProperty("--skill-gap", skillGap.toFixed(1) + "px");

    // Safety check: if spreading pushed content over avail, clear gaps and shrink
    if (isOverflowing()) {
      page.style.setProperty("--extra", "0px");
      page.style.setProperty("--entry-gap", "0px");
      page.style.setProperty("--skill-gap", "0px");
      while (isOverflowing() && fs > 0.70) {
        fs -= 0.01;
        page.style.setProperty("--fs", fs.toFixed(2));
      }
    }
  }
}

// 2. Build the .tex source using the user's exact Jake Gutierrez template
const LATEX_PREAMBLE = String.raw`\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-2pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubSubheading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \textit{\small#1} & \textit{\small #2} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}
`;

function buildOverleafLatexCode(data) {
  const safeHrefUrl = u => String(u || "").replace(/([%#])/g, "\\$1");
  const href = (url, label) => `\\href{${safeHrefUrl(url)}}{\\textcolor{blue}{${escapeLatex(label)}}}`;
  const header = [];
  if (data.contact?.phone) header.push(`\\small ${escapeLatex(data.contact.phone)}`);
  if (data.contact?.email) header.push(`\\href{mailto:${safeHrefUrl(data.contact.email)}}{\\textcolor{blue}{${escapeLatex(data.contact.email)}}}`);
  (data.contact?.links || []).forEach(l => header.push(href(l.url, l.label)));

  const items = arr => (arr || []).filter(b => b && String(b).trim().length > 3)
    .map(b => `  \\resumeItem{${formatLatexText(b)}}`).join("\n");

  const skills = (data.skills || []).filter(x => x && x.category && x.items)
    .map(x => `    \\item \\textbf{${escapeLatex(x.category)}:} ${formatLatexText(x.items)}`).join("\n");

  const exp = (data.experience || []).map(e => {
    const expItems = items(e.bullets);
    return `\\resumeSubheading
  {${formatLatexText(e.role)}}{${escapeLatex(e.date)}}
  {${formatLatexText(e.company)}}{${escapeLatex(e.location || "")}}` +
      (expItems ? `\n  \\resumeItemListStart\n${expItems}\n  \\resumeItemListEnd` : "");
  }).join("\n\n");

  const proj = (data.projects || []).slice(0, 3).map(pr => {
    const links = (pr.links || []).map(l => href(l.url, l.label)).join(" $|$\n  ");
    const projItems = items(pr.bullets);
    return `  \\resumeProjectHeading
  {\\textbf{${formatLatexText(pr.title)}}${pr.techStack ? ` $|$ \\emph{${escapeLatex(pr.techStack)}}` : ""}${links ? ` \\hfill\n  ${links}` : ""}}{}` +
      (projItems ? `\n  \\resumeItemListStart\n${projItems}\n  \\resumeItemListEnd` : "");
  }).join("\n\n");

  const edu = (data.education || []).filter(e => e && (e.institution || e.degree)).map(e => `      \\resumeSubheading
        {${escapeLatex(e.institution)}}{${escapeLatex(e.location || "")}}
        {${escapeLatex(formatDegreeWithGpa(e))}}{${escapeLatex(e.date || "")}}`).join("\n");

  const ach = (data.achievements || []).slice(0, 3).map(a => {
    if (a && typeof a === "object" && a.text) {
      const link = a.link?.url ? ` ---\n  ${href(a.link.url, a.link.label || "Details")}` : "";
      return `  \\item ${formatLatexText(a.text)}${link}`;
    }
    return `  \\item ${formatLatexText(String(a))}`;
  }).join("\n");

  return `%-------------------------
% Resume in Latex
% Author : Jake Gutierrez
% Based off of: https://github.com/sb2nov/resume
% License : MIT
%------------------------

${LATEX_PREAMBLE}
\\begin{document}

\\begin{center}
    \\textbf{\\Huge \\scshape ${escapeLatex(data.name || "Candidate")}} \\\\ \\vspace{1pt}
    ${header.join(" $|$\n    ")}
\\end{center}

${data.summary ? `\\section{Summary}\n${formatLatexText(data.summary)}\n` : ""}
${skills ? `\\section*{Technical Skills}\n\\begin{itemize}[leftmargin=0.6cm]\n${skills}\n\\end{itemize}\n` : ""}
${exp ? `\\section{Experience}\n\\resumeSubHeadingListStart\n${exp}\n\\resumeSubHeadingListEnd\n` : ""}
${proj ? `\\section{Projects}\n\\resumeSubHeadingListStart\n${proj}\n\\resumeSubHeadingListEnd\n` : ""}
${edu ? `\\section{Education}\n\\resumeSubHeadingListStart\n${edu}\n\\resumeSubHeadingListEnd\n` : ""}
${ach ? `\\section{Achievements}\n\\begin{itemize}[itemsep=1pt]\n${ach}\n\\end{itemize}\n` : ""}\\end{document}
`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildOverleafResumeHTML, buildOverleafLatexCode, fitResumePage, RESUME_CSS };
}
