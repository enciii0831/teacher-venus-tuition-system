# Teacher VENUS Tuition Fee Management System

Student, Tuition Fee and Attendance Management System for one Owner and one Co-owner.

学生、学费、付款、班级、时间表与点名管理系统。系统资料保存在 Supabase，不会写入 GitHub 文件。

## Main features / 主要功能

- Students with Y1–Y6 and F1–F5 classifications
- Classes, timetable and attendance history
- Monthly fees, additional charges, discounts and partial payments
- Database-issued receipt numbers and saved receipt snapshots
- Owner and Co-owner login through Supabase Authentication
- Shared cloud data protected by Row Level Security

## Local use / 本地打开

From this folder, start a local server on port 3000:

```powershell
python -m http.server 3000
```

Then open `http://localhost:3000`. Do not open `index.html` with `file:///`.

也可以双击 `Start Teacher VENUS Server.cmd`，再打开 `http://localhost:3000`。

## Supabase connection / 连接 Supabase

The frontend configuration is stored in `supabase-client.js` and may contain only:

- Supabase Project URL
- Supabase Publishable Key (`sb_publishable_...`)

Run SQL migrations in `supabase/migrations/` in timestamp order. Keep Row Level Security enabled.

## GitHub Pages / 发布网页

The workflow in `.github/workflows/pages.yml` tests and builds the website, then publishes `dist/static` to GitHub Pages.

Repository settings:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions**.
3. Push to the `main` branch or run the workflow manually.

All website assets use relative paths, so the repository subdirectory URL works correctly.

## Updating the website / 更新网页

Edit the source files, run the checks, then commit and push:

```powershell
npm test
npm run build
```

GitHub Pages deploys the updated website automatically after a successful push to `main`.

## Supabase redirect URLs

After the GitHub Pages URL is available, configure Supabase:

**Authentication → URL Configuration**

- Site URL: `https://GITHUB-USERNAME.github.io/teacher-venus-tuition-system/`
- Redirect URL: `https://GITHUB-USERNAME.github.io/teacher-venus-tuition-system/**`
- Keep local testing: `http://localhost:3000/**`

This is required for invitations, forgot-password links and password reset links.

## Backup / 资料备份

Use the system's JSON backup/export function. Store backup files privately and never commit them to GitHub.

## Safe to publish / 可以公开

- Supabase Project URL
- Supabase Publishable Key
- HTML, CSS and JavaScript application code
- SQL schema migrations without passwords or private data

## Never publish / 绝对不能上传

- Supabase Secret Key or `service_role` key
- Database password
- Email/SMTP password
- GitHub password, token or Personal Access Token
- Access tokens or refresh tokens
- Student names, parent phone numbers, payments or attendance records
- JSON backups or browser storage exports

The site asks search engines not to index it, and unauthenticated visitors cannot access workspace data. The Owner and invited Co-owner are still responsible for keeping their passwords private.
