// Production build for HelloWorld.html (Phase 11C, Step 8).
//
// This creates a separate generated client and does not overwrite the
// readable source. Building/minifying is not a functional test; run the
// generated file in a browser/WebView before treating it as equivalent.
//
// WHAT THIS DOES:
//   1. Reads the development HelloWorld.html (readable, commented —
//      never overwritten by this script).
//   2. Extracts each inline <script> block.
//   3. Minifies each block with Terser (variable/function names,
//      whitespace, comments stripped — including the extensive
//      "confirmed root cause" investigation comments throughout this
//      file, which are useful for you but also hand a reverse-engineer
//      a annotated history of every bug this app ever had).
//   4. Writes a SEPARATE dist/HelloWorld.html with the minified script
//      content spliced back into the original HTML structure, plus a
//      base URL so its relative Cesium assets still resolve from dist.
//   5. Never touches the original source file.
//
// HONEST SCOPE (per project rules): minification raises the effort
// required to read this code. It does NOT make it unreadable — modern
// de-obfuscation/pretty-printing tools handle minified JS easily. It
// does not hide network requests, API endpoints, or app behavior
// visible via a proxy (e.g. mitmproxy/Charles) regardless of
// minification. Treat this as "reduces casual copying," not "secures
// the client."
//
// SETUP:
//   cd backend        (or wherever you keep this script + package.json)
//   npm install --save-dev terser
//   node build/minify-helloworld.js
//
// Then manually verify dist/HelloWorld.html:
//   - loads without a blank screen / console errors
//   - search still works
//   - a route still calculates and draws
//   - TTS still speaks
//   - taxis/OSM/resource markers still appear
// before using it as the shipped asset instead of the source file.

const fs = require("fs");
const path = require("path");

const SOURCE_PATH = process.env.HELLOWORLD_SOURCE_PATH || "../../assets/cesium/Apps/HelloWorld.html";
const OUTPUT_DIR = process.env.HELLOWORLD_BUILD_OUTPUT_DIR || "../dist";
const OUTPUT_PATH = path.join(OUTPUT_DIR, "HelloWorld.html");

async function main() {
  let terserMinify;
  try {
    ({ minify: terserMinify } = require("terser"));
  } catch (e) {
    console.error(
      "terser is not installed. Run `npm install --save-dev terser` first, " +
      "then re-run this script. (This is expected the first time — " +
      "terser is a devDependency, not part of the runtime server.)"
    );
    process.exit(1);
  }

  const sourcePath = path.resolve(__dirname, SOURCE_PATH);
  const outputPath = path.resolve(__dirname, OUTPUT_PATH);
  const sourceHtml = fs.readFileSync(sourcePath, "utf8");

  const scriptBlockRegex = /<script>([\s\S]*?)<\/script>/g;
  let match;
  let matchIndex = 0;
  const replacements = [];

  while ((match = scriptBlockRegex.exec(sourceHtml)) !== null) {
    const originalBlock = match[0];
    const jsContent = match[1];
    matchIndex++;

    const result = await terserMinify(jsContent, {
      compress: {
        // Conservative settings — this file uses top-level `const`/
        // `let` and relies on execution order for GPS/route/OSM state;
        // aggressive dead-code elimination or reordering could break
        // behavior that isn't obviously "used" from a static analysis
        // pass (e.g. window.updateUserMarker, called only from the
        // Flutter side, never from JS itself — a naive minifier could
        // mistake it for dead code without `keep_fnames`/careful config).
        sequences: true,
        dead_code: false,
        unused: false,
      },
      mangle: false, // keep names readable in case of a production error report — trade a little size for debuggability
      format: { comments: false },
    });

    if (result.error) {
      throw new Error(`Terser failed on script block #${matchIndex}: ${result.error}`);
    }

    replacements.push({ originalBlock, minified: `<script>${result.code}</script>` });
  }

  let outputHtml = sourceHtml;
  for (const { originalBlock, minified } of replacements) {
    outputHtml = outputHtml.replace(originalBlock, minified);
  }

  const sourceAssetDirectory = path
    .relative(path.dirname(outputPath), path.dirname(sourcePath))
    .split(path.sep)
    .join("/");
  const assetBaseHref = sourceAssetDirectory
    ? `${sourceAssetDirectory}/`
    : "./";
  const headTag = outputHtml.match(/<head\b[^>]*>/i);
  if (!headTag) {
    throw new Error("Unable to add the generated client's asset base URL: <head> is missing.");
  }
  if (!/<base\b/i.test(headTag[0])) {
    const escapedBaseHref = assetBaseHref
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
    outputHtml = outputHtml.replace(
      headTag[0],
      `${headTag[0]}\n<base href="${escapedBaseHref}">`
    );
  }

  fs.mkdirSync(path.resolve(__dirname, OUTPUT_DIR), { recursive: true });
  fs.writeFileSync(outputPath, outputHtml, "utf8");

  const originalSize = Buffer.byteLength(sourceHtml, "utf8");
  const outputSize = Buffer.byteLength(outputHtml, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Original: ${(originalSize / 1024).toFixed(1)} KB -> Minified: ${(outputSize / 1024).toFixed(1)} KB`);
  console.log("NOT FUNCTIONALLY TESTED BY THIS SCRIPT — manually verify in a real WebView before shipping.");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});