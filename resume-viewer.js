// resume-viewer.js - shows the tailored (or base) resume and prints it to a 1-page PDF

let resume = null;

function fileTitle(name, company) {
  const first = (name || "").trim().split(/\s+/)[0] || "Resume";
  const comp = (company || "").replace(/[,|–-].*$/, "")
    .replace(/\b(Inc\.?|LLC\.?|Ltd\.?|Pvt\.?|Corporation|Corp\.?)\b/gi, "")
    .replace(/[\\/:*?"<>|#%&{}$!'`+@=.]/g, "").trim().replace(/\s+/g, "_");
  return comp ? `${first}_${comp}` : `${first}_Resume`;
}

function render() {
  const container = document.getElementById("resume-container");
  if (!document.getElementById("resume-renderer-style")) {
    const style = document.createElement("style");
    style.id = "resume-renderer-style";
    style.textContent = RESUME_CSS;
    document.head.appendChild(style);
  }
  container.innerHTML = buildOverleafResumeHTML(resume, { bodyOnly: true });
  const fit = () => fitResumePage(container.querySelector(".page"));
  fit();
  if (document.fonts?.ready) document.fonts.ready.then(fit);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const s = await chrome.storage.local.get(["latestTailoredResume", "masterGenericResume", "candidateProfile"]);
  const base = s.masterGenericResume || s.candidateProfile;
  const tailored = s.latestTailoredResume;
  const useTailored = params.get("mode") !== "master" && tailored?.data;
  resume = useTailored ? tailored.data : base;

  if (!resume) {
    document.getElementById("title").textContent = "No resume yet";
    document.getElementById("sub").textContent = "Import your resume from the extension setup page first.";
    return;
  }
  const company = params.get("company") || tailored?.targetCompany || "";
  const role = params.get("role") || tailored?.targetRole || "";
  document.getElementById("title").textContent = useTailored ? `Resume for ${company || "this job"}` : "Your resume";
  document.getElementById("sub").textContent = useTailored
    ? [role, resume.atsBefore != null ? `ATS match ${resume.atsBefore}% → ${resume.atsAfter}%` + (resume.atsTotal ? ` (${resume.atsMatched}/${resume.atsTotal} keywords)` : "") : "",
      resume.atsSkipped?.length ? `Not added: ${resume.atsSkipped.join(", ")}` : ""].filter(Boolean).join(" · ")
    : resume.name || "";
  document.title = fileTitle(resume.name, useTailored ? company : "");
  render();
}

document.getElementById("btn-pdf").addEventListener("click", () => window.print());
window.addEventListener("beforeprint", () => fitResumePage(document.querySelector("#resume-container .page")));
init();
