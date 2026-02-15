# Setup + Deploy (Supabase + Domain) - Non-Technical Guide

## 1. Create Supabase Project
1. Go to https://supabase.com and create a project.
2. Open `SQL Editor` -> `New Query`.
3. Paste contents of `/Users/aditya/Documents/codex/live-app/supabase/setup.sql` and run.
4. Open `Authentication` -> `Providers` -> keep Email enabled.
5. Open `Authentication` -> `URL Configuration`:
   - Add your site URL (after deployment), example: `https://erp.yourdomain.com`

## 2. Add Supabase Keys to App
1. Open `Project Settings` -> `API` in Supabase.
2. Copy `Project URL` and `anon public` key.
3. Open `/Users/aditya/Documents/codex/live-app/config.js` and fill:

```js
window.SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_ID.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY"
};
```

## 3. Test Locally
1. Run local server in terminal:

```bash
python3 -m http.server 4173 --directory /Users/aditya/Documents/codex/live-app
```

2. Open [http://127.0.0.1:4173](http://127.0.0.1:4173)
3. Use `Create Account` to register.
4. Sign in and verify data persists after refresh.

## 4. Deploy to Vercel (easy)
1. Create a GitHub repo and upload `/Users/aditya/Documents/codex/live-app` files.
2. Go to https://vercel.com -> `New Project` -> import repo.
3. Framework preset: `Other`.
4. Build command: leave empty.
5. Output directory: `.`
6. Deploy.

## 5. Connect Your Domain
1. In Vercel project -> `Settings` -> `Domains` -> add your domain/subdomain.
2. Add DNS records exactly as Vercel shows (at your domain registrar).
3. Wait for SSL certificate to become active.
4. Copy final domain URL.

## 6. Final Supabase Auth Settings
1. Go back to Supabase -> `Authentication` -> `URL Configuration`.
2. Set:
   - Site URL: your deployed domain (example: `https://erp.yourdomain.com`)
   - Redirect URLs: same domain
3. Save.

## 7. Done
- Your app is now hosted on your domain.
- Login/Auth uses Supabase.
- Data is stored in Supabase database table `erp_state`.

## Optional Next Step (Production-grade)
- Move from single `erp_state` JSON table to normalized tables (`enquiries`, `quotations`, `work_orders`, etc.) and strict RBAC policies.
