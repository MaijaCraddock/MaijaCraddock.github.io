import { copyFileSync, mkdirSync } from "node:fs"

// 1. Create the .well-known directory inside your build folder (dist/)
// The { recursive: true } option ensures it won't crash if the folder already exists.
mkdirSync("dist/.well-known", { recursive: true })

// 2. Copy your local discord verification file into the dist folder
// Assumes you have a file named 'discord' (no extension) sitting in your root directory.
copyFileSync("discord", "dist/.well-known/discord")

// Your existing page copying logic
for (const page of ["about", "voronoi"]) {
  copyFileSync("dist/index.html", `dist/${page}.html`)
}