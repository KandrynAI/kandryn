// Bundle the panel into the directory the manifest declares as a resource.
//
// Custom UI needs a bundler: `@forge/bridge` is an npm package, and under the
// default CSP every script and asset must be served from the SAME resource
// directory. So the bundle, the HTML entry point and the icon all land in
// static/panel/ together.
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const OUT = "static/panel";

await mkdir(OUT, { recursive: true });

await build({
  entryPoints: ["src/panel.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  outfile: `${OUT}/index.js`,
  logLevel: "info",
});

// Both are referenced by relative URL from the same directory — index.html by
// the resource's entry-point rule, icon.svg by the manifest's
// `resource:panel;icon.svg`.
await cp("src/index.html", `${OUT}/index.html`);
await cp("src/icon.svg", `${OUT}/icon.svg`);

console.log(`panel built into ${OUT}/`);
