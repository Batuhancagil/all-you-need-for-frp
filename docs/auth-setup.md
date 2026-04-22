# Google Sign-In Setup & Troubleshooting

## Required environment variables

Add these to your `.env` file (and `.env.local` for local development):

```bash
# Google OAuth (required for sign-in)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# NextAuth (required for session encryption)
AUTH_SECRET=your_random_secret   # or NEXTAUTH_SECRET

# For production only - must match your app URL
NEXTAUTH_URL=https://your-domain.com   # e.g. https://myapp.railway.app
```

Generate `AUTH_SECRET` with: `openssl rand -base64 32`

---

## Google Cloud Console setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create/select a project.
2. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
3. Application type: **Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `http://localhost:3000` (for local dev)
   - `https://your-domain.com` (for production – no trailing slash)
5. Under **Authorized redirect URIs**, add:
   - `http://localhost:3000/api/auth/callback/google` (for local dev)
   - `https://your-domain.com/api/auth/callback/google` (for production)

   The redirect URI must match **exactly** – including `http` vs `https`, port, and path.

6. Copy the **Client ID** and **Client Secret** into your `.env` file.

---

## Common errors and fixes

### "redirect_uri_mismatch"

- The redirect URI in the error message must be added to **Authorized redirect URIs** in Google Console.
- For local dev, ensure `http://localhost:3000/api/auth/callback/google` is present.
- For production, add the exact URL your app uses (e.g. `https://all-you-need-for-frp.railway.app/api/auth/callback/google`).
- No wildcards, no trailing slash in the origin.

### "Try signing in with a different account"

- Usually related to redirect URI mismatch – fix the redirect URIs above.
- Ensure the OAuth consent screen is fully configured (APIs & Services → OAuth consent screen).

### Sign-in button does nothing or redirects to a blank page

- Check the browser console and Network tab for errors.
- Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set and loaded (restart dev server after editing `.env`).
- Ensure `AUTH_SECRET` is set, especially in production.

### Works locally but not in production

- Add your production domain to Google Console under both **Authorized JavaScript origins** and **Authorized redirect URIs**.
- Set `NEXTAUTH_URL` to your production URL (e.g. `https://myapp.railway.app`) in the hosting platform’s env vars.

---

## Quick checklist

- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`
- [ ] `AUTH_SECRET` or `NEXTAUTH_SECRET` in `.env`
- [ ] In Google Console: correct redirect URI(s) added
- [ ] In Google Console: correct JavaScript origin(s) added
- [ ] Dev server restarted after changing env vars
- [ ] For production: `NEXTAUTH_URL` set to the real app URL
