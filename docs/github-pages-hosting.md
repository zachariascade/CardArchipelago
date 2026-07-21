# GitHub Pages Hosting

The app is prepared for GitHub Pages deployment through `.github/workflows/deploy-pages.yml`.

Expected Pages URL if the repository supports Pages:

```txt
https://zachariascade.github.io/CloudArchideckture/
```

## Current Blocker

The repository is currently private:

```txt
zachariascade/CloudArchideckture
```

GitHub returned this error when enabling Pages:

```txt
Your current plan does not support GitHub Pages for this repository.
```

Options:

- Make the repository public, then enable GitHub Pages with GitHub Actions as the source.
- Upgrade/use a GitHub plan that supports Pages for private repositories.
- Deploy the same static app to Vercel or Netlify instead.

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
https://zachariascade.github.io/CloudArchideckture/
```

Keep local development redirect URLs too:

```txt
http://localhost:5173
```
