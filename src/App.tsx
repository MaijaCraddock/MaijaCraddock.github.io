import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react"
import renderMathInElement from "katex/contrib/auto-render"
import { startFeaturedCarousels } from "./featuredCarousels"
import { startPortfolioAnimation } from "./portfolioAnimation"
import aboutDocument from "./content/about.html?raw"
import homeDocument from "./content/index.html?raw"
import voronoiDocument from "./content/voronoi.html?raw"

function documentForPath(pathname: string) {
  if (pathname.endsWith("/about.html")) return aboutDocument
  if (pathname.endsWith("/voronoi.html")) return voronoiDocument
  return homeDocument
}

function getDocumentPart(document: string, tag: "body" | "title") {
  return (
    document.match(
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
    )?.[1] ?? ""
  )
}

type Theme = "light" | "dark"

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem("theme")
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme
  return "light"
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const pageDocument = documentForPath(window.location.pathname)
  const pageTitle = getDocumentPart(pageDocument, "title")
  const themeLabel = theme === "dark" ? "Day Mode" : "Night Mode"
  const pageBody = getDocumentPart(pageDocument, "body").replace(
    "</nav>",
    '<a class="github-link" href="https://github.com/MaijaCraddock" target="_blank" rel="noopener noreferrer">GitHub</a><button class="theme-toggle" type="button" aria-pressed="false">Night Mode</button></nav>',
  )

  // Keep the same object between renders. React 19 re-assigns innerHTML whenever
  // this prop is a new object, which wipes everything the page scripts built
  // (carousel controls, card fan, image offsets, open <details>) on every
  // theme toggle.
  const pageHtml = useMemo(() => ({ __html: pageBody }), [pageBody])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem("theme", theme)
    const toggle = document.querySelector<HTMLButtonElement>(".theme-toggle")
    if (toggle) {
      toggle.textContent = themeLabel
      toggle.setAttribute("aria-label", `Switch to ${themeLabel.toLowerCase()}`)
      toggle.setAttribute("aria-pressed", String(theme === "dark"))
    }
  }, [theme])

  useEffect(() => {
    document.title = pageTitle
    const page = document.getElementById("page-content")
    if (page) {
      renderMathInElement(page, {
        delimiters: [
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
      })
    }
  })

  useEffect(() => {
    if (window.location.pathname.endsWith("/about.html")) {
      const stopAnimation = startPortfolioAnimation()
      const stopCarousels = startFeaturedCarousels()
      return () => {
        stopAnimation?.()
        stopCarousels?.()
      }
    }
  }, [pageDocument])

  function handlePageClick(event: MouseEvent<HTMLDivElement>) {
    if (
      event.target instanceof Element &&
      event.target.closest(".theme-toggle")
    ) {
      setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))
    }
  }

  return (
    <div
      id="page-content"
      onClick={handlePageClick}
      dangerouslySetInnerHTML={pageHtml}
    />
  )
}
