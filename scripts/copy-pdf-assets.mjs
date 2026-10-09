import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/pdfjs", { recursive: true });
cpSync(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdfjs/pdf.worker.min.mjs",
);
for (const name of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(`node_modules/pdfjs-dist/${name}`, `public/pdfjs/${name}`, {
    recursive: true,
  });
}
