/**
 * Image carousels for the featured-work section of about.html.
 *
 * The page HTML is injected with dangerouslySetInnerHTML, so inline <script>
 * tags never run. Instead the markup carries data attributes and this module
 * wires it up after render:
 *
 *   data-carousel="stack"    one image at a time, wraps at both ends
 *   data-carousel="aligned"  same, but every image is shifted so the brown
 *                            banner inside each one lands in the same place
 *   data-carousel="hand"     shuffled card list shown as a fanned 5-card
 *                            window that slides along the list and wraps
 */

const HAND_SIZE = 5 // cards visible in the fan
const HAND_STEP = 1 // cards the window moves per click
const SAMPLE_WIDTH = 240 // px width used when scanning an image for its banner
const FIT_MIN_REM = 1 // smallest font size the text fit will use
const FIT_MAX_REM = 3 // largest font size the text fit will use
const STACKED_QUERY = "(max-width: 40rem)" // layout where media sits above text

type Teardown = () => void

interface Band {
  top: number // banner top, as a fraction of image height
  bottom: number // banner bottom, as a fraction of image height
  aspect: number // image height / image width
}

function wrap(index: number, length: number) {
  return ((index % length) + length) % length
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function createControls(
  label: string,
  onStep: (direction: -1 | 1) => void,
  showCount: boolean,
) {
  const element = document.createElement("div")
  element.className = "carousel-controls"

  const makeButton = (text: string, name: string, direction: -1 | 1) => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "carousel-btn"
    button.textContent = text
    button.setAttribute("aria-label", `${name} ${label}`)
    button.addEventListener("click", () => onStep(direction))
    return button
  }

  const count = document.createElement("span")
  count.className = "carousel-count"
  count.setAttribute("aria-live", "polite")

  element.append(makeButton("‹", "Previous", -1))
  if (showCount) element.append(count)
  element.append(makeButton("›", "Next", 1))

  return { element, count }
}

function whenLoaded(img: HTMLImageElement) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true })
    img.addEventListener("error", () => resolve(), { once: true })
  })
}

/**
 * Finds the brown banner in a predator image: the dominant opaque, non-white
 * colour in the right half (where only the banner and its text live), then the
 * first and last rows that contain it.
 */
function measureBand(img: HTMLImageElement): Band | undefined {
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) return undefined

  const cw = SAMPLE_WIDTH
  const ch = Math.max(1, Math.round((cw * height) / width))
  const canvas = document.createElement("canvas")
  canvas.width = cw
  canvas.height = ch
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return undefined

  let data: Uint8ClampedArray
  try {
    context.drawImage(img, 0, 0, cw, ch)
    data = context.getImageData(0, 0, cw, ch).data
  } catch {
    return undefined
  }

  const x0 = Math.floor(cw * 0.55)
  const x1 = Math.floor(cw * 0.99)

  const counts = new Map<number, number>()
  for (let y = 0; y < ch; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * cw + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      if (data[i + 3] < 200) continue
      if (r > 235 && g > 235 && b > 235) continue
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  let bestKey = -1
  let bestCount = 0
  counts.forEach((count, key) => {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  })
  if (bestKey < 0) return undefined

  const refR = ((bestKey >> 8) & 15) * 16 + 8
  const refG = ((bestKey >> 4) & 15) * 16 + 8
  const refB = (bestKey & 15) * 16 + 8

  let top = -1
  let bottom = -1
  for (let y = 0; y < ch; y++) {
    let matches = 0
    for (let x = x0; x < x1; x++) {
      const i = (y * cw + x) * 4
      if (data[i + 3] < 200) continue
      const dr = data[i] - refR
      const dg = data[i + 1] - refG
      const db = data[i + 2] - refB
      if (dr * dr + dg * dg + db * db < 1600) matches++
    }
    if (matches >= 4) {
      if (top < 0) top = y
      bottom = y
    }
  }
  if (top < 0) return undefined

  return { top: top / ch, bottom: (bottom + 1) / ch, aspect: height / width }
}

/**
 * Lines every image up on its banner. Work in units of image width so the
 * result stays correct at any display size: the stage gets an aspect ratio
 * tall enough for the image with the most overhang above and below, and each
 * image is pushed down by however much less overhang it has than that one.
 */
async function alignBands(
  stage: HTMLElement,
  images: HTMLImageElement[],
  isCancelled: () => boolean,
) {
  await Promise.all(images.map(whenLoaded))
  if (isCancelled()) return

  const bands = images
    .map(measureBand)
    .filter((band): band is Band => band !== undefined)
  if (bands.length !== images.length) return

  const above = bands.map((band) => band.top * band.aspect)
  const maxAbove = Math.max(...above)
  const maxBelow = Math.max(...bands.map((band, i) => band.aspect - above[i]))
  const total = maxAbove + maxBelow

  stage.style.setProperty("--ratio", `1 / ${total}`)
  images.forEach((img, i) => {
    img.style.top = `${((maxAbove - above[i]) / total) * 100}%`
  })
}

