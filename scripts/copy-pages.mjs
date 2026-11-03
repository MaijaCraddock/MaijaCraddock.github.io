// The site is one React app that picks its page from the URL, so the build only
// produces index.html. GitHub Pages needs a real file for every page the nav
// links to, so copy the built index.html to each one.
import { copyFileSync } from "node:fs"

for (const page of ["about", "voronoi"]) {
  copyFileSync("dist/index.html", `dist/${page}.html`)
}
