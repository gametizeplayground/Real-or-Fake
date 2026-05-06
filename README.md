# Real or Fake

A mobile-first Phaser swipe mini-game for quickly judging whether content is REAL or FAKE.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

The deployable static site is generated in `dist/`.

## GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.

To publish correctly:

1. Upload or commit the source files to the `main` branch.
2. Go to the repository settings.
3. Open `Pages`.
4. Set `Build and deployment` to `GitHub Actions`.
5. Push to `main` or run the workflow manually.

Do not use the raw repository root as the Pages site source. GitHub Pages must serve the built `dist/` output.
