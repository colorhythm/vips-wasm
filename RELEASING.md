# Releasing

`@colorhythm/vips-wasm` is built from source by this repository's CI. Up to
`0.0.19` it republished the upstream `wasm-vips` npm archive byte for byte;
from `0.0.19-colorhythm.1` it publishes its own build instead, because the
upstream archive needs `'unsafe-eval'`: its Embind glue builds every bound
method's invoker with `new Function` as the module initializes. This build
links with `-sEMBIND_AOT -sDYNAMIC_EXECUTION=0` (note 5 in `src/meson.build`),
so its JavaScript never evaluates a string and runs under a Content Security
Policy that allows `'wasm-unsafe-eval'` but not `'unsafe-eval'`.

## Versions

A build of upstream release `X.Y.Z` is published as `X.Y.Z-colorhythm.N`,
with `N` starting at 1 and incremented for each rebuild of the same upstream
source. `integrity.json` (schema 2) names that upstream source commit and pins
the size and SHA-256 of every file the package carries; `release:verify`
holds a package archive to it.

## Cutting a release

1. Commit the release (version in `package.json`) and push it to a branch.
   CI builds it in Docker and runs the tests on Linux, macOS and Windows. The
   unit tests run under `node --disallow-code-generation-from-strings`, which
   refuses `eval` and `Function` as such a policy does, and
   `npm run test:dynamic-code` scans `lib/`. The build job uploads the exact
   files as the `vips-wasm-build` artifact.
2. Review the artifact and pin each file's size and SHA-256 in
   `integrity.json`, at the same version. The build's cache key covers only
   `lib/`, `src/`, `build.sh` and the `Dockerfile`, so pinning does not
   trigger a rebuild on the branch.
3. Push `vips-wasm-v<version>`. A tag run cannot restore a branch's cache, so
   the tag CI builds from source again, and `release:prepare` refuses to
   package unless that build reproduces every pinned byte and contains no
   dynamic code. The release job then publishes under the `next` dist-tag
   with provenance, through npm trusted publishing (environment `npm`,
   workflow `ci.yml`), and creates the GitHub release.

## Promotion and rollback

After Tyto staging validates a version, promote it without repacking or
republishing:

```shell
npm dist-tag add @colorhythm/vips-wasm@0.0.19-colorhythm.1 latest
```

If a regression requires reversal, restore an earlier package. `0.0.19`,
`0.0.18` and `0.0.16` are verified republications of the upstream archives;
they need `'unsafe-eval'`:

```shell
npm dist-tag add @colorhythm/vips-wasm@0.0.19 latest
npm dist-tag add @colorhythm/vips-wasm@0.0.16 latest
```

Confirm the registry state after either command:

```shell
npm dist-tag ls @colorhythm/vips-wasm
```
