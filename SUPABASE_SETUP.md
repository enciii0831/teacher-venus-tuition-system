# Teacher VENUS cloud setup

The browser app contains only the Supabase Project URL and Publishable Key. These are intended for public clients. Never paste a Supabase Secret Key, Service Role Key, or database password into `index.html`.

## 1. Create the database and RLS policies

1. Open the Supabase project dashboard.
2. Open **SQL Editor** and create a new query.
3. Copy the entire contents of `supabase/migrations/202607140001_cloud_workspace.sql` into the query and run it once.
4. The script creates the Teacher VENUS Workspace, business tables, `owner` / `co_owner` membership roles, RLS policies, Owner protection, cloud-state functions, and the two permitted email invitations.

## 2. Disable public registration

In **Authentication → Providers → Email**, turn off public user sign-ups. Keep Email/Password enabled.

## 3. Create the Owner account

In **Authentication → Users**, use **Add user → Send invitation** for `enciii0831@gmail.com`. The database trigger automatically assigns this account as the original Owner. Do not create or share a password for somebody else.

After the website is published, set **Authentication → URL Configuration → Site URL** to the published site URL and add the same URL to **Redirect URLs**. Then resend the Owner invitation if the earlier link used the wrong destination.

## 4. Deploy the secure invitation function

Deploy `supabase/functions/invite-user/index.ts` as the `invite-user` Edge Function. JWT verification must stay enabled. Set its `APP_URL` secret to the final published website URL. Supabase supplies the server-side admin credential to the hosted function; never add that credential to the browser code.

After signing in as Owner, open **Users** and send the Co-owner invitation to `kxnrnlxm@gmail.com`. The invited account is automatically assigned `co_owner` after creation.

## 5. Verify

1. Sign in as Owner and add a test student.
2. Sign in as Co-owner on another device and confirm the same student appears.
3. Record attendance and a payment from the Co-owner account.
4. Confirm both actions appear under **Audit Logs**.
5. Confirm the Co-owner cannot remove the original Owner and cannot see the Owner-only invitation or Clear All Data controls.
