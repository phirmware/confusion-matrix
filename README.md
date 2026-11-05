# NameMatch Lab

A vanilla HTML/JavaScript demo for calibrating KYC name matching. Adjust the approval
threshold and missing-word penalty, explore a live confusion matrix, and test custom
name pairs. Tailwind CSS and Chart.js load from CDNs; no framework or database is required.

## Run locally

Requires Node.js 20 or newer. There are no package dependencies to install.

```sh
npm start
```

Open <http://127.0.0.1:3000>. Local mode reads and appends to `dataset.json`.
If that file is missing, it is initialized from the synthetic demo examples.
Existing local cases are never overwritten by initialization or the public build.

## Preview the public demo

```sh
npm run build
npm run preview
```

Open <http://127.0.0.1:3000>. Stop any other server using that port first, or run
`PORT=3001 npm run preview`.

The public build uses **browser-only saves**:

- The 30 synthetic starter cases come from `demo-dataset.json`: 9 missing-middle,
  8 rearranged, 9 combined, and 4 different-identity cases. Examples include
  three- and four-part names, omitted one or two middle components, and varied token orders.
- Custom cases are stored in that visitor's browser using `localStorage`.
- Saves survive refreshes on the same origin, browser, and device. They do not sync
  across devices or visitors. Incognito mode or clearing site data may remove them.
- **Clear my saved cases** restores the starter dataset after confirmation.
- If storage is blocked, the examples and sandbox still work; saving is disabled
  with an explicit message. No server API or shared database is involved.
- Cases saved locally to `dataset.json` are **not included** in the public build.
  Add only reviewed, fictional examples to `demo-dataset.json` when updating the demo.

## Deploy to Vercel

The included `vercel.json` configures a static deployment:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | None |

### From a Git repository

1. Put this project in a GitHub, GitLab, or Bitbucket repository. The ignore files
   exclude the private local dataset, environment files, and generated output.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Use **Other** as the framework preset and keep the settings above.
4. Deploy. For an unrestricted demo link, check the project's **Deployment
   Protection** settings and ensure the deployment you share is publicly accessible.
5. Open the production URL in a private/incognito window to check access, then
   share that URL. Future pushes to the production branch trigger new deployments.

### From this folder, without Git

Using the Vercel CLI (requires a Vercel account):

```sh
npx vercel --prod
```

Follow the login/project prompts. The CLI installs on demand if necessary.
`.vercelignore` prevents the private local dataset and local server from being
uploaded. Only the four generated static assets in `dist` are served.

## Validate

```sh
npm test
npm run build
```

Automated tests cover scoring regressions, local JSON persistence, validation,
concurrent local saves, browser-storage data handling, and static output isolation.

## Demo limits

Name similarity is not identity verification. Ground truth in the examples is
independently assigned, not inferred from the score. Scores use deterministic
greedy one-to-one Jaro-Winkler token alignment and a configurable token-count penalty.
The prototype has no authentication or production KYC controls. Use fictional names
only. An internet connection is required to load the CSS and chart libraries; names
typed into the public sandbox are processed locally and are not submitted to an API.
