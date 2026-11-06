import { copyFileSync, mkdirSync } from "node:fs"

// 1. Create the .well-known directory inside your build folder (dist/)
// The { recursive: true } option ensures it won't crash if the folder already exists.
mkdirSync("dist/.well-known", { recursive: true })

// 2. Copy your local discord verification file into the dist folder
// Assumes you have a file named 'discord' (no extension) sitting in your root directory.
copyFileSync("discord", "dist/.well-known/discord")

// The site is one React app that picks its page from the URL, so the build only
// produces index.html. GitHub Pages needs a real file for every page the nav
// links to, so copy the built index.html to each one.
for (const page of ["about", "voronoi"]) {
  copyFileSync("dist/index.html", `dist/${page}.html`)
}

