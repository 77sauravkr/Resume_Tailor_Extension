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
- Resume and cover letter files (PDF / DOCX) are stored in the extension's IndexedDB. Use **Use for Autofill** in the resume viewer to set the generated 1-page tailored PDF as your active autofill file immediately (your original resume stays backed up in Documents).
- Supports native `<select>`, custom ARIA/React-Select dropdowns, checkboxes, multiple work/education entries, shadow DOM, and embedded application iframes.
- PDF parsing uses bundled pdf.js 3.11.174 (Apache-2.0).
