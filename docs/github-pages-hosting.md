# GitHub Pages Hosting

The app is prepared for GitHub Pages deployment through `.github/workflows/deploy-pages.yml`.

Expected Pages URL if the repository supports Pages:

```txt
https://zachariascade.github.io/CardArchipelago/
```

## Current Status

The repository is public:

```txt
zachariascade/CardArchipelago
```

GitHub Pages is enabled with GitHub Actions as the deployment source.

## Repository Variables

These GitHub repository variables have been set for the Pages workflow:

```txt
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_ANALYSIS_ENDPOINT
```

## Supabase Auth Redirects

If GitHub Pages is enabled, add this URL to Supabase Auth redirect URLs:

```txt
https://zachariascade.github.io/CardArchipelago/
```

Also set the Supabase Auth Site URL to:

```txt
https://zachariascade.github.io/CardArchipelago/
```

Keep local development redirect URLs too:

```txt
http://localhost:5173/**
http://127.0.0.1:5173/**
```
