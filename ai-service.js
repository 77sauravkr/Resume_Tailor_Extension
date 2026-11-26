// ai-service.js - Resume parsing, JD match analysis, honest JD tailoring, cover letters and screening answers.
// Works with the user's own Gemini / Groq key; every feature has a deterministic offline fallback.

const TECH_TERMS = [
  // languages
  "Java", "JavaScript", "TypeScript", "Python", "Go", "Golang", "C", "C++", "C#", "Rust", "Kotlin", "Swift", "Ruby", "PHP", "Scala", "R", "SQL", "Bash",
  // web
  "React", "React.js", "Angular", "Vue", "Next.js", "Node.js", "Express", "Express.js", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", ".NET",
  "HTML", "CSS", "Tailwind CSS", "Redux", "GraphQL", "REST", "REST APIs", "gRPC", "WebSockets", "Microservices",
  // data
  "MySQL", "PostgreSQL", "MongoDB", "Redis", "Elasticsearch", "DynamoDB", "Cassandra", "NoSQL", "Kafka", "RabbitMQ", "Spark", "Hadoop", "Airflow", "Snowflake", "Pandas", "NumPy",
  // cloud / devops
  "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "CI/CD", "GitHub Actions", "Linux", "Unix", "Git", "Nginx", "Prometheus", "Grafana",
  // ai
  "Machine Learning", "Deep Learning", "NLP", "LLM", "TensorFlow", "PyTorch", "scikit-learn", "OpenCV", "OpenAI", "Generative AI",
  // practices
  "Agile", "Scrum", "TDD", "Unit Testing", "Integration Testing", "System Design", "Distributed Systems", "Data Structures", "Algorithms", "OOP",
  "Object-Oriented Programming", "DBMS", "Operating Systems", "Networking", "Security", "OAuth", "JWT", "Selenium", "Jest", "JUnit", "Postman", "Jira",
  "Debugging", "Code Review", "Cloud Computing", "DevOps", "SDLC", "Android", "iOS", "React Native", "Flutter",
  "Test Automation", "Automation Frameworks", "Test Plans", "Test Cases", "Software Testing", "Quality Assurance", "QA", "Performance Testing",
  "Design Patterns", "Troubleshooting", "Scalability", "Concurrency", "Multithreading", "Object-Oriented Design", "API Design", "Cloud Infrastructure",
  "Monitoring", "Logging", "Load Balancing", "Caching", "Message Queues", "Event-Driven", "Serverless", "Lambda", "S3", "EC2", "Pytest", "Cypress", "Playwright",
  "Maven", "Gradle", "Bitbucket", "GitLab", "Linux", "Shell Scripting", "Data Modeling", "ETL", "Big Data", "Statistics", "Excel", "Tableau", "Power BI"
];

const ALIASES = { "golang": "Go", "react": "React.js", "reactjs": "React.js", "node": "Node.js", "nodejs": "Node.js", "express": "Express.js", "js": "JavaScript", "ts": "TypeScript", "rest api": "REST APIs", "restful": "REST APIs", "k8s": "Kubernetes", "postgres": "PostgreSQL", "ml": "Machine Learning" };

const esc = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const CASE_SENSITIVE = new Set(["Go", "R", "C", "Swift", "Rust", "Ruby", "Scala", "Spring", "Express", "Jest", "Kotlin", "Flutter"]);
const termRe = t => new RegExp(`(^|[^A-Za-z0-9_+#])${esc(t)}(?![A-Za-z0-9_+#])`, CASE_SENSITIVE.has(t) ? "" : "i");
// Drop "Spring" when "Spring Boot" is also present, etc.
const dropShorter = list => list.filter(t => !list.some(u => u !== t && u.toLowerCase().startsWith(t.toLowerCase()) && /[\s.]/.test(u[t.length] || "")));
// Same skill, different wording in a resume (DSA = data structures + algorithms, etc.)
const ALT = { "html": ["html5"], "css": ["css3"], "data structures": ["dsa"], "algorithms": ["dsa"], "object-oriented design": ["oop", "object-oriented", "object oriented"], "object-oriented programming": ["oop"],
  "debugging": ["debug"], "troubleshooting": ["debug", "troubleshoot"], "unit testing": ["unit test"], "test automation": ["automation test"], "software testing": ["testing", "tests"],
  "rest apis": ["rest api", "restful"], "microservices": ["microservice"], "cloud computing": ["cloud"], "operating systems": ["os,", " os "], "api design": ["rest api"] };
