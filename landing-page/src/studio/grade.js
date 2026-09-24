/**
 * The photo grade — the part of the Studio that makes a phone photo look
 * like a poster. One WebGL pass per photo: focal-protected motion blur →
 * mono mix → auto levels + midtone target → S-curve → duotone tint → fade →
 * vignette → film grain. A second, lighter pass ("print") lays grain over
 * the finished composition so the type sits IN the image rather than on it.
 *
 * Stills and exports run at 1:1 on a pre-cropped source (media.js does the
 * resample with the browser's high-quality scaler). Live video playback skips
 * that step: the <video> frame goes straight into the texture and uCrop picks
 * the window, with a 4-tap filter standing in for the downscale.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uGrain;
uniform float uGrainSize;
uniform float uSeed;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Dave Hoskins' hash — no sin(), so no precision stripes at large coords.
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two octaves of value noise read as film grain rather than digital noise;
// it is strongest in the midtones and backs off in deep shadow and highlight,
// the way silver grain does.
vec3 grain(vec3 c) {
    if (uGrain <= 0.0) return c;
    vec2 p = gl_FragCoord.xy / uGrainSize + uSeed * 31.7;
    float g = vnoise(p) * 0.62 + vnoise(p * 2.07 + 13.1) * 0.38 - 0.5;
    float l = luma(c);
    float amp = uGrain * (0.35 + 0.65 * (1.0 - pow(abs(l * 2.0 - 1.0), 2.0)));
    return c + g * amp * 2.0;
}`;

const GRADE_FRAG = `${COMMON}
uniform float uSat;
uniform float uBlack;
uniform float uWhite;
uniform float uGamma;
uniform float uGain;
uniform float uContrast;
uniform float uFade;
uniform vec3 uShadow;
uniform vec3 uHigh;
uniform float uTint;
uniform float uMotion;
uniform vec2 uDir;
uniform vec2 uFocal;
uniform float uFocus;
uniform float uVignette;
uniform vec4 uCrop;   // source window in texture uv: x, y, w, h
uniform float uAA;    // 1 when the texture is being minified (direct video)

const int TAPS = 40;

vec3 tex(vec2 uv) { return texture2D(uTex, uCrop.xy + uv * uCrop.zw).rgb; }

// Motion blur along uDir. The streak length ramps up with distance from the
// focal point, so the subject stays readable while the frame around it moves
// — a panning shot, not camera shake.
vec3 source(vec2 uv) {
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    float d = length((uv - uFocal) * asp);
    float k = mix(1.0, smoothstep(0.06, 0.62, d), uFocus);
    float len = uMotion * k;
    if (len < 1.0) {
        if (uAA < 0.5) return tex(uv);
        vec2 q = 0.25 / uRes;
        return (tex(uv + vec2(-q.x, -q.y)) + tex(uv + vec2(q.x, -q.y)) + tex(uv + vec2(-q.x, q.y)) + tex(uv + q)) * 0.25;
    }
    vec2 span = uDir * len / uRes;
    float jitter = hash12(gl_FragCoord.xy) - 0.5;
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    for (int i = 0; i < TAPS; i++) {
        float t = (float(i) + 0.5 + jitter) / float(TAPS) - 0.5;
        float w = 1.0 - abs(t) * 1.4;
        acc += tex(uv + span * t) * w;
        ws += w;
    }
    return acc / ws;
}

void main() {
    vec3 c = source(vUv);
    // Mono mix leans on red a little, like a red filter on B&W film: skin
    // lifts, skies and shadows deepen.
    float l = dot(c, vec3(0.36, 0.53, 0.11));
    c = mix(vec3(l), c, uSat);
    c = clamp((c - uBlack) / max(uWhite - uBlack, 0.05), 0.0, 1.0);
    c = pow(c, vec3(uGamma)) * uGain;
    vec3 s = c * c * (3.0 - 2.0 * c);
    c = clamp(mix(c, s, uContrast), 0.0, 1.0);
    float lt = luma(c);
    c = mix(c, mix(uShadow, uHigh, lt), uTint);
    c = uFade + c * (1.0 - uFade);
    vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float r = length(p) / (0.5 * length(vec2(uRes.x / uRes.y, 1.0)));
    c *= 1.0 - uVignette * smoothstep(0.28, 1.1, r);
    gl_FragColor = vec4(clamp(grain(c), 0.0, 1.0), 1.0);
}`;

const PRINT_FRAG = `${COMMON}
void main() {
    vec3 c = texture2D(uTex, vUv).rgb;
    gl_FragColor = vec4(clamp(grain(c), 0.0, 1.0), 1.0);
}`;

/** Duotone ends [shadow, highlight] — applied on top of the mono mix. */
export const TINTS = {
    none: { label: 'Neutral', shadow: [0, 0, 0],             high: [1, 1, 1],             amount: 0 },
    warm: { label: 'Warm',    shadow: [0.035, 0.028, 0.022], high: [1.0, 0.955, 0.885],   amount: 1 },
    cool: { label: 'Cool',    shadow: [0.018, 0.028, 0.042], high: [0.9, 0.955, 1.0],     amount: 1 },
    gold: { label: 'Gold',    shadow: [0.03, 0.028, 0.02],   high: [0.98, 0.8, 0.08],     amount: 1 },
};

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`Studio shader failed: ${log}`);
    }
    return sh;
}

