# 📜 Development Rules & Operating Guidelines (`Rule.md`)

All contributors and AI assistants working on the **Any-to-Any File Converter** project must strictly adhere to these rules.

---

## 🚫 Rule 1: No Unauthorized Git/GitHub Pushes
- **Never push code directly to the remote repository (GitHub)** without explicit permission from the project lead.
- Always work on dedicated feature branches (e.g., `feature/pdf-writer`, `fix/excel-parsing`).
- Code must be reviewed, tested locally, and explicitly approved before opening a Pull Request or pushing to `main` / `master`.

---

## 🧠 Rule 2: Strict "Analyze → Plan → Approve → Code → Test" Workflow
1. **Thorough Analysis First**: Before writing any code, understand the problem, identify dependencies, and verify data formats.
2. **Implementation Plan & Approval**:
   - Write out a clear plan describing what files will be created/modified and what the expected behavior is.
   - **Do NOT start generating or modifying code until the plan is reviewed and approved (or when the user clicks "Proceed").**
3. **Execute & Code**: Implement clean, well-structured, modular code matching the approved plan.
4. **Mandatory Testing & Bug Fixing**:
   - Test every function, conversion path, or UI component locally.
   - Reproduce and fix any bugs immediately before marking the task complete.
   - Never leave broken builds, missing dependencies, or unhandled exceptions.

---

## 🛡️ Rule 3: Respect Existing Architecture
- This project is **browser-only with zero build steps and no server**. Do NOT introduce:
  - Server-side code or backend frameworks.
  - npm/webpack/vite or any build tooling.
  - Dependencies that cannot be loaded from a CDN.
- Maintain the existing file structure (`index.html`, `style.css`, `app.js`) unless a change is explicitly approved.
- New format support should follow the established pattern: add a reader in `parseFile` and/or a writer in `WRITERS`.

---

## 🔍 Rule 4: No Silent Overwrites or Destructive Changes
- **Never overwrite or delete existing working code** without explicit approval.
- When modifying shared logic, verify that all existing conversion paths still work correctly.
- Always preserve existing comments and documentation unless told otherwise.

---

## 📋 Quick Reference Checklist

| Step | Action Required | Status Check |
| :--- | :--- | :--- |
| **Before Starting** | Analyze problem & write implementation plan | ⏸️ Wait for user approval / "Proceed" |
| **During Coding** | Respect existing architecture & file structure | 🔒 No unauthorized framework changes |
| **After Coding** | Run local tests in browser & resolve all bugs | 🧪 Must pass all checks |
| **Before Pushing** | Ask for permission before running any `git push` to GitHub | 🛑 Explicit permission required |
