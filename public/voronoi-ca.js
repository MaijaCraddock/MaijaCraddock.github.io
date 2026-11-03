/*
 * voronoi_ca.js — WebGL2 port of vorca.py (Voronoi as a cellular automaton).
 *
 * State lives in a ping-pong RGBA8 texture; the cell value (0..255) is stored in R.
 *   0 = empty, 5 = edge, 10 = vertex, 15 = site marker, 20+ = face id (one per site)
 * texel (x = column, y = row)  <->  cells[row, col] in the python version.
 *
 * One call to advance() == one iteration of the python `for t in range(...)` loop.
 * The frame shown is always the python `old_cells` for that iteration (progression[i]).
 */

const VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
// Step shader: get_manhattan_cell / get_chebyshev_cell / get_euclidean_cell
// ---------------------------------------------------------------------------
const STEP_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform ivec2 uSize;   // (cols, rows)
uniform int uMode;     // 0 manhattan, 1 chebyshev, 2 euclidean
uniform int uStep;     // python's t
uniform int uStalled;  // 1 once a whole step filled nothing (set from the CPU empty count)
out vec4 outColor;

const int EMPTY = 0;
const int EDGE  = 5;
const int VERT  = 10;
const int COLOR_PADDING = 20;

int cellAt(int r, int c) {
  return int(texelFetch(uState, ivec2(c, r), 0).r * 255.0 + 0.5);
}

// moore=false -> von Neumann (4 neighbours), moore=true -> Moore (8 neighbours)
// kind: 0 manhattan, 1 chebyshev, 2 euclidean
int updateCell(int r, int c, bool moore, int kind) {
  int ids[8];
  int cnt[8];
  for (int k = 0; k < 8; k++) { ids[k] = 0; cnt[k] = 0; }
  int nd = 0;          // number of distinct neighbouring sites
  int edgeN = 0;       // edge neighbours
  int emptyN = 0;      // still-empty neighbours
  int nNeighbors = 0;  // in-bounds neighbours (len(neighbors) in python)

  for (int dr = -1; dr <= 1; dr++) {
    for (int dc = -1; dc <= 1; dc++) {
      if (dr == 0 && dc == 0) continue;
      if (!moore && dr != 0 && dc != 0) continue;
      int rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= uSize.y || cc < 0 || cc >= uSize.x) continue;
      nNeighbors++;
      int v = cellAt(rr, cc);
      if (v == EDGE) {
        edgeN++;
      } else if (v >= COLOR_PADDING) {
        bool found = false;
        for (int k = 0; k < 8; k++) {
          if (k >= nd) break;
          if (ids[k] == v) { cnt[k]++; found = true; break; }
        }
        if (!found) { ids[nd] = v; cnt[nd] = 1; nd++; }
      } else if (v == EMPTY) {
        emptyN++;
      }
    }
  }

  if (kind == 0) {                       // ---- manhattan
    if (edgeN >= 2) return VERT;
    if (nd == 2) return EDGE;
    if (nd == 0) return EMPTY;
    if (nd == 1) return ids[0];
    return VERT;
  }
  if (kind == 1) {                       // ---- chebyshev
    if (edgeN >= 3) return VERT;
    if (nd == 2) return EDGE;
    if (nd == 0) return EMPTY;
    if (nd == 1) return ids[0];
    return VERT;
  }
  // ---------------------------------- euclidean
  if (edgeN >= 3) return VERT;
  if ((emptyN == 0 || uStalled == 1) && nd <= 2) {   // no more progress possible: force a decision
    if (nd == 0) return emptyN == 0 ? EDGE : EMPTY;    // wait for a neighbour to fill first
    if (nd == 1) return ids[0];
    return cnt[0] == cnt[1] ? EDGE : (cnt[0] > cnt[1] ? ids[0] : ids[1]);
  }
  if (nd == 2) {
    // drop sites with too few neighbours (border-cell fix from the python code)
    float thr = 3.0 - float(8 - nNeighbors) / 2.0;
    int keep = 0, last = 0;
    for (int k = 0; k < 2; k++) {
      if (float(cnt[k]) >= thr) { keep++; last = ids[k]; }
    }
    if (keep == 1) return last;
    if (keep == 2) return EDGE;
    return EMPTY;
  }
  if (nd == 1) return (cnt[0] + edgeN >= 3) ? ids[0] : EMPTY;
  if (nd == 0) return EMPTY;
  return VERT;
}

