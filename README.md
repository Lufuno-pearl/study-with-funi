# Study with Funi

A study app for university students: exam countdowns, marks you need per module, a study plan built around your classes, tasks you tick off, a shared focus timer, and study partners you can chat with (including photos and PDFs).

Live: https://study-with-funi.vercel.app

## Setting up the database (do this once)
1. Open Supabase › **SQL Editor** › **New query**.
2. Paste everything from **`funi-v2-setup.sql`** and press **Run**. You should see "Success. No rows returned".
3. It's safe to run again any time. It keeps existing data.

This creates: study partners, feelings, live chat with files (private `chat-files` storage), notifications, tasks & reminders, exam weight/subminimum per module, and turns on live updates.

(`study-circle-setup.sql` and `study-circle-complete-setup.sql` are older versions. You don't need them any more.)

## How it's built
- Plain HTML, CSS and JavaScript. No build step. Vercel hosts it.
- `index.html` – all screens. `styles.css` – the look, with 4 themes (Lavender, Blush, Midnight, Night).
- `js/art.js` – the cartoon avatars, feeling faces and scenes (drawn as SVG).
- `js/core.js` – helpers, themes, navigation, log in, notifications, live updates.
- `js/study.js` – home, tests, modules & marks, study plan, focus sessions, tasks.
- `js/social.js` – profile, feelings, partners, invites, chat with files, notifications.
- `js/boot.js` – starts the app.
- `api/config.js` – gives the browser the public Supabase settings from Vercel.
- `sw.js` – offline support and notifications. `manifest.json` – makes it installable.

## Accounts (no email)
- Create account = username + password + confirm password. Stored in Supabase as `username@users.studywithfuni.app`. Nothing is ever emailed and there are no OTPs.

### Resetting a forgotten password
In Supabase › SQL Editor, replace `USERNAME` and `NEW_PASSWORD`, then Run:

```sql
update auth.users
set encrypted_password = extensions.crypt('NEW_PASSWORD', extensions.gen_salt('bf'))
where email = 'USERNAME@users.studywithfuni.app';
```

## Settings that must stay on
- Supabase › Authentication › Email › **Confirm email: OFF**
- Vercel › Settings › Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

## Notifications
Messages, invites, help requests and "started studying" pop up instantly while Funi is open or in the background. Pop-ups when the app is fully closed need Web Push (a later step).
