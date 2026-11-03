# Tester sign-in: required Supabase settings

Testers added to a project (Projects → Members) get a Supabase invite email. The link opens
`${PLATFORM_URL}/accept-invite`, where they set a password. They then sign in with that email and
password from the React Native reporter (via the backend's `/api/auth/login`). A tester who lost the
email, or whose invite was not sent, uses **Forgot password** on the platform login page, which sends
a reset link to the same `/accept-invite` page.

Member access to a project is granted only when the signed-in account's email **is confirmed** in
Supabase (`email_confirmed_at` set) and equals the address the owner added (case-insensitive, exact).

## Settings the project owner must configure in the hosted Supabase project

These cannot be set from this repo and were **not verified** against the hosted project (no access
during development). Check each one before inviting external testers.

1. **Authentication → URL Configuration → Redirect URLs**: add `${PLATFORM_URL}/accept-invite`
   (for example `https://app.example.com/accept-invite`, plus `http://localhost:3000/accept-invite`
   for local development). Without it Supabase falls back to the Site URL and the tester never sees
   the set-password form. Also set **Site URL** to the platform URL.
2. **Authentication → Providers → Email → Confirm email: ON.** Member access trusts the email only
   once confirmed. Turning this off would let anyone sign up with a tester's address.
3. **Secure email change: ON** (Authentication → Providers → Email). Otherwise an account could
   switch to a tester's address with one confirmation.
4. **Custom SMTP** (Project Settings → Authentication → SMTP Settings). The built-in sender is heavily
   rate limited and only delivers to members of the Supabase organization, so invites to external
   testers silently do not arrive without it. When an invite is not sent the platform shows
   "Added, but the invite email was not sent".
5. *(Optional)* **Email templates → Invite user / Reset password**: the default templates work.
   If you customise them, keep `{{ .ConfirmationURL }}` as the link (the accept-invite page supports
   the PKCE `?code=`, `?token_hash=&type=` and `#access_token` forms). A template that links to
   `{{ .SiteURL }}/accept-invite?token_hash={{ .TokenHash }}&type=invite` (or `type=recovery` for the
   reset template) also works and avoids link-prefetch issues in some mail clients.

## Backend environment

- `PLATFORM_URL` — base URL of the platform; invites redirect to `${PLATFORM_URL}/accept-invite`.
- `RETENTION_ADMIN_USER_IDS` — comma-separated user ids allowed to run the global retention cleanup
  (`POST /api/issues/retention/cleanup`); empty means nobody.

## Not verified without hosted-project access

- That invite and recovery emails arrive (depends on SMTP above).
- Which link form the hosted project's templates produce (PKCE code vs. token hash vs. implicit hash);
  the page handles all three, but only the local build was exercised.
- That `email_confirmed_at` is set after an invite is accepted (Supabase documents that accepting an
  invite confirms the email; not observed here).