// Named tools/languages/clouds: these may go in Skills and Summary but never into a bullet (that would claim work not done).
const TOOLISH = /^(java|python|go|c|c\+\+|c#|rust|kotlin|swift|ruby|php|scala|r|typescript|javascript|sql|bash|aws|gcp|azure|docker|kubernetes|terraform|ansible|jenkins|ci\/cd|github actions|gitlab|bitbucket|maven|gradle|kafka|rabbitmq|redis|elasticsearch|mongodb|mysql|postgresql|dynamodb|cassandra|snowflake|spark|hadoop|airflow|react|react\.js|angular|vue|next\.js|node\.js|express|django|flask|fastapi|spring|spring boot|\.net|graphql|grpc|selenium|jest|junit|pytest|cypress|playwright|postman|jira|linux|unix|nginx|prometheus|grafana|lambda|ec2|s3|tableau|power bi|excel|tensorflow|pytorch|scikit-learn|pandas|numpy|openai|android|ios|flutter|react native|redux|tailwind css|html|css)$/i;
const canon = t => ALIASES[t.toLowerCase()] || t;

// Skills a candidate can pick up well enough to discuss in an interview within hours to a few days.
// They count as "quick" gaps: Safe mode adds them (marked as familiar, never "expert"). Everything else without evidence stays out.
const QUICK = new Set(["agile", "scrum", "jira", "sdlc", "code review", "debugging", "troubleshooting", "security", "monitoring", "logging", "devops",
  "ci/cd", "jenkins", "github actions", "gitlab", "bitbucket", "git", "postman", "linux", "unix", "shell scripting", "bash", "docker", "nginx",
  "rest", "rest apis", "api design", "microservices", "unit testing", "integration testing", "software testing", "test cases", "test plans",
  "test automation", "automation frameworks", "quality assurance", "qa", "tdd", "caching", "load balancing", "message queues", "event-driven", "serverless",
  "aws", "azure", "gcp", "lambda", "s3", "ec2", "cloud computing", "cloud infrastructure", "oauth", "jwt", "html", "css", "excel", "statistics",
  "selenium", "jest", "junit", "pytest", "cypress", "playwright", "maven", "gradle", "tailwind css", "redux", "design patterns", "object-oriented design", "performance testing"]);
// Quick only when the resume already shows the neighbouring skill (e.g. Angular if you know React).
const QUICK_IF = [[/^(angular|vue)$/i, /react|javascript|typescript/i], [/^(spring|spring boot)$/i, /\bjava\b/i], [/^(flask|fastapi|django)$/i, /python/i],
  [/^typescript$/i, /javascript/i], [/^(postgresql|mysql|mongodb|redis|sql|nosql|dynamodb|elasticsearch)$/i, /sql|mongo|database|dbms/i], [/^(express|express\.js|node\.js)$/i, /javascript|node/i]];
const isQuick = (term, have) => QUICK.has(String(term).toLowerCase()) || QUICK_IF.some(([a, b]) => a.test(term) && b.test(have || ""));

class AIService {
  constructor(config = {}) {
    this.geminiKeys = (config.geminiKeys || []).filter(Boolean);
    this.groqKeys = [...(config.groqKeys || []), config.groqKey].filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
    this.groqKey = this.groqKeys[0] || "";
    this.openrouterKeys = (config.openrouterKeys || []).filter(Boolean);
    this.geminiModel = config.geminiModel || "auto";
    this.preferred = config.preferredProvider || "gemini";
  }

  get hasKey() { return this.geminiKeys.length > 0 || this.groqKeys.length > 0 || this.openrouterKeys.length > 0; }

  hasTerm(text, term) {
    const src = String(text || "");
    const t = String(term || "").trim();
    if (!src || !t) return false;
    const c = canon(t);
    if (termRe(t).test(src) || (c !== t && termRe(c).test(src))) return true;
    const lowT = t.toLowerCase(), lowC = c.toLowerCase();
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (target.toLowerCase() === lowC && termRe(alias).test(src)) return true;
    }
    const lowSrc = src.toLowerCase();
    const alts = new Set([...(ALT[lowT] || []), ...(ALT[lowC] || [])]);
    for (const [k, list] of Object.entries(ALT)) {
      if (list.some(a => a.trim() === lowT || a.trim() === lowC) && termRe(k).test(src)) return true;
    }
    for (const a of alts) {
      if (a.startsWith(" ") || a.endsWith(" ") || a.endsWith(",")) {
        if (lowSrc.includes(a)) return true;
      } else if (termRe(a).test(src)) {
        return true;
      }
    }
    return false;
  }

  _condenseJd(jdText, maxLen = 7000) {
    const jd = String(jdText || "").trim();
    if (jd.length <= maxLen) return jd;
    const reqIdx = jd.search(/\b(requirements|qualifications|what you(?:'ll| will) (?:bring|need|do)|skills|must have|preferred|tech(?:nical)? stack|minimum qualifications|responsibilities)\b/i);
    if (reqIdx > 400 && reqIdx < jd.length - 400) {
      const headBudget = Math.min(1800, Math.floor(maxLen * 0.28));
      const tailBudget = maxLen - headBudget - 10;
      const tailStart = Math.max(headBudget, Math.min(reqIdx, jd.length - tailBudget));
      return jd.slice(0, headBudget).trim() + "\n...\n" + jd.slice(tailStart, tailStart + tailBudget).trim();
    }
    const half = Math.floor((maxLen - 10) * 0.45);
    return jd.slice(0, half).trim() + "\n...\n" + jd.slice(-(maxLen - half - 10)).trim();
  }

  // ---------- Candidate knowledge ----------
  _profileText(p) {
    return [p.summary, ...(p.skills || []).map(s => `${s.category} ${s.items}`),
      ...(p.experience || []).flatMap(e => [e.role, e.company, ...(e.bullets || [])]),
      ...(p.projects || []).flatMap(x => [x.title, x.techStack, ...(x.bullets || [])]),
      ...(p.education || []).map(e => `${e.institution} ${e.degree}`)].filter(Boolean).join(" \n ");
  }

  // ---------- 1. Live JD match ----------
  analyzeJobFit(jdText, profile) {
    const jd = String(jdText || "");
    const have = this._profileText(profile || {});
    const matched = [], missing = [];
    const seen = new Set();
    for (const term of TECH_TERMS) {
      if (!termRe(term).test(jd)) continue;
      const label = canon(term);
      if (seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const inProfile = this.hasTerm(have, term) || this.hasTerm(have, label);
      (inProfile ? matched : missing).push(label);
    }
    matched.splice(0, matched.length, ...dropShorter(matched));
    missing.splice(0, missing.length, ...dropShorter(missing));
    const total = matched.length + missing.length;
    const score = total === 0 ? null : Math.round(100 * matched.length / total);
    return { score, matched, missing, jd, jdLower: jd.toLowerCase() };
  }

  // ---------- 1b. AI scan: what the JD asks for vs what the resume really shows ----------
  // Every claim must quote the resume; quotes that are not in the resume are demoted to "missing".
  // Scores are computed here from counts, never taken from the model.
  async scanJobFit(jdText, profile, { useAi = true } = {}) {
    const base = this.analyzeJobFit(jdText, profile);
    // No AI available: still classify gaps locally so "Safe" works. A gap counts as backed ("related") only if it is a
    // practice (not a named tool/language/cloud) AND a bullet/project line of the resume is already about it.
    const lines = [...(profile?.experience || []).flatMap(e => e.bullets || []), ...(profile?.projects || []).flatMap(x => [x.title, ...(x.bullets || [])])].filter(Boolean);
    const haveAll = this._profileText(profile || {});
    const localGap = term => {
      const hit = TOOLISH.test(term) ? null : lines.find(l => this._related(term, l));
      if (hit) return { term, status: "related", evidence: String(hit).slice(0, 80) };
      return isQuick(term, haveAll) ? { term, status: "quick", evidence: "" } : { term, status: "missing", evidence: "" };
    };
    const keywordResult = note => {
      const gaps = base.missing.map(localGap);
      return {
        source: "keywords", aiNote: note || "", matched: base.matched, score: base.score, gaps,
        requirements: [...base.matched.map(term => ({ term, status: "matched" })), ...gaps.map(g => ({ term: g.term, status: g.status }))]
      };
    };
    const jd = this._condenseJd(jdText, 7000);
    if (!this.hasKey) return keywordResult("no-key");
    if (!useAi) return keywordResult("on-demand");
    if (jd.length < 60) return keywordResult();
    const have = this._profileText(profile || {});
    const prompt = `You are an ATS screener. Compare ONE resume to ONE job description. Be strict and honest.

RESUME TEXT:
${have.slice(0, 6000)}

JOB DESCRIPTION:
${jd}

List the 10-18 most important concrete requirements the JD screens for (technologies, tools, languages, testing/engineering practices, domain skills). No soft skills, no years of experience, no degrees.
For each decide status:
- "matched": the resume explicitly shows it (or its standard synonym).
- "related": the resume does not say it, but shows clearly related hands-on work, so adding the keyword would be truthful.
- "missing": no evidence in the resume.
For "matched" and "related" give "evidence": an EXACT short quote (3-10 words) copied from the resume text. For "missing" evidence is "".
Return ONLY JSON: {"requirements":[{"term":"...","status":"matched|related|missing","evidence":"..."}]}`;
    try {
      const parsed = JSON.parse(this._cleanJsonResponse(await this._callWithFallback(prompt, { maxTokens: 1500 })));
      const norm = x => String(x || "").toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").replace(/\s+/g, " ").trim();
      const haveN = norm(have);
      const quoted = q => {
        const n = norm(q);
        if (n.length < 3) return false;
        if (haveN.includes(n)) return true;
        const w = n.split(" ").filter(x => x.length > 2);
        return w.length > 0 && w.filter(x => haveN.includes(x)).length / w.length >= 0.75;
      };
      const seen = new Set(), reqs = [];
      for (const r of parsed.requirements || []) {
        const term = String(r?.term || "").replace(/\s+/g, " ").trim().slice(0, 40);
        let status = ["matched", "related", "missing"].includes(r?.status) ? r.status : "";   // quick is assigned below, never by the model
        if (!term || !status || seen.has(term.toLowerCase())) continue;
        const evidence = String(r.evidence || "").slice(0, 90);
        if (status !== "missing" && !quoted(evidence)) status = "missing";
        if (status === "missing" && isQuick(term, have)) status = "quick";
        seen.add(term.toLowerCase());
        reqs.push({ term, status, evidence: status === "missing" || status === "quick" ? "" : evidence });
        if (reqs.length >= 18) break;
      }
      if (reqs.length < 3) return keywordResult("AI returned too few requirements");
      const matched = reqs.filter(r => r.status === "matched");
      return {
        source: "ai", aiNote: "", matched: matched.map(r => r.term), score: Math.round(100 * matched.length / reqs.length),
        gaps: reqs.filter(r => r.status !== "matched"), requirements: reqs.map(({ term, status }) => ({ term, status }))
      };
    } catch (e) {
      return keywordResult(e.message || "AI failed");
    }
  }

  // ---------- 2. Tailoring ----------
  // addKeywords: JD gap keywords the user chose to add (skills + summary).
  async tailorResume(jobText, base, role = "", company = "", addKeywords = []) {
    const analysis = this.analyzeJobFit(jobText, base);
    analysis.add = [...new Set((addKeywords || []).map(k => String(k || "").trim()).filter(k => k && k.length <= 40))].slice(0, 40);
    analysis.add.forEach(k => { if (!analysis.matched.includes(k) && !analysis.missing.includes(k)) analysis.missing.push(k); });
    if (!this.hasKey) { analysis.aiNote = "no-key"; return this.generateHeuristicTailoring(base, analysis); }

    const ctx = {
      summary: base.summary, skills: base.skills,
      experience: (base.experience || []).map(e => ({ role: e.role, company: e.company, bullets: e.bullets })),
      projects: (base.projects || []).map(x => ({ title: x.title, techStack: x.techStack, bullets: x.bullets }))
    };
    const practice = analysis.add.filter(k => !TOOLISH.test(k));
    const placements = practice.map(k => {
      const where = [];
      (base.experience || []).forEach((e, i) => (e.bullets || []).forEach((b, j) => { if (this._related(k, b)) where.push(`experience[${i}].bullets[${j}]`); }));
      (base.projects || []).forEach((p, i) => (p.bullets || []).forEach((b, j) => { if (this._related(k, b)) where.push(`projects[${i}].bullets[${j}]`); }));
      return where.length ? `${k}: ${where.slice(0, 3).join(", ")}` : null;
    }).filter(Boolean);
    const prompt = `You tailor a candidate's resume to one job description for ATS keyword matching, WITHOUT inventing anything.

CANDIDATE (truth, JSON):
${JSON.stringify(ctx, null, 1)}

TARGET ROLE: ${role || "(unknown)"}   COMPANY: ${company || "(unknown)"}
JD KEYWORDS THE CANDIDATE HAS: ${JSON.stringify(analysis.matched)}
JD KEYWORDS THE CANDIDATE LACKS (never put these in bullets): ${JSON.stringify(analysis.missing)}
KEYWORDS THE CANDIDATE CONFIRMED THEY CAN ADD: ${JSON.stringify(analysis.add)}
  - of these, PRACTICE keywords you may use inside bullets: ${JSON.stringify(practice)}
  - bullets that already relate to them (rewrite these lightly to include the keyword when it reads naturally, otherwise skip): ${placements.length ? placements.join(" | ") : "none"}

JOB DESCRIPTION:
${this._condenseJd(jobText, 7000)}

RULES
1. Rewrite each bullet at the same index, keeping every concrete fact, tool and noun of the original bullet. Mirror the JD's wording where the bullet already says the same thing.
   You decide where the confirmed keywords fit best, spreading them naturally: Summary (strongest ones), and lightly rewording a few bullets across experience and projects (at most 4 bullets in total) ONLY where the bullet's existing work genuinely relates to the keyword, e.g. "built automation tests" -> "built test automation ... ", "debugged issues" -> "troubleshot ...". Use only the PRACTICE keywords listed above inside bullets. Tools, languages and clouds (AWS, Docker, CI/CD, Kubernetes ...) must NEVER appear in a bullet unless the original bullet already had them; they are added to Skills automatically. Never add new activities, metrics, scale or claims. When you weave a keyword, change at most 3 to 4 words and keep every other word of the original bullet exactly (e.g. "Built integration and automation tests, validated existing features..." -> "Built integration tests and test automation, validated existing features..."). Do not append clauses such as "contributing to ...". Leave bullets that do not relate unchanged.
2. Same number of bullets per job/project as the input. Each bullet <= 115 characters, starts with a strong past-tense verb. Bold (**...**) at most 2 JD keywords per bullet.
3. techStack: reorder only (JD matches first). Do not add or remove items.
4. Skills: keep every category and every item; reorder so JD matches come first; each line <= 95 characters; no bold.
5. Summary: 2-3 sentences, 200-290 characters, starts with the candidate's real current title and employer (or education if no experience), mentions the skills the candidate has that the JD wants, plus the strongest confirmed keywords (tools and practices both allowed here) in modest wording such as "skilled in" or "familiar with"; never "expert", "proficient", "proven" or "extensive". No filler.
Return ONLY JSON with EXACTLY these entries, in this order (one object per job and per project, same bullet counts):
${JSON.stringify({
  summary: "...",
  skills: (base.skills || []).map(k => ({ category: k.category, items: "..." })),
  experience: (base.experience || []).map(e => ({ role: e.role, bullets: (e.bullets || []).map(() => "...") })),
  projects: (base.projects || []).map(x => ({ title: x.title, techStack: "...", bullets: (x.bullets || []).map(() => "...") }))
}, null, 1)}`;

    try {
      const parsed = JSON.parse(this._cleanJsonResponse(await this._callWithFallback(prompt)));
      return this._merge(parsed, base, analysis);
    } catch (err) {
      console.warn("[AI] tailoring fell back to heuristic:", err.message);
      analysis.aiNote = err.message || "AI failed";
      return this.generateHeuristicTailoring(base, analysis);
    }
  }

  // Tokens that are specific enough to be a "claim" (tools, techs, CamelCase, digits).
  _claimTokens(text) {
    return (String(text).replace(/\*\*/g, "").match(/[A-Za-z][A-Za-z0-9.+#/-]{1,}/g) || [])
      .filter(t => /[A-Z].*[A-Z]|[0-9+#.]|^[A-Z][a-z]+$/.test(t) || t.length > 3).map(t => t.toLowerCase());
  }

  _allowed(base, analysis) {
    const set = new Set();
    const add = s => this._claimTokens(s).forEach(t => set.add(t));
    add(this._profileText(base));
    (analysis.matched || []).forEach(add);
    return set;
  }

  _bulletOk(ai, orig, allowed, missing = [], entryText = orig, addOk = []) {
    const okTerm = t => addOk.some(a => a.toLowerCase() === canon(t).toLowerCase());
    if (typeof ai !== "string" || ai.trim().length < 15) return false;
    // One sentence only: reject keyword stuffing appended after the full stop.
    if (/[.!?]\s+\S/.test(ai.trim().replace(/\s*[.!?]$/, "")) && !/[.!?]\s+\S/.test(orig.trim().replace(/\s*[.!?]$/, ""))) return false;
    // A skill may only appear in a bullet if the same job/project already uses it.
    if (TECH_TERMS.some(t => termRe(t).test(ai) && !termRe(t).test(entryText) && !termRe(canon(t)).test(entryText) && !okTerm(t) && !(!TOOLISH.test(canon(t)) && this._related(t, orig)))) return false;
    // Never let a JD keyword the candidate lacks into a bullet.
    if (missing.some(m => !okTerm(m) && termRe(m).test(ai) && !termRe(m).test(orig))) return false;
    const filler = /minimal defects|high[- ]throughput|secure data exchange|world[- ]class|cutting[- ]edge|best[- ]in[- ]class|synerg/i;
    if (filler.test(ai) && !filler.test(orig)) return false;
    // Every proper noun / tool name of the original (CloudStack, Ceph, React.js...) must survive.
    const aiLow = ai.toLowerCase();
    const proper = (orig.replace(/\*\*/g, "").match(/[A-Za-z][A-Za-z0-9.+#/-]*/g) || []).slice(1)
      .filter(t => /^[A-Z]/.test(t) || /[a-z][A-Z]/.test(t)).map(t => t.replace(/[.,]+$/, "").toLowerCase());
    if (proper.some(t => !aiLow.includes(t))) return false;
    const origTokens = new Set(this._claimTokens(orig));
    // Unknown technical tokens beyond one => the model invented something.
    const common = this._stopwords;
    const unknown = this._claimTokens(ai).filter(t => !allowed.has(t) && !origTokens.has(t) && !common.has(t));
    if (unknown.length > (addOk.length ? 4 : 2)) return false;
    // Must keep most of the original's specific tokens (facts).
    const keep = [...origTokens].filter(t => !common.has(t) && (/[0-9+#.]|[A-Z]/.test(t) || t.length > 5));
    if (keep.length >= 3) {
      const aiLower = ai.toLowerCase();
      const kept = keep.filter(t => aiLower.includes(t)).length;
      if (kept / keep.length < 0.5) return false;
    }
    return true;
  }

  get _stopwords() {
    if (!this.__sw) {
      this.__sw = new Set(("developed built implemented designed created led managed improved reduced increased optimized wrote worked using with and for the "
        + "that this from into across over under based used applied integrated deployed delivered automated tested maintained collaborated analyzed "
        + "features services systems applications application users data performance quality team teams code testing production process processes "
        + "tools tool real time end solutions solution support responsible ensuring ensure enabling enabled supporting resulting driven focused related "
        + "new existing modern scalable efficient robust reliable seamless secure key core high strong clean multiple various across within through "
        + "while where which their also both each other such than more most well backend frontend software engineering development").split(/\s+/));
    }
    return this.__sw;
  }

  _reorderCsv(baseCsv, aiCsv) {
    const baseItems = String(baseCsv || "").split(",").map(s => s.trim()).filter(Boolean);
    const order = String(aiCsv || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const rank = it => { const i = order.indexOf(it.toLowerCase()); return i < 0 ? 999 : i; };
    return baseItems.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map(x => x.it).join(", ");
  }

  _merge(parsed, base, analysis) {
    const out = JSON.parse(JSON.stringify(base));
    const allowed = this._allowed(base, analysis);

    if (typeof parsed.summary === "string" && parsed.summary.trim().length > 40) {
      const names = (base.experience || []).map(e => (e.company || "").split(",")[0].trim().toLowerCase()).filter(Boolean);
      const ok = !names.length || names.some(n => parsed.summary.toLowerCase().includes(n));
      out.summary = ok ? this._limitBold(this._clampText(this._soften(this._plain(parsed.summary)), 300), 3) : this._composeSummary(base, analysis);
    }

    if (Array.isArray(parsed.skills)) {
      out.skills = (base.skills || []).map((s, i) => ({
        category: s.category,
        items: this._clampSkills(this._reorderCsv(s.items, parsed.skills[i]?.items), 95)
      }));
    }

    const addOk = (analysis.add || []).filter(k => !TOOLISH.test(k));
    let woven = 0;                       // bullets rewritten to carry an added keyword (cap 4)
    const carriesAdd = text => addOk.some(k => termRe(k).test(text));
    // The bullet's own work must already relate to the keyword (shared word stem or a known synonym).
    const related = (t, o) => this._related(t, o);
    const pick = (aiList, entry, i, key) => {
      if (!Array.isArray(aiList)) return null;
      const name = String(entry[key] || "").toLowerCase();
      return aiList[i] && (!aiList[i][key] || String(aiList[i][key]).toLowerCase() === name) ? aiList[i]
        : aiList.find(a => a && String(a[key] || "").toLowerCase() === name) || null;
    };
    const mergeBullets = (list, aiList, key) => (list || []).map((entry, i) => {
      const aiB = pick(aiList, entry, i, key)?.bullets;
      if (!Array.isArray(aiB) || aiB.length !== (entry.bullets || []).length) return entry;
      const entryText = [entry.techStack, entry.role, ...(entry.bullets || [])].join(" ");
      return {
        ...entry,
        bullets: entry.bullets.map((orig, j) => {
          let cand = this._limitBold(this._plain(String(aiB[j] || "")), 2);
          const visLen = cand.replace(/\*\*/g, "").length;
          if (visLen > 118) {
            if (visLen > 160) return orig;
            cand = this._clampBullet(cand, 118);
          }
          if (cand.replace(/\*\*/g, "").length > 118) return orig;   // would wrap to a second line
          if (!this._bulletOk(cand, orig, allowed, analysis.missing, entryText, addOk)) return orig;
          if (carriesAdd(cand) && !carriesAdd(orig)) {
            const used = addOk.filter(k => termRe(k).test(cand) && !termRe(k).test(orig));
            if (!used.every(k => related(k, orig))) return orig;
            // a keyword-carrying rewrite must keep every meaningful word of the original bullet
            const words = (orig.replace(/\*\*/g, "").match(/[A-Za-z][A-Za-z+#.-]{3,}/g) || []).map(w => w.toLowerCase().slice(0, 5));
            const low = cand.toLowerCase();
            if (words.some(w => !low.includes(w))) return orig;
            if (woven >= 4) return orig;
            woven++;
          }
          return cand;
        })
      };
    });
    out.experience = mergeBullets(out.experience, parsed.experience, "role");
    out.projects = mergeBullets(out.projects, parsed.projects, "title").map((x, i) => ({
      ...x,
      techStack: this._reorderCsv(base.projects[i].techStack, pick(parsed.projects, base.projects[i], i, "title")?.techStack)
    }));

    this._finish(out, analysis);
    return out;
  }

  // Offline: reorder only, never rewrites.
  generateHeuristicTailoring(base, analysis) {
    const out = JSON.parse(JSON.stringify(base));
    const jd = analysis.jdLower || "";
    const rank = it => (jd && jd.includes(it.toLowerCase()) ? 0 : 1);
    const sortCsv = csv => String(csv || "").split(",").map(s => s.trim()).filter(Boolean)
      .map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map(x => x.it).join(", ");
    (out.skills || []).forEach(s => { s.items = this._clampSkills(sortCsv(s.items), 95); });
    (out.projects || []).forEach(x => { x.techStack = sortCsv(x.techStack); });
    out.summary = this._composeSummary(base, analysis);
    this._finish(out, analysis);
    return out;
  }

  // Offline summary: the candidate's own first sentence + the JD skills they have / chose to add.
  _composeSummary(base, analysis) {
    const first = String(base.summary || "").split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, "");
    const known = (analysis.matched || []).slice(0, 6);
    const learning = (analysis.add || []).filter(t => !known.includes(t)).slice(0, 4);
    if (!known.length && !learning.length) return base.summary;
    const tail = [known.length ? `Skilled in ${known.join(", ")}` : "", learning.length ? `${known.length ? "familiar" : "Familiar"} with ${learning.join(", ")}` : ""].filter(Boolean).join("; ");
    return this._clampText(`${first ? first + ". " : ""}${tail}.`, 300);
  }

  // Put the chosen gap keywords into the best-fitting skills line.
  _addKeywords(out, analysis) {
    const add = analysis.add || [];
    if (!add.length || !Array.isArray(out.skills)) return;
    if (!out.skills.length) out.skills = [{ category: "Skills", items: "" }];
    const kinds = [
      [/^(java|python|go|c|c\+\+|c#|rust|kotlin|swift|ruby|php|scala|r|typescript|javascript|sql|bash)$/i, /lang/i],
      [/sql|mongo|redis|dynamo|cassandra|elastic|snowflake|nosql|database/i, /data/i],
      [/aws|gcp|azure|docker|kubernetes|terraform|ansible|jenkins|ci\/cd|github actions|devops|nginx|prometheus|grafana|lambda|ec2|s3|cloud|serverless/i, /tool|cloud|devops|platform/i],
      [/react|angular|vue|next|node|express|django|flask|fastapi|spring|\.net|html|css|tailwind|redux|graphql|rest|grpc|websocket|microservice|api/i, /back|front|full|framework|web/i],
      [/design|pattern|algorithm|structure|concurrency|multithread|scalab|system|distributed|oop|object|testing|test|qa|quality/i, /core|concept|fundamental|practice|cs|test/i]
    ];
    // A skills line is one printed line (~128 chars with its "Category: " label). The old code piled every
    // added keyword onto one line and the clamp then silently cut the tail. Now: best-fit line first,
    // then an "Additional" line. A keyword that fits nowhere is simply not added
    // (the popup and viewer report it under "Not added").
    const LIMIT = 128;
    const room = l => LIMIT - (String(l.category).length + 2) - String(l.items || "").length - 2;
    for (const term of add) {
      if (out.skills.some(l => termRe(term).test(l.items || ""))) continue;
      const rule = kinds.find(([re]) => re.test(term));
      let idx = rule ? out.skills.findIndex(s => rule[1].test(s.category)) : -1;
      if (idx < 0) idx = out.skills.findIndex(s => /tool/i.test(s.category));
      if (idx < 0) idx = out.skills.length - 1;
      let target = room(out.skills[idx]) >= term.length ? idx : undefined;   // never park a keyword under an unrelated category
      if (target === undefined) {
        let extra = out.skills.find(l => l.category === "Additional");
        if (!extra) { extra = { category: "Additional", items: "" }; out.skills.push(extra); }
        if (room(extra) >= term.length) target = out.skills.indexOf(extra);
      }
      if (target === undefined) continue;
      const line = out.skills[target];
      line.items = (line.items ? line.items + ", " : "") + term;
    }
    out.skills = out.skills.filter(l => l.items);
  }

  // Honest, visible tailoring: bold the JD keywords each bullet really contains and put the
  // most relevant bullets / projects first. Never changes what a bullet says.
  _emphasize(out, analysis) {
    const terms = analysis.matched || [];
    if (!terms.length) return;
    const hits = text => terms.filter(t => termRe(t).test(text));
    const bold = (text, ts) => {
      let res = text.replace(/\*\*/g, ""), n = 0;
      for (const t of ts) {
        if (n >= 2) break;
        const re = new RegExp(`(^|[^A-Za-z0-9_+#])(${esc(t)})(?![A-Za-z0-9_+#])`, CASE_SENSITIVE.has(t) ? "" : "i");
        if (re.test(res)) { res = res.replace(re, "$1**$2**"); n++; }
      }
      return res;
    };
    const tune = entry => {
      const ranked = (entry.bullets || []).map((b, i) => ({ b: b.replace(/\*\*/g, ""), i, h: hits(b) }))
        .sort((x, y) => y.h.length - x.h.length || x.i - y.i);
      entry.bullets = ranked.map(r => bold(r.b, r.h));
    };
    (out.experience || []).forEach(tune);
    (out.projects || []).forEach(tune);
    const score = p => hits([p.title, p.techStack, ...(p.bullets || [])].join(" ")).length;
    if (Array.isArray(out.projects)) out.projects = out.projects.map((p, i) => ({ p, i })).sort((a, b) => score(b.p) - score(a.p) || a.i - b.i).map(x => x.p);
  }

  _finish(out, analysis) {
    this._addKeywords(out, analysis);
    const after = this.analyzeJobFit(analysis.jd, out);   // what an ATS would see in the tailored resume
    this._emphasize(out, after);
    out.atsBefore = analysis.score;
    out.atsAfter = after.score;
    out.atsScore = after.score;
    out.matchedKeywords = after.matched;
    out.missingKeywords = after.missing;
    out.addedKeywords = (analysis.add || []).filter(k => (out.skills || []).some(l => termRe(k).test(l.items || "")) || termRe(k).test(out.summary || ""));
    out.aiNote = analysis.aiNote || "";
    if (out.summary) out.summary = this._clampText(out.summary, 300);
  }

  // ---------- 3. Resume parsing ----------
  async parseResumeText(text) {
    if (!this.hasKey) throw new Error("NO_KEY");
    const prompt = `Extract this resume into JSON for a job-application autofill tool. Use only what is in the resume; use "" for unknown values. Dates as "YYYY-MM" (end of current job: "" and current:true).
personal.phone = national digits only, personal.countryCode like "+91"; city/state/country separated.
skillGroups: keep the resume's OWN categories, order and wording, and keep EVERY skill item; never drop or merge skills. Keep every bullet of every job and project, word for word. Keep degree and date text exactly as written (e.g. \"10th and 12th\").
Return ONLY JSON:
{"summary":"","personal":{"firstName":"","middleName":"","lastName":"","email":"","countryCode":"","phone":"","address":"","city":"","state":"","country":"","postalCode":"","linkedin":"","github":"","portfolio":""},
"education":[{"school":"","location":"","degree":"","major":"","gpa":"","start":"","end":"","current":false}],
"work":[{"title":"","company":"","location":"","type":"Full-time","start":"","end":"","current":false,"bullets":[""]}],
"skillGroups":[{"category":"","items":""}],
"projects":[{"title":"","techStack":"","codeUrl":"","liveUrl":"","bullets":[""]}],
"achievements":[{"text":"","url":""}]}

RESUME TEXT:
${String(text).slice(0, 14000)}`;
    return JSON.parse(this._cleanJsonResponse(await this._callWithFallback(prompt, { maxTokens: 6000 })));
  }

  // ---------- 4. Cover letter & screening answers ----------
  _years(profile) {
    const mons = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const at = s => { const m = String(s).match(/([A-Za-z]{3})[a-z.]*\s+(\d{4})/); return m ? new Date(+m[2], mons[m[1].toLowerCase()] ?? 0) : null; };
    let ms = 0;
    for (const e of profile.experience || []) {
      const [a, b] = String(e.date || "").split(/\s*--\s*/);
      const start = at(a), end = /present|current/i.test(b || "") ? new Date() : at(b);
      if (start && end && end > start) ms += end - start;
    }
    return Math.round(ms / (365.25 * 24 * 3600e3) * 10) / 10;
  }

  async generateCoverLetter(jobText, profile, role, company) {
    const yrs = this._years(profile);
    const ctx = { name: profile.name, summary: profile.summary, skills: profile.skills,
      experience: (profile.experience || []).map(e => ({ role: e.role, company: e.company, bullets: e.bullets })),
      projects: (profile.projects || []).map(x => ({ title: x.title, bullets: x.bullets })) };
    const prompt = `Write a concise, honest cover letter (3 short paragraphs, under 220 words) for ${profile.name} applying to "${role || "the role"}" at ${company || "the company"}.
Use ONLY facts in the profile: no invented scale, user counts, teamwork styles, years or skills. ${yrs >= 1.5 ? `Total professional experience is about ${Math.round(yrs)} years.` : 'Do not state any number of years; the candidate is early-career.'} Do not mention methodologies (agile, scrum, etc.) or practices unless written in the profile. Mention 2-3 things from the JD the candidate genuinely matches. No placeholders, no cliches, no dashes. Plain text, start with "Dear Hiring Team,", end with "Sincerely," and the name.
PROFILE: ${JSON.stringify(ctx)}
JD: ${this._condenseJd(jobText, 4500)}`;
    return this._plain((await this._callWithFallback(prompt, { json: false }))).replace(/ ?\n ?/g, "\n");
  }

  async answerScreeningQuestion(question, jobContext, profile, extra = {}) {
    const inputType = extra.inputType || "textarea";
    const styleGuide = inputType === "number"
      ? "Return ONLY a single non-negative number (integer or decimal, no units or extra words) taken from the facts. If the facts do not give it, return the single word UNKNOWN."
      : inputType === "text"
        ? "Give a concise 1-line answer (under 80 characters, plain value or short phrase, no filler)."
        : "Answer in first person, 2-4 sentences, using only facts below.";
    const prompt = `You are ${profile?.name || "a candidate"} answering an employer's application question. ${styleGuide} ${inputType === "number" ? "Never guess a number." : "If the facts do not support an answer, give a brief honest answer without inventing numbers, years or skills."}
FACTS: ${JSON.stringify({ summary: profile?.summary, skills: profile?.skills, experience: (profile?.experience || []).map(e => ({ role: e.role, company: e.company, bullets: e.bullets })), ...extra })}
JOB: ${this._condenseJd(jobContext, 2000)}
QUESTION: "${question}"
Return only the answer text.`;
    try {
      let ans = this._plain(await this._callWithFallback(prompt, { json: false, wait: false })).replace(/^["']|["']$/g, "");
      if (inputType === "number") {
        const m = ans.match(/\d+(?:\.\d+)?/);
        ans = m ? m[0] : "";
      } else if (extra.maxLength > 0 && ans.length > extra.maxLength) {
        ans = this._clampText(ans, extra.maxLength).replace(/\.$/, "");
      }
      return ans;
    } catch (e) {
      return "";
    }
  }

  // ---------- Text helpers ----------
  // Models sprinkle non-breaking hyphens and curly quotes; keep resumes plain.
  _plain(str) {
    return typeof str !== "string" ? str : str
      .replace(/[\u2010\u2011\u2012]/g, "-").replace(/[\u2013\u2014\u2015]/g, "-")
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u00A0\u202F\u2009]/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  }

  // Does the bullet's own work already relate to this keyword (shared word stem or a known synonym)?
  _related(term, orig) {
    const low = String(orig).toLowerCase();
    if ((ALT[term.toLowerCase()] || []).some(a => low.includes(a))) return true;
    return term.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && !["with", "data", "code"].includes(w)).some(w => low.includes(w.slice(0, 4)));
  }

  _soften(str) {
    return String(str).replace(/\b(proven|extensive|strong|deep) (experience|expertise|knowledge) (in|with|of)\b/gi, "experience in")
      .replace(/\bexpertise (in|with)\b/gi, "knowledge of").replace(/\b(proficient|expert) (in|with|at)\b/gi, "skilled in");
  }

  _clampText(str, maxLen = 300) {
    if (!str || typeof str !== "string") return str;
    const t = str.trim();
    if (t.length <= maxLen) return t;
    const sliced = t.slice(0, maxLen);
    const sp = sliced.lastIndexOf(" ");
    let res = sp > maxLen * 0.7 ? sliced.slice(0, sp) : sliced;
    res = res.replace(/[,;:\-\s]+$/, "");
    return /[.!?]$/.test(res) ? res : res + ".";
  }

  _clampSkills(str, maxLen = 95) {
    if (!str || typeof str !== "string") return str;
    const t = str.trim();
    if (t.length <= maxLen) return t;
    const out = [];
    let len = 0;
    for (const part of t.split(",").map(p => p.trim()).filter(Boolean)) {
      const next = out.length ? len + 2 + part.length : part.length;
      if (next > maxLen) break;
      out.push(part); len = next;
    }
    return out.length ? out.join(", ") : t.slice(0, maxLen);
  }

  _clampBullet(str, maxLen = 115) {
    if (!str || typeof str !== "string") return str;
    const t = str.trim().replace(/[‐-―]/g, "-");
    if (t.replace(/\*\*/g, "").length <= maxLen) return t;
    // Slice by visible characters so **bold** markers never get split mid-token or count against visible budget.
    let vis = 0, rawCut = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "*" && t[i + 1] === "*") { i++; rawCut = i + 1; continue; }
      if (vis >= maxLen) break;
      vis++;
      rawCut = i + 1;
    }
    const sliced = t.slice(0, rawCut);
    const sp = sliced.lastIndexOf(" ");
    let res = (sp > rawCut * 0.7 ? sliced.slice(0, sp) : sliced).replace(/[,;:\-\s]+$/, "");
    res = res.replace(/\*\*$/, "").trim();
    if ((res.match(/\*\*/g) || []).length % 2) res += "**";
    return res.replace(/\*\*\*\*$/, "");
  }

  _limitBold(str, max = 2) {
    if (!str || typeof str !== "string") return str || "";
    let n = 0;
    let res = str.replace(/\*\*(.*?)\*\*/g, (m, c) => (++n <= max ? `**${c}**` : c));
    if ((res.match(/\*\*/g) || []).length % 2) res = res.replace(/\*\*/g, "");
    return res;
  }

  // ---------- Providers ----------
  // Tries every saved key of the preferred engine, then every key of the other engine.
  // A key that is rate-limited (429) or invalid (400/401/403) is put on a short cooldown and skipped
  // by later calls, so we stop hammering it. Errors of all attempts are reported.
  _keyId(k) { return String(k).slice(-6) + String(k).length; }
  async _loadCool() {
    if (this._cool) return;
    this._cool = {};
    try { this._cool = (await chrome.storage.local.get("keyCooldown")).keyCooldown || {}; } catch (e) {}
  }
  async _setCool(key, ms) {
    await this._loadCool();
    const now = Date.now();
    this._cool[this._keyId(key)] = now + ms;
    for (const k of Object.keys(this._cool)) if (this._cool[k] < now) delete this._cool[k];
    try { await chrome.storage.local.set({ keyCooldown: this._cool }); } catch (e) {}
  }

  async _callWithFallback(prompt, opts = {}) {
    await this._loadCool();
    const order = [this.preferred, "gemini", "groq", "openrouter"].filter((p, i, a) => a.indexOf(p) === i && ["gemini", "groq", "openrouter"].includes(p));
    const keysOf = p => p === "gemini" ? this.geminiKeys : p === "groq" ? this.groqKeys : this.openrouterKeys;
    const NAME = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter" };
    const all = [];
    for (const p of order) keysOf(p).forEach((key, i) => all.push({ p, key, i }));
    const now = Date.now();
    const ready = all.filter(a => !(this._cool[this._keyId(a.key)] > now));
    const errors = [];
    all.filter(a => !ready.includes(a)).forEach(a => errors.push(`${NAME[a.p]} key ${a.i + 1}: cooling down (limit hit or invalid)`));
    if (all.length && !ready.length) {   // every key is cooling down: do not hit the APIs again
      const wait = Math.max(5, Math.ceil((Math.min(...all.map(a => this._cool[this._keyId(a.key)])) - now) / 1000));
      throw new Error(`All keys are rate-limited or invalid right now. Retry in ~${wait}s, add another key, or fix the key in Settings.`);
    }
    for (const a of ready) {
      try {
        const r = a.p === "gemini" ? await this._callGemini(prompt, a.key, opts) : a.p === "groq" ? await this._callGroq(prompt, a.key, opts) : await this._callOpenRouter(prompt, a.key, opts);
        if (r?.trim()) return r;
      } catch (e) {
        errors.push(`${NAME[a.p]} key ${a.i + 1}: ${e.message}`);
        if (e.status === 429) await this._setCool(a.key, Math.min(Math.max((+e.retryAfter || 30) * 1000, 20000), 120000));
        else if ([401, 403].includes(e.status) || e.fatal) await this._setCool(a.key, 10 * 60 * 1000);
      }
    }
    // Short rate limit: wait for the first key to free up and try once more (not for autofill answers).
    if (opts.wait !== false && !opts.retried) {
      const waits = all.map(a => (this._cool[this._keyId(a.key)] || 0) - Date.now()).filter(ms => ms > 0 && ms <= 35000);
      if (waits.length) {
        await this._sleep(Math.min(...waits) + 500);
        return this._callWithFallback(prompt, { ...opts, retried: true });
      }
    }
    throw new Error(errors.length ? errors.join(" | ") : "No AI key configured. Add a Gemini or Groq key in Settings.");
  }

  async _sleep(ms) {
    // Touch an extension API while waiting so the service worker is not shut down.
    for (let left = ms; left > 0; left -= 10000) {
      await new Promise(r => setTimeout(r, Math.min(left, 10000)));
      try { await chrome.storage.local.get("keyCooldown"); } catch (e) {}
    }
  }

  _apiError(name, status, body, retryAfter) {
    let msg = String(body || "");
    try { msg = JSON.parse(msg).error?.message || msg; } catch (e) {}
    const e = new Error(`${name} ${status}: ${msg.replace(/\s+/g, " ").slice(0, 110)}`);
    e.status = status; e.retryAfter = retryAfter;
    return e;
  }

  // OpenRouter: free models rotate, so pick from the live list (free = zero price) instead of hard-coding names.
  async _openrouterModels() {
    if (AIService._orModels && Date.now() - AIService._orModels.at < 6 * 3600 * 1000) return AIService._orModels.list;
    let list = [];
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15000) });
      const data = (await res.json()).data || [];
      const size = id => { const m = id.match(/(\d+(?:\.\d+)?)b\b/i); return m ? parseFloat(m[1]) : 99; };
      const rank = id => { const i = ["gemma", "llama", "gpt-oss", "qwen", "mistral", "nemotron", "ling"].findIndex(k => id.includes(k)); return i < 0 ? 99 : i; };
      list = data.filter(m => m.id.endsWith(":free") && String(m.pricing?.prompt) === "0" && String(m.pricing?.completion) === "0" && (m.context_length || 0) >= 16000 && size(m.id) >= 7)
        .map(m => m.id).sort((a, b) => rank(a) - rank(b));
    } catch (e) {}
    if (!list.length) list = ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"];
    AIService._orModels = { list, at: Date.now() };
    return list;
  }

  async _callOpenRouter(prompt, apiKey, opts = {}) {
    const models = (await this._openrouterModels()).slice(0, 3);
    let lastError = null;
    for (const model of models) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "Auto Job Resume Tailor" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: opts.maxTokens || 3000 }),
          signal: AbortSignal.timeout(45000)
        });
        if (!res.ok) {
          const e = this._apiError("OpenRouter", res.status, await res.text(), res.headers.get("retry-after"));
          if (res.status === 401 || res.status === 403) e.fatal = true;   // bad key: other models fail too
          throw e;
        }
        const content = (await res.json()).choices?.[0]?.message?.content;
        if (content && content.trim()) return content;
      } catch (e) { lastError = e; if (e.fatal) break; }
    }
    throw lastError || new Error("OpenRouter returned an empty response.");
  }

  async _callGroq(prompt, apiKey, opts = {}) {
    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    let lastError = null;
    for (const model of models) {
      const payload = { model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: opts.maxTokens || 3000 };
      if (opts.json !== false) payload.response_format = { type: "json_object" };
      if (model.startsWith("openai/gpt-oss")) payload.reasoning_effort = "low";
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) {
          const e = this._apiError("Groq", res.status, await res.text(), res.headers.get("retry-after"));
          if (res.status === 401 || res.status === 403) e.fatal = true;   // bad key: other models will fail too
          throw e;
        }
        const content = (await res.json()).choices?.[0]?.message?.content;
        if (content && content.trim()) return content;
      } catch (e) { lastError = e; if (e.fatal) break; }
    }
    throw lastError || new Error("Groq returned an empty response.");
  }

  async _geminiModels(apiKey, refresh = false) {
    if (!refresh && AIService._gemModels && Date.now() - AIService._gemModels.at < 6 * 3600 * 1000) {
      return AIService._gemModels.list;
    }
    const fallback = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    let list = [];
    if (apiKey) {
      try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
          headers: { "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(12000)
        });
        if (res.ok) {
          const data = (await res.json()).models || [];
          const skip = /(embedding|imagen|veo|aqa|tts|audio|robotics|bison|gecko|learnlm|computer-use|image|deep-research)/i;
          const rank = id => {
            if (id === "gemini-flash-latest") return 0;
            if (/^gemini-4-hydrogen/i.test(id)) return 1;
            if (/flash-lite/i.test(id)) return 4;
            if (/flash/i.test(id)) return 3;
            if (/hydrogen|neon/i.test(id)) return 5;
            if (/pro|carbon|argon/i.test(id)) return 6;
            if (/gemma/i.test(id)) return 7;
            return 8;
          };
          list = data
            .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
            .map(m => String(m.name || "").replace(/^models\//, ""))
            .filter(id => id && !skip.test(id))
            .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
        } else if (refresh) {
          throw this._apiError("Gemini", res.status, await res.text(), res.headers.get("retry-after"));
        }
      } catch (e) {
        if (refresh) throw e;
      }
    }
    if (!list.length) return fallback;
    // Ensure proven defaults stay available in fallback order if not already listed
    fallback.forEach(m => { if (!list.includes(m) && m !== "gemini-flash-latest") list.push(m); });
    AIService._gemModels = { list, at: Date.now() };
    return list;
  }

  async listGeminiModels(apiKey, refresh = true) {
    return this._geminiModels(apiKey, refresh);
  }

  async _callGemini(prompt, apiKey, opts = {}) {
    const live = await this._geminiModels(apiKey, false);
    const chosen = this.geminiModel && this.geminiModel !== "auto" ? [this.geminiModel] : [];
    const models = [...new Set([...chosen, ...live])].slice(0, 4);
    let lastError = null;
    for (const model of models) {
      let allowJsonMime = opts.json !== false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const generationConfig = { temperature: 0.3, maxOutputTokens: opts.maxTokens || 3000 };
        if (allowJsonMime) generationConfig.responseMimeType = "application/json";
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
            signal: AbortSignal.timeout(45000)
          });
          if (!res.ok) {
            const rawBody = await res.text();
            if (res.status === 400 && allowJsonMime && /responseMimeType|JSON mode/i.test(rawBody)) {
              allowJsonMime = false;
              continue;
            }
            const e = this._apiError("Gemini", res.status, rawBody, res.headers.get("retry-after"));
            if ([401, 403].includes(res.status) || (res.status === 400 && /api[\s_-]?key|API_KEY_INVALID|key not valid/i.test(rawBody))) {
              e.fatal = true;
            }
            throw e;
          }
          const text = (await res.json()).candidates?.[0]?.content?.parts?.map(p => p.text).join("");
          if (text && text.trim()) return text;
          break;
        } catch (e) {
          lastError = e;
          break;
        }
      }
      if (lastError?.fatal) break;
    }
    throw lastError || new Error("Gemini returned an empty response.");
  }

  _cleanJsonResponse(text) {
    if (!text) return "{}";
    let c = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const a = c.indexOf("{"), b = c.lastIndexOf("}");
    return a !== -1 && b > a ? c.slice(a, b + 1) : c;
  }

  async ping() {
    const r = await this._callWithFallback('Reply with exactly this JSON and nothing else: {"ok":true}', { wait: false });
    return /ok/i.test(r);
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { AIService };
