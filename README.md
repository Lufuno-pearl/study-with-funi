# Study with Funi

A study app for university students: exam countdowns, marks you need per module, a study plan built around your classes, tasks you tick off, a shared focus timer, and study partners you can chat with (including photos and PDFs).

Live: https://study-with-funi.vercel.app

## Setting up the database (do this once)
1. Open Supabase › **SQL Editor** › **New query**.
2. Paste everything from **`funi-v2-setup.sql`** and press **Run**. You should see "Success. No rows returned".
3. New query again: paste **`funi-v3-setup.sql`** and **Run**. This adds task priority and "notify me before", focus time, photo avatars (public `avatars` storage) and the every-minute push timer (pg_cron + pg_net).
4. Both are safe to run again any time. They keep existing data.

This creates: study partners, feelings, live chat with files (private `chat-files` storage), notifications, tasks & reminders, exam weight/subminimum per module, and turns on live updates.

(`study-circle-setup.sql` and `study-circle-complete-setup.sql` are older versions. You don't need them any more.)

## How it's built
- Plain HTML, CSS and JavaScript. No build step. Vercel hosts it.
- `index.html` – all screens. `styles.css` – the look, with 4 themes (Lavender, Blush, Midnight, Night).
- `js/art.js` – the cartoon avatars, feeling faces and scenes (drawn as SVG).
- `js/core.js` – helpers, themes, navigation, log in, notifications, live updates.
- `js/dash.js` – the dashboard: stat tiles, study graph, calendar, reminders, exam bars.
- `js/study.js` – tests, priorities, marks calculator, study plan, focus sessions, reminders.
- `js/social.js` – profile, feelings, partners, invites, chat with files, notifications.
- `js/boot.js` – starts the app.
- `api/config.js` – gives the browser the public Supabase settings and the push key.
- `api/push.js` – called every minute by Supabase; sends phone pop-ups for due reminders and new notifications.
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
- Vercel › Settings › Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - The service role key is secret. Paste it straight from Supabase › Project Settings › API keys into Vercel. Never share it anywhere else.

## Notifications
- While Funi is open, everything pops up instantly.
- When Funi is closed, phone pop-ups come through Web Push: Supabase calls `/api/push` every minute, which sends due reminders ("30 min before" etc.) and new messages/invites. The push keys are made automatically and kept in the `funi_settings` table.
- On iPhone, push only works from the home-screen app (Add to Home Screen), then Notifications › turn the switch on.