function setupSlides(
  host: HTMLElement,
  align: boolean,
  isCancelled: () => boolean,
): Teardown {
  const stage = host.querySelector<HTMLElement>(".carousel-stage")
  const images = stage
    ? Array.from(stage.querySelectorAll<HTMLImageElement>(":scope > img"))
    : []
  if (!stage || images.length === 0) return () => {}

  let index = 0
  const controls =
    images.length > 1
      ? createControls(
          "image",
          (direction) => {
            index = wrap(index + direction, images.length)
            show()
          },
          true,
        )
      : undefined

  function show() {
    images.forEach((img, i) => img.classList.toggle("is-active", i === index))
    if (controls) controls.count.textContent = `${index + 1} / ${images.length}`
  }

  if (controls) host.append(controls.element)
  host.classList.add("is-ready")
  show()
  if (align) void alignBands(stage, images, isCancelled)

  return () => {
    controls?.element.remove()
    host.classList.remove("is-ready")
    stage.style.removeProperty("--ratio")
    images.forEach((img) => {
      img.classList.remove("is-active")
      img.style.removeProperty("top")
    })
  }
}

function cardLabel(file: string) {
  return file
    .replace(/\.[^.]+$/, "")
    .replace(/^FHCard/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
}

function setupHand(host: HTMLElement): Teardown {
  const stage = host.querySelector<HTMLElement>(".hand-stage")
  const files = (host.dataset.cards ?? "")
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean)
  const base = host.dataset.base ?? "/images/"
  if (!stage || files.length === 0) return () => {}

  const order = shuffle(files)
  const visible = Math.min(HAND_SIZE, order.length)
  let start = 0

  // Warm the cache so sliding the window doesn't flash.
  order.forEach((file) => {
    new Image().src = base + file
  })

  const cards = Array.from({ length: visible }, (_, k) => {
    const img = document.createElement("img")
    img.className = "hand-card"
    img.decoding = "async"
    img.style.setProperty("--i", String(k - (visible - 1) / 2))
    stage.append(img)
    return img
  })

  const render = () => {
    cards.forEach((img, k) => {
      const file = order[wrap(start + k, order.length)]
      img.src = base + file
      img.alt = `${cardLabel(file)} card`
    })
  }

  const controls =
    order.length > visible
      ? createControls(
          "cards",
          (direction) => {
            start = wrap(start + direction * HAND_STEP, order.length)
            render()
          },
          false,
        )
      : undefined

  if (controls) host.append(controls.element)
  host.classList.add("is-ready")
  render()

  return () => {
    controls?.element.remove()
    host.classList.remove("is-ready")
    cards.forEach((img) => img.remove())
  }
}

/**
 * Makes each section's text as tall as its media: finds the largest font size
 * at which the paragraphs still fit beside the images. CSS then spreads the
 * paragraphs out (space-between) to use up whatever slack is left, so the text
 * runs from the top of the media to the bottom.
 */
function fitSection(section: HTMLElement) {
  const media = section.querySelector<HTMLElement>(":scope > .side-column")
  const text = section.querySelector<HTMLElement>(":scope > .side-text")
  if (!media || !text) return

  if (window.matchMedia(STACKED_QUERY).matches) {
    section.style.removeProperty("--fit-size")
    return
  }

  const target = media.getBoundingClientRect().height
  if (target < 100) return // collapsed (closed details) or still loading

  const blocks = Array.from(text.children)
  const gap = parseFloat(getComputedStyle(text).rowGap) || 0
  const natural = () =>
    blocks.reduce((sum, block) => sum + block.getBoundingClientRect().height, 0) +
    gap * Math.max(0, blocks.length - 1)
  const apply = (rem: number) => section.style.setProperty("--fit-size", `${rem}rem`)

  apply(FIT_MAX_REM)
  if (natural() <= target) return

  let low = FIT_MIN_REM
  let high = FIT_MAX_REM
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2
    apply(mid)
    if (natural() <= target) low = mid
    else high = mid
  }
  apply(low)
}

function setupTextFit(isCancelled: () => boolean): Teardown {
  const sections = Array.from(
    document.querySelectorAll<HTMLElement>("#page-content .project-section--media"),
  )
  if (sections.length === 0) return () => {}

  let frame = 0
  const refit = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!isCancelled()) sections.forEach(fitSection)
    })
  }

  // Media height changes as images load, and section width changes on resize.
  const observer = new ResizeObserver(refit)
  sections.forEach((section) => {
    observer.observe(section)
    const media = section.querySelector<HTMLElement>(":scope > .side-column")
    if (media) observer.observe(media)
  })

  const details = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("#page-content details"),
  )
  details.forEach((item) => item.addEventListener("toggle", refit))

  // Text metrics change once the web fonts arrive.
  void document.fonts?.ready.then(refit)
  document.fonts?.addEventListener("loadingdone", refit)

  refit()

  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    details.forEach((item) => item.removeEventListener("toggle", refit))
    document.fonts?.removeEventListener("loadingdone", refit)
    sections.forEach((section) => section.style.removeProperty("--fit-size"))
  }
}

export function startFeaturedCarousels(): Teardown | undefined {
  const hosts = document.querySelectorAll<HTMLElement>(
    "#page-content [data-carousel]",
  )

  let cancelled = false
  const isCancelled = () => cancelled
  const teardowns: Teardown[] = []

  hosts.forEach((host) => {
    switch (host.dataset.carousel) {
      case "hand":
        teardowns.push(setupHand(host))
        break
      case "aligned":
        teardowns.push(setupSlides(host, true, isCancelled))
        break
      default:
        teardowns.push(setupSlides(host, false, isCancelled))
    }
  })
  teardowns.push(setupTextFit(isCancelled))

  return () => {
    cancelled = true
    teardowns.forEach((teardown) => teardown())
  }
}