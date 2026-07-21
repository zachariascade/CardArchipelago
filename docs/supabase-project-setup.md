# Supabase Project Setup

Project URL:

```txt
https://yattqisxxkymbcnrpdbn.supabase.co
```

## Local Frontend Environment

The local app reads Supabase config from `.env.local`:

```txt
VITE_SUPABASE_URL=https://yattqisxxkymbcnrpdbn.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VITE_ANALYSIS_ENDPOINT=https://yattqisxxkymbcnrpdbn.supabase.co/functions/v1/analyze
```

Only use the Supabase publishable/anon key in frontend env vars. Do not use the database password, service-role key, or secret keys in frontend code.

## Apply Database Schema

Use the Supabase SQL editor:

1. Open the Supabase project.
2. Go to SQL Editor.
3. Open `supabase/migrations/20260720000000_initial_cloud_storage.sql`.
4. Paste the full SQL into the editor.
5. Run it.

The migration creates:

- `profiles`
- `decks`
- `analyses`
- `graph_patches`
- `question_threads`
- `question_messages`
- `user_app_states`

It also enables row-level security and adds user-scoped CRUD policies.

## Auth Setup

In the Supabase dashboard:

1. Go to Authentication.
2. Confirm email sign-in is enabled.
3. Confirm magic-link/OTP email delivery is enabled.
4. Set the Site URL to the deployed app:

```txt
https://zachariascade.github.io/CardArchipelago/
```

5. Add hosted and local development URLs as allowed redirect URLs:

```txt
https://zachariascade.github.io/CardArchipelago/**
http://localhost:5173/**
http://127.0.0.1:5173/**
```

If Vite uses a different local port, add that URL too.

## Cloud Sync Smoke Test

After applying the schema and enabling auth:

1. Run `npm run dev`.
2. Sign in from the app header.
3. Click `Copy local data`.
4. Refresh the app.
5. Click `Load cloud data`.
6. Confirm decks, analyses, graph patches, and question threads restore.

## Hosted AI Function

The function source is at:

```txt
supabase/functions/analyze/index.ts
```

It expects these Supabase function secrets:

```txt
OPENAI_API_KEY=<openai-api-key>
OPENAI_MODEL=gpt-5
```

The deployed function URL should be:

```txt
https://yattqisxxkymbcnrpdbn.supabase.co/functions/v1/analyze
```

The app's `Hosted Supabase` provider mode calls this function through the Supabase client.
