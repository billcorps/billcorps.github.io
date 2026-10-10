# BillCorps

A small local React website displaying “🜗 Hello, This is BillCorps 🜉” in Source Serif 4, followed by two WebGL postprocessing passes: Ink Bleed, then Emerald Tablet. The effects are inspired by [Alembic Lab](https://lab.alembic.space/).

Emerald Tablet uses the image-processing version of the effect and [Alembic's marble lookup texture](https://lab.alembic.space/textures/256x256/Marble/marble3.png), served locally from `src/assets/emerald-marble.png`. The background uses gentler paper grain and 15% of the emerald effect's strength; the lettering keeps the full ink treatment. Both shaders are static and redraw when the page size changes.

The fonts are served locally. Noto Sans Symbols 2 provides the alchemical symbol because Source Serif 4 does not contain that glyph.

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To check the production build:

```sh
npm run build
npm run preview
```

## Customize

The greeting lives in `src/ShaderText.jsx`, and the linked sites live in `src/sites.js`. The GPU shader settings are exported at the top of `src/shaders.js`. The page styling lives in `src/index.css`.

## GitHub Pages

The production URL is [https://billcorps.github.io](https://billcorps.github.io/), using the organization-site repository [billcorps/billcorps.github.io](https://github.com/billcorps/billcorps.github.io). The local folder can remain named `BillCorps`.

`npm run build` creates the static website in `dist/`. Vite uses `/` as its asset base for the site's root URL, and `index.html` declares that URL as canonical. The deployment workflow verifies the destination repository before building.

The repository uses **GitHub Actions** as its Pages source. After pushing changes to `main`, manually run the **Deploy to GitHub Pages** workflow. The workflow only runs when requested; local development commands do not deploy. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The existing `app-ads.txt` and Planet Removal site are preserved in `public/`. Vite copies them unchanged into `dist/`, so they remain available at `/app-ads.txt` and `/planet-removal/`. The deployment workflow checks that both are copied exactly before publishing.

Keep `public/app-ads.txt` identical to `PourTallyWebsite/public/app-ads.txt`. Its publisher identifier is intentionally public. Add authorized sellers only from the actual ad network's supplied records.

## PourTally website move

The homepage links to [PourTally](https://billcorps.github.io/PourTallyWebsite/). Static redirects under `public/BarTallyWebsite/` preserve the former home, app, insights, and privacy links. The retired beta URL redirects to the new home page. JavaScript redirects preserve query strings and section anchors; HTML refresh and a visible link provide fallbacks. Keep these files in the Pages build for existing app installs and old bookmarks.
