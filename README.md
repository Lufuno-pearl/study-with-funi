# Study with Funi

A study app for university students: exam countdowns, marks you need per module, a study plan built around your classes, tasks you tick off, a shared focus timer, and study partners you can chat with (including photos and PDFs).

Live: https://study-with-funi.vercel.app

## Setting up the database (do this once)
1. Open Supabase › **SQL Editor** › **New query**.
2. Paste everything from **`funi-v2-setup.sql`** and press **Run**. You should see "Success. No rows returned".
3. New query again: paste **`funi-v3-setup.sql`** and **Run**. This adds task priority and "notify me before", focus time, photo avatars (public `avatars` storage) and the every-minute push timer (pg_cron + pg_net).
4. New query again: paste **`funi-v4-setup.sql`** and **Run**. This lets Funi buzz your phone when a study timer ends while the app is closed.
5. New query again: paste **`funi-v5-setup.sql`** and **Run**. This adds files for each module (private `module-files` storage, 10 MB a file, 50 MB per person).
6. New query again: paste **`funi-v6-setup.sql`** and **Run**. Accounts now need a verified email (one account per email), log in with username or email, and Funi is limited to 200 accounts (change the number in `funi_max_accounts()`).
7. New query again: paste **`funi-v7-setup.sql`** and **Run**. This adds study rooms, leaderboard + streaks, the study garden, flashcards, quiz battles and voice-note notifications.
8. New query again: paste **`funi-v8-setup.sql`** and **Run**. Cross night rooms then send "… is cross-nighting tonight 🌙".
9. New query again: paste **`funi-v9-setup.sql`** and **Run**. This adds repeating reminders.
10. All of them are safe to run again any time. They keep existing data.

This creates: study partners, feelings, live chat with files (private `chat-files` storage), notifications, tasks & reminders, exam weight/subminimum per module, and turns on live updates.

(`study-circle-setup.sql` and `study-circle-complete-setup.sql` are older versions. You don't need them any more.)

## How it's built
- Plain HTML, CSS and JavaScript. No build step. Vercel hosts it.
- `index.html` – all screens. `styles.css` – the look, with 4 themes (Lavender, Blush, Midnight, Night).
- `js/art.js` – the cartoon avatars, feeling faces and scenes (drawn as SVG).
- `js/core.js` – helpers, themes, navigation, log in, notifications, live updates.
- `js/files.js` – My files: notes, past papers, photos and links under each module.
- `js/fun.js` – study rooms (shared timer + cheers), leaderboard + streaks, study garden.
- `js/cards.js` – flashcard decks (share, flip to study) and quiz battles.
- `js/dash.js` – the dashboard: stat tiles, study graph, calendar, reminders, exam bars.
- `js/study.js` – tests, priorities, marks calculator, study plan, focus sessions, reminders.
- `js/social.js` – profile, feelings, partners, invites, chat with files, notifications.
- `js/boot.js` – starts the app.
- `api/config.js` – gives the browser the public Supabase settings and the push key.
- `api/push.js` – called every minute by Supabase; sends phone pop-ups for due reminders and new notifications.
- `sw.js` – offline support and notifications. `manifest.json` – makes it installable.

## Accounts (username + verified email)
- Create account = username + email + password + confirm password. Supabase emails a confirmation link; one account per email.
- Log in with your username **or** your email. 8 wrong passwords locks a username for 15 minutes.
- Forgot password: Log in › Forgot your password? sends a reset link.
- At most 200 accounts (verified ones, plus sign-ups from the last day still waiting to confirm).
- Older accounts (made before emails) keep working and can add an email in Profile.

### Emails are sent through Gmail (free, about 500 a day)
Supabase › Authentication › Emails › SMTP Settings: host `smtp.gmail.com`, port `465`, username = the Gmail address, password = a Google **app password** (needs 2-Step Verification). Never paste the app password anywhere except Supabase.

### Resetting a password by hand (still works)
In Supabase › SQL Editor, replace `USERNAME` and `NEW_PASSWORD`, then Run:

```sql
update auth.users
set encrypted_password = extensions.crypt('NEW_PASSWORD', extensions.gen_salt('bf'))
where id = (select id from public.study_profiles where username = 'USERNAME');
```

## Settings that must stay on
- Supabase › Authentication › Sign In / Providers › Email: **Confirm email: ON**, **Secure email change: OFF**
- Supabase › Authentication › URL Configuration: Site URL `https://study-with-funi.vercel.app`, Redirect URLs `https://study-with-funi.vercel.app/**`
- Vercel › Settings › Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - The service role key is secret. Paste it straight from Supabase › Project Settings › API keys into Vercel. Never share it anywhere else.

## Notifications
- While Funi is open, everything pops up instantly.
- When Funi is closed, phone pop-ups come through Web Push: Supabase calls `/api/push` every minute, which sends due reminders ("30 min before" etc.) and new messages/invites. The push keys are made automatically and kept in the `funi_settings` table.
- Voice notes in chat are up to 3 minutes (about 180 KB a minute) and are deleted automatically after 7 days by `/api/push`.
- On iPhone, push only works from the home-screen app (Add to Home Screen), then Notifications › turn the switch on.