function program(gl, frag) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Studio program failed: ${gl.getProgramInfoLog(p)}`);
    return { p, locs: new Map() };
}

export function createGrader() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL is unavailable in this browser — the Studio needs it to grade photos.');

    const progs = { grade: program(gl, GRADE_FRAG), print: program(gl, PRINT_FRAG) };

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const loc = (prog, name) => {
        if (!prog.locs.has(name)) prog.locs.set(name, gl.getUniformLocation(prog.p, name));
        return prog.locs.get(name);
    };

    // The GL canvas only ever GROWS: each pass renders into a w×h viewport at
    // its bottom-left and the caller copies that region out. Resizing it per
    // pass (an inset photo, then the full-frame grain) reallocated the drawing
    // buffer twice a frame and cost Grid ~75 ms per video frame.
    function run(prog, src, w, h, uniforms) {
        if (canvas.width < w) canvas.width = w;
        if (canvas.height < h) canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog.p);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);

        const aPos = gl.getAttribLocation(prog.p, 'aPos');
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1i(loc(prog, 'uTex'), 0);
        gl.uniform2f(loc(prog, 'uRes'), w, h);
        const crop = loc(prog, 'uCrop');
        if (crop !== null) gl.uniform4f(crop, ...(uniforms.uCrop ?? [0, 0, 1, 1]));
        const aa = loc(prog, 'uAA');
        if (aa !== null) gl.uniform1f(aa, uniforms.uAA ?? 0);
        for (const [name, v] of Object.entries(uniforms)) {
            const l = loc(prog, name);
            if (l === null) continue;
            if (typeof v === 'number') gl.uniform1f(l, v);
            else if (name === 'uCrop') continue;
            else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
            else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        // GL's origin is bottom-left, so the pass sits at the canvas's bottom.
        return { canvas, sx: 0, sy: canvas.height - h, w, h };
    }

    return {
        /** Grade a source into a w×h result (see blit). Draw it before the next call — the canvas is shared. */
        grade(src, w, h, u) { return run(progs.grade, src, w, h, u); },
        /** Grain over a finished composition. */
        print(src, w, h, u) { return run(progs.print, src, w, h, u); },
    };
}

/** Draw a grade()/print() result onto a 2D context. */
export function blit(ctx, out, dx, dy, dw = out.w, dh = out.h) {
    ctx.drawImage(out.canvas, out.sx, out.sy, out.w, out.h, dx, dy, dw, dh);
}
