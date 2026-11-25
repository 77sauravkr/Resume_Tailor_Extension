# PLAN: Editor page - remove duplicate fields + card height fits content

Executor: Gemini 3.8 Flash. Files: `editor.js`, `editor.css` (folder: auto-job-resume-tailor-public). No build step. Do not touch other files.

## Problem (from screenshot of editor.html?section=personal)
1. Duplicate-looking fields in Personal section: Preferred first/middle/last name repeat First/Middle/Last name; "County" repeats "State / Province". "Skills" section and "Resume content > Skill groups" also overlap.
2. The white card (`main`) stretches to the bottom of the window even when content is short. It should end where the content ends (rounded card look), with the Save button inside the card right under the content.

## Steps
1. `editor.js` SECTIONS -> `personal` fields: delete the line with `prefFirst/prefMiddle/prefLast` and delete `["county", "County"]` (keep `postalCode`). Do NOT rename data keys elsewhere. Check `autofill-data.js` / `autofill-engine.js` with grep: if they still read `prefFirst`, `prefMiddle`, `prefLast`, `county`, leave those reads as they are (empty value is fine).
2. Skills duplicate: in the `skills` section hint, change text to "Flat list for form skill fields. Your resume skill groups are in Resume content." Do not delete the section (autofill uses it).
3. `editor.css`:
   - `.shell`: change `min-height: 100vh` to `align-items: flex-start; padding: 24px 0;`.
   - `main`: remove `min-height: 100vh`; add `border: 1px solid #e4e4e0; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.05); overflow: hidden;` (keep `flex:1`, white background, column flex).
   - `#pane`: remove `flex: 1`.
   - `footer`: change `position: sticky; bottom: 0` to `position: static`.
   - `aside`: add `position: sticky; top: 24px;`.
4. Setup wizard (`?setup=1`) uses the same `main`, so check it still looks right (steps bar + footer Back/Next inside card).

## Verify
- `node --check editor.js`
- Reload extension at chrome://extensions, open editor.html?section=personal: no Preferred-name or County fields; card ends right after Portfolio URL with the Save button directly under it; long sections (Resume content) still scroll normally with the page.
- Save still works; no console errors.
