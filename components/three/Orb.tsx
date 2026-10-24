"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A breathing sphere of light-points that leans toward the cursor.
 * Decorative: hidden from screen readers, paused off-screen, still under reduced motion.
 */
export default function Orb({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !el.offsetWidth) return; // hidden at this screen size: don't spend a WebGL context on it
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
    } catch {
      return; // no WebGL: the page simply has no orb
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.z = 7.5;

    // Points on a Fibonacci sphere, each with a random phase for the shimmer.
    const N = 4200;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = golden * i;
      pos.set([Math.cos(t) * r * 2.2, y * 2.2, Math.sin(t) * r * 2.2], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));

    const css = (n: string, f: string) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);
    const light = matchMedia("(prefers-color-scheme: light)").matches;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uA: { value: css("--accent", "#7d8eff") },
        uB: { value: css("--accent-2", "#f5b03a") },
        uSize: { value: 4.4 * Math.min(window.devicePixelRatio, 2) },
        uAlpha: { value: light ? 0.8 : 1.0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uSize;
        attribute float seed;
        varying float vMix; varying float vSeed;
        void main() {
          vec3 p = position;
          // slow waves travel over the surface, so the orb breathes
          float wave = sin(p.y * 2.4 + uTime * 0.9) * 0.08 + sin(p.x * 3.1 - uTime * 0.7) * 0.06;
          p *= 1.0 + wave;
          vMix = smoothstep(-2.2, 2.2, p.y + p.x * 0.4);
          vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (0.6 + seed * 0.8) * (6.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uA; uniform vec3 uB; uniform float uTime; uniform float uAlpha;
        varying float vMix; varying float vSeed;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float twinkle = 0.7 + 0.3 * sin(uTime * 1.6 + vSeed * 40.0);
          float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(mix(uA, uB, vMix) * (0.8 + core * 0.6), core * core * twinkle * uAlpha);
        }`,
    });
    const points = new THREE.Points(geo, mat);
    points.rotation.z = 0.35;
    scene.add(points);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const target = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / innerWidth - 0.5) * 0.6;
      target.y = (e.clientY / innerHeight - 0.5) * 0.4;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0, visible = true;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const t = (now - t0) / 1000;
      mat.uniforms.uTime.value = t;
      points.rotation.y = t * 0.12;
      points.rotation.x += (target.y - points.rotation.x) * 0.04;
      points.rotation.z += (0.35 + target.x - points.rotation.z) * 0.04;
      renderer.render(scene, camera);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); });
    io.observe(el);
    const onVis = () => !document.hidden && start();
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={`orb ${className ?? ""}`} aria-hidden="true" />;
}