void main() {
  int r = int(gl_FragCoord.y);
  int c = int(gl_FragCoord.x);
  int v = cellAt(r, c);
  if (v == EMPTY) {
    if (uMode == 0)      v = updateCell(r, c, false, 0);
    else if (uMode == 1) v = updateCell(r, c, true, 1);
    else if (uStep == 0) v = updateCell(r, c, true, 1);   // euclidean seeds with chebyshev on t == 0
    else                 v = updateCell(r, c, true, 2);
  }
  outColor = vec4(float(v) / 255.0, 0.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
// Clear shader: the fill rules run again from ONE static centre site, but claimed
// cells are ERASED (value 1 = cleared, drawn as empty) instead of coloured.
//   manhattan: 4-neighbour flood (diamond)   chebyshev: 8-neighbour flood (square)
//   euclidean: chebyshev on step 0, then >= 3 cleared neighbours (disc), same as the fill rule
// ---------------------------------------------------------------------------
const CLEAR_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform ivec2 uSize;   // (cols, rows)
uniform int uMode;     // 0 manhattan, 1 chebyshev, 2 euclidean
uniform int uStep;     // clear step counter
uniform int uStalled;  // 1 once a whole step cleared nothing
out vec4 outColor;

int cellAt(int r, int c) {
  return int(texelFetch(uState, ivec2(c, r), 0).r * 255.0 + 0.5);
}

void main() {
  int r = int(gl_FragCoord.y);
  int c = int(gl_FragCoord.x);
  int v = cellAt(r, c);
  if (v != 1) {
    bool moore = uMode != 0;
    int n = 0;
    for (int dr = -1; dr <= 1; dr++) {
      for (int dc = -1; dc <= 1; dc++) {
        if (dr == 0 && dc == 0) continue;
        if (!moore && dr != 0 && dc != 0) continue;
        int rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= uSize.y || cc < 0 || cc >= uSize.x) continue;
        if (cellAt(rr, cc) == 1) n++;
      }
    }
    bool take = (uMode == 2 && uStep > 0) ? (n >= 3 || (uStalled == 1 && n >= 1)) : (n >= 1);
    if (take) v = 1;
  }
  outColor = vec4(float(v) / 255.0, 0.0, 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------
// Display shader: matshow + LinearSegmentedColormap(black, blue, red, yellow, green, white; N=256)
// ---------------------------------------------------------------------------
const DRAW_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform ivec2 uSize;   // (cols, rows)
uniform vec2 uRes;     // canvas pixels
uniform float uVmax;
uniform int uTheme;    // 0 original (matplotlib), 1 day, 2 night
out vec4 outColor;

vec3 hsl2rgb(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * clamp(min(k - 3.0, 9.0 - k), -1.0, 1.0);
}

// Themed palette: fixed colours for empty/edge/vertex/site; faces cycle through a palette by id.
vec3 themed(float v) {
  bool night = uTheme == 2;
  if (v < 0.5)  return night ? vec3(0.02, 0.03, 0.07) : vec3(0.922, 0.761, 0.478);  // empty: sand (day)
  if (v < 7.5)  return night ? vec3(0.55, 0.85, 1.00) : vec3(0.118, 0.141, 0.200);  // edge: ink (day)
  if (v < 12.5) return night ? vec3(1.00, 1.00, 1.00) : vec3(0.118, 0.141, 0.200);  // vertex
  if (v < 17.5) return night ? vec3(1.00, 0.85, 0.35) : vec3(1.000, 0.953, 0.839);  // site
  float k = v - 20.0;
  if (night) {
    float g = fract(k * 0.618034);
    return hsl2rgb(mix(0.50, 0.80, g), 0.50, 0.20 + 0.04 * mod(k, 3.0));
  }
  // day: muted teal, terracotta, sage, slate blue, plum
  vec3 pal[5] = vec3[5](
    vec3(0.180, 0.490, 0.502), vec3(0.824, 0.404, 0.290), vec3(0.525, 0.655, 0.533),
    vec3(0.243, 0.361, 0.541), vec3(0.541, 0.353, 0.514));
  return pal[int(mod(k, 5.0))];
}

vec3 cmap(float v) {
  float t = clamp(v / uVmax, 0.0, 1.0);
  float idx = min(floor(t * 256.0), 255.0);   // matplotlib quantises to N=256 entries
  float x = idx / 255.0 * 5.0;
  int seg = int(min(floor(x), 4.0));
  float f = x - float(seg);
  vec3 stops[6] = vec3[6](
    vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0),
    vec3(1.0, 1.0, 0.0), vec3(0.0, 0.5, 0.0), vec3(1.0));
  return mix(stops[seg], stops[seg + 1], f);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  int c = min(int(uv.x * float(uSize.x)), uSize.x - 1);
  int r = min(int((1.0 - uv.y) * float(uSize.y)), uSize.y - 1);   // row 0 at top, like matshow
  float v = floor(texelFetch(uState, ivec2(c, r), 0).r * 255.0 + 0.5);
  if (v == 1.0) v = 0.0;   // cleared cells look empty
  outColor = vec4(uTheme == 0 ? cmap(v) : themed(v), 1.0);
}`;

// ---------------------------------------------------------------------------
class VoronoiCA {
  static DISTANCE = { MANHATTAN: 0, CHEBYSHEV: 1, EUCLIDEAN: 2 };
  static EMPTY = 0; static EDGE = 5; static VERT = 10; static SITE = 15; static FACE0 = 20;

  constructor(canvas, { rows = 100, cols = 100, cellPx = 6 } = {}) {
    this.canvas = canvas;
    this.theme = 0;   // 0 original, 1 day, 2 night
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.stepProg = this._program(STEP_FS);
    this.drawProg = this._program(DRAW_FS);
    this.clearProg = this._program(CLEAR_FS);
    this.phase = 'fill';
    this.resize(rows, cols, cellPx);
  }

  _program(fsSrc) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  resize(rows, cols, cellPx = 6) {
    const gl = this.gl;
    this.rows = rows; this.cols = cols;
    this.maxSteps = Math.max(rows, cols) * 4;   // python uses max(width, height); extra room for stall resolution
    this.canvas.width = cols * cellPx;
    this.canvas.height = rows * cellPx;
    (this.tex || []).forEach(t => gl.deleteTexture(t));
    (this.fbo || []).forEach(f => gl.deleteFramebuffer(f));
    this.tex = []; this.fbo = [];
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
        gl.texParameteri(gl.TEXTURE_2D, k, v);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      this.tex.push(t); this.fbo.push(f);
    }
  }

  /** sites: array of [row, col]; ids are assigned 20, 21, ... in array order. */
  reset(sites, distance = VoronoiCA.DISTANCE.EUCLIDEAN) {
    const gl = this.gl;
    this.sites = sites;
    this.distance = distance;
    this.vmax = 4 + sites.length + 20;          // num_color + colorPadding
    this.cur = 0; this.frame = 0;
    this.prevEmpty = -1; this.stalled = false;
    this.phase = 'fill'; this.clearStep = 0;

    const data = new Uint8Array(this.rows * this.cols * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    sites.forEach(([r, c], i) => { data[(r * this.cols + c) * 4] = VoronoiCA.FACE0 + i; });
    gl.bindTexture(gl.TEXTURE_2D, this.tex[0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this._refresh();
    this.draw();
  }

  _refresh() {
    const gl = this.gl;
    const buf = new Uint8Array(this.rows * this.cols * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.cur]);
    gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let empty = 0;
    const clearing = this.phase === 'clear';   // clear phase counts cells not yet cleared
    for (let i = 0; i < buf.length; i += 4) if (clearing ? buf[i] !== 1 : buf[i] === VoronoiCA.EMPTY) empty++;
    this.emptyCount = empty;
    if (empty === this.prevEmpty) this.stalled = true;   // a full step changed nothing
    this.prevEmpty = empty;
    // python: stops when no empty cell was found, or after max(width, height) iterations
    this.done = clearing ? (empty === 0 || this.clearStep >= this.maxSteps)
                         : (empty === 0 || this.frame >= this.maxSteps - 1);
  }

  /** One iteration of the python loop. Returns false once the animation has ended. */
  advance() {
    if (this.done) return false;
    const gl = this.gl, clear = this.phase === 'clear';
    const p = clear ? this.clearProg : this.stepProg;
    const next = 1 - this.cur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next]);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.uniform1i(gl.getUniformLocation(p, 'uState'), 0);
    gl.uniform2i(gl.getUniformLocation(p, 'uSize'), this.cols, this.rows);
    gl.uniform1i(gl.getUniformLocation(p, 'uMode'), this.distance);
    gl.uniform1i(gl.getUniformLocation(p, 'uStep'), clear ? this.clearStep : this.frame);
    gl.uniform1i(gl.getUniformLocation(p, 'uStalled'), this.stalled ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = next;
    if (clear) this.clearStep++; else this.frame++;

    // python: at t == 1 the sites are re-drawn as siteCell before old_cells is copied
    if (!clear && this.frame === 1) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      const px = new Uint8Array([VoronoiCA.SITE, 0, 0, 255]);
      for (const [r, c] of this.sites)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, c, r, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    this._refresh();
    this.draw();
    return true;
  }

  /** Begin the clear phase: one static site in the centre erases the pattern with the same distance rule. */
  startClear() {
    if (this.phase !== 'fill' || !this.done) return false;
    const gl = this.gl;
    this.phase = 'clear'; this.clearStep = 0;
    this.prevEmpty = -1; this.stalled = false;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, this.cols >> 1, this.rows >> 1, 1, 1,
                     gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([1, 0, 0, 255]));
    this._refresh();
    this.draw();
    return true;
  }

  draw() {
    const gl = this.gl, p = this.drawProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
    gl.uniform1i(gl.getUniformLocation(p, 'uState'), 0);
    gl.uniform2i(gl.getUniformLocation(p, 'uSize'), this.cols, this.rows);
    gl.uniform2f(gl.getUniformLocation(p, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(gl.getUniformLocation(p, 'uVmax'), this.vmax);
    gl.uniform1i(gl.getUniformLocation(p, 'uTheme'), this.theme);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

if (typeof window !== 'undefined') window.VoronoiCA = VoronoiCA;