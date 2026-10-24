# Study with Funi

Exam and test countdowns for university students. Installable on iPhone and Android (Add to Home Screen), works offline, and never sends emails or OTPs.

Live: https://study-with-funi.vercel.app

## How it's built
- Plain HTML, CSS and JavaScript. No build step.
- **Vercel** hosts the site. `api/config.js` passes the public Supabase settings to the browser.
- **Supabase** stores each student's tests and exams (`assessments` table) behind row level security.
- `sw.js` is the service worker (offline + notifications). `manifest.json` makes it installable.

## Accounts (no email)
1. The welcome screen has **Create account** (username, password, confirm password) and **Log in**.
2. Usernames are stored in Supabase as `username@users.studywithfuni.app`. Nothing is ever emailed and there are no OTPs.
3. The same username and password work on any device.

### Resetting a forgotten password
In Supabase, open **SQL Editor**, replace `USERNAME` and `NEW_PASSWORD`, and run:

```sql
update auth.users
set encrypted_password = extensions.crypt('NEW_PASSWORD', extensions.gen_salt('bf'))
where email = 'USERNAME@users.studywithfuni.app';
```

Then tell the student their new password.

## Settings that must stay on in Supabase
- Authentication → Email → **Confirm email: OFF**
- Vercel → Settings → Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
