# Placement Tracker '27 — deploy with synced storage

Three steps: create a Supabase project, paste two values into `index.html`, put the folder on Vercel.

## 1. Supabase (free) — about 5 minutes

1. Go to https://supabase.com → **Start your project** → sign in with GitHub or email.
2. **New project** → name it `placement-tracker`, set a database password (save it somewhere), pick the Mumbai/Singapore region → **Create**. Wait ~1 min.
3. Left sidebar → **SQL Editor** → **New query** → paste the whole of `supabase-setup.sql` → **Run**. It should say "Success".
4. Left sidebar → **Authentication** → **Providers** → **Email**: turn **Confirm email OFF** (so you can sign in immediately without an email round-trip) → Save.
5. Left sidebar → **Project Settings** (gear) → **API**:
   - copy **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - copy the **anon public** key (long string starting `eyJ…`)

The anon key is designed to be public — the row-level-security policies in the SQL are what keep your data private to your login.

## 2. Put the keys in the page

Open `index.html` in Notepad (right-click → Open with → Notepad), find this near the top of the `<script>`:

```js
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";
```

and paste your values inside the quotes:

```js
const SUPABASE_URL = "https://abcdxyz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

Save. (Double-click `index.html` now and you should get a Sign in dialog — create your account there.)

## 3. Vercel

**Option A — no CLI (dashboard):**
1. Put `index.html` in a GitHub repo (public or private, either is fine on Vercel).
2. https://vercel.com → **Add New → Project** → import that repo → Framework preset **Other** → **Deploy**.

**Option B — CLI:**
```
npm i -g vercel
cd <this folder>
vercel --prod
```

Either way you get `https://<name>.vercel.app`. Open it on any device, sign in with the same email, and your companies, rounds, reminders, profile and resume PDFs are all there.

To update the site later: replace `index.html` and redeploy (push to the repo, or run `vercel --prod` again).

## Moving your existing entries over

If you already have entries in the Downloads copy or on claude.ai: open that copy → **Profile & backup → Export JSON**, then on the deployed site → **Profile & backup → Import JSON**. PDFs are not in the export — re-attach those.
