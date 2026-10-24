# Setup

## 1. Shared sheet (Google Apps Script)

1. Open https://sheets.new (Google account u0) and name the sheet `Reading Challenge`.
2. `Extensions` → `Apps Script`.
3. Delete the sample code, paste all of `apps-script/Code.gs`, then `Save`.
4. `Deploy` → `New deployment` → gear icon → `Web app`.
   - `Execute as`: `Me`
   - `Who has access`: `Anyone`
5. `Deploy` → `Authorize access` → choose the account → `Advanced` → `Go to ... (unsafe)` → `Allow`.
6. Copy the `Web app` URL (ends with `/exec`) and set it as `API_URL` in `index.html`.

The sheet gets two tabs automatically: `Entries` (one row per book) and `Settings` (target, prize).

## 2. GitHub Pages

1. https://github.com/new → Repository name `reading-challenge` → `Public` → `Create repository`.
2. Push this folder to `main`.
3. Repository `Settings` → `Pages` → `Source`: `Deploy from a branch` → Branch `main` / `/ (root)` → `Save`.
4. The app opens at `https://yuichi66.github.io/reading-challenge/`.

## 3. iPhone

Open the URL in Safari → `Share` → `Add to Home Screen` → `Add`.
