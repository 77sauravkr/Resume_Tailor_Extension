# Auto Job Resume Tailor

Chrome extension (MV3, no build step). Upload your resume once, then:

- **Autofill** job applications in one click (names, contact, address, education, work history, EEO and preference questions, resume/cover-letter upload, screening questions).
- **Generate Custom Resume**: a strict 1-page Overleaf-style resume (Jake template) tailored to each job description, without inventing experience.
- **Generate Cover Letter** from your profile and the JD.

All data stays in `chrome.storage.local`. Nothing is bundled in the source.

## Install
1. `chrome://extensions` -> enable Developer mode -> Load unpacked -> select this folder.
2. The setup page opens: upload your resume (PDF). Add a free Gemini key (https://aistudio.google.com/apikey) for full extraction, tailoring and cover letters. Without a key, basic details import and tailoring only reorders keywords.
3. Open a job page, click the extension icon (side panel), click **Autofill**.

## Notes
- Reload job tabs that were open before installing so the content script is present.
- Autofill attaches the resume you uploaded in Documents. Save the tailored PDF from the viewer (Print -> Save as PDF) and upload it there to use it for a specific application.
- Custom dropdowns (React-select, some Workday widgets) are not filled and show as unsure in the completion list.
- PDF parsing uses bundled pdf.js 3.11.174 (Apache-2.0).
