type DistanceMode = 0 | 1 | 2

interface VoronoiSimulation {
  done: boolean
  theme: number
  reset(sites: Array<[number, number]>, distance: DistanceMode): void
  advance(): boolean
  startClear(): boolean
  draw(): void
}

type VoronoiConstructor = new (
  canvas: HTMLCanvasElement,
  options: { rows: number; cols: number; cellPx: number },
) => VoronoiSimulation

declare global {
  interface Window {
    VoronoiCA?: VoronoiConstructor
  }
}

const slides = [
  { title: "Maija Builds Systems…", copy: "" },
  { title: "Algorithms", copy: "" },
  { title: "Games", copy: "" },
  {
    title: "Maija Craddock",
    copy: `<p>Hello! I am a recent Computer Science Master's graduate from the University of Tennessee with a foundation in Systems Programming, Algorithms, and Computer Graphics.</p>
      <p>My languages of choice are typically:<br>C++, C#, C, and Python.</p>`,
  },
]

const distanceNames = ["Manhattan", "Chebyshev", "Euclidean"]
// Site positions are [row, col] on the original 32 x 72 grid; they are scaled
// to whatever grid the hero's shape calls for.
const BASE_ROWS = 32
const BASE_COLS = 72
const baseSites: Array<[number, number]> = [
  [7, 10],
  [9, 55],
  [16, 36],
  [24, 18],
  [23, 61],
]

// Keep roughly the original cell count, but match the hero's aspect ratio so
// cells stay square no matter how tall or wide the hero is.
function gridFor(hero: HTMLElement) {
  const aspect = Math.max(0.3, hero.clientWidth / Math.max(1, hero.clientHeight))
  const cols = Math.max(24, Math.round(Math.sqrt(BASE_ROWS * BASE_COLS * aspect)))
  const rows = Math.max(12, Math.round(cols / aspect))
  return { rows, cols }
}

let scriptPromise: Promise<void> | undefined

function loadVoronoiShader() {
  if (window.VoronoiCA) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "/voronoi-ca.js"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Unable to load the Voronoi shader"))
    document.head.append(script)
  })

  return scriptPromise
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve))
}

export function startPortfolioAnimation() {
  const hero = document.querySelector<HTMLElement>(".portfolio-hero")
  const canvas = hero?.querySelector<HTMLCanvasElement>(".portfolio-voronoi")
  const title = hero?.querySelector<HTMLElement>(".portfolio-title")
  const copy = hero?.querySelector<HTMLElement>(".portfolio-copy")
  const metric = hero?.querySelector<HTMLElement>(".portfolio-metric")
  if (!hero || !canvas || !title || !copy || !metric) return

  let cancelled = false
  let themeObserver: MutationObserver | undefined

  const renderSlide = (index: number) => {
    title.textContent = slides[index].title
    copy.innerHTML = slides[index].copy
  }

  const animateUntilDone = async (simulation: VoronoiSimulation) => {
    while (!cancelled && !simulation.done) {
      simulation.advance()
      await wait(28)
    }
  }

  const run = async () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      renderSlide(slides.length - 1)
      hero.classList.add("is-static")
      return
    }

    renderSlide(0)
    await loadVoronoiShader()
    if (cancelled || !window.VoronoiCA) return

    const { rows, cols } = gridFor(hero)
    const sites = baseSites.map(
      ([row, col]): [number, number] => [
        Math.min(rows - 1, Math.round((row * rows) / BASE_ROWS)),
        Math.min(cols - 1, Math.round((col * cols) / BASE_COLS)),
      ],
    )
    const simulation = new window.VoronoiCA(canvas, {
      rows,
      cols,
      cellPx: 8,
    })
    const syncShaderTheme = () => {
      simulation.theme =
        document.documentElement.dataset.theme === "dark" ? 2 : 1
      simulation.draw()
    }
    syncShaderTheme()
    themeObserver = new MutationObserver(syncShaderTheme)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    })

    for (let transition = 0; transition < distanceNames.length; transition++) {
      if (cancelled) return
      metric.textContent = `${distanceNames[transition]} distance`
      hero.dataset.distance = distanceNames[transition].toLowerCase()
      simulation.reset(sites, transition as DistanceMode)
      await animateUntilDone(simulation)
      await wait(450)
      if (cancelled) return

      hero.classList.add("is-changing")
      await wait(320)
      if (cancelled) return

      hero.classList.add("is-entering")
      renderSlide(transition + 1)
      hero.classList.remove("is-changing")
      await nextFrame()
      hero.classList.remove("is-entering")

      simulation.startClear()
      await animateUntilDone(simulation)
      await wait(850)
    }

    hero.removeAttribute("data-distance")
    metric.textContent = ""
    hero.classList.add("is-complete")
  }

  void run().catch(() => {
    if (!cancelled) {
      renderSlide(slides.length - 1)
      hero.classList.add("is-static")
    }
  })

  return () => {
    cancelled = true
    themeObserver?.disconnect()
  }
}