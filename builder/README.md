# PIVOT builder

This repository builds live previews for [PIVOT](https://github.com/PTan2505/pivot): the components and designs you
save there. PIVOT starts each build itself on GitHub Actions; you don't run anything here.

- **Keep this repository private.** A run's inputs and logs name the job it built.
- Each run reads one job from your R2 bucket through a link that expires after an hour, installs the job's npm
  packages from registry.npmjs.org with install scripts off, bundles the page and writes it back to R2. It holds no R2
  keys and no tokens.
- `pivot-studio builder setup --repo <owner>/<name>` wrote these files; run it again after updating PIVOT.

`build.mjs` is generated from PIVOT's source (`packages/core/src/builder-main.ts`); don't edit it here.
