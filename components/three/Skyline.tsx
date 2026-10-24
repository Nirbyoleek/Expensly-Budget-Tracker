"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { DayTip, heatLevels } from "@/components/charts/interactive";
import { firstWeekdayMon } from "@/lib/dates";

type Props = { month: string; today: number; totals: Record<number, number>; detail: Record<number, { count: number; top: string }> };

const SPACING = 1.24;
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

/** Reads a colour token from the page so the scene matches the light or dark theme. */
function token(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v && /^#|^rgb/.test(v) ? v : fallback);
}

/**
 * The month as a city: one column per day on a calendar grid, height = everyday spending.
 * Drag to orbit, scroll/pinch to zoom, hover to read a day, click to open it.
 */
export default function Skyline({ month, today, totals, detail }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [tip, setTip] = useState<{ d: number; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

    /* ── data → columns ── */
    const dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
    const first = firstWeekdayMon(month);
    const rows = Math.ceil((first + dim) / 7);
    const lvl = heatLevels(totals);
    const max = Math.max(1, ...Object.values(totals));

    const colors = () => ({
      low: token("--surface-2", "#171c2a"),
      accent: token("--accent", "#7d8eff"),
      hot: token("--accent-2", "#f5b03a"),
      line: token("--line-2", "#2e3650"),
      bg: token("--bg", "#07090f"),
    });
    let c = colors();
    const shade = (l: number) => {
      if (l === 0) return c.low.clone().lerp(c.accent, 0.12);
      if (l === 4) return c.accent.clone().lerp(c.hot, 0.85);
      return c.low.clone().lerp(c.accent, [0, 0.45, 0.72, 1][l]);
    };

    type Col = { mesh: THREE.Mesh; day: number; h: number; delay: number; future: boolean; level: number };
    const cols: Col[] = [];
    const group = new THREE.Group();
    scene.add(group);
    const disposables: { dispose: () => void }[] = [];

    for (let d = 1; d <= dim; d++) {
      const pos = first + d - 1, col = pos % 7, row = Math.floor(pos / 7);
      const future = d > today;
      const v = totals[d] ?? 0;
      const level = future ? 0 : lvl(v);
      const h = future ? 0.06 : 0.16 + 3.4 * Math.sqrt(v / max);
      const geo = new RoundedBoxGeometry(0.92, h, 0.92, 4, Math.min(0.14, h / 2.2));
      const mat = new THREE.MeshStandardMaterial({
        color: shade(level),
        roughness: 0.38,
        metalness: 0.12,
        emissive: shade(level),
        emissiveIntensity: level >= 3 ? 0.28 : 0.12,
        transparent: future,
        opacity: future ? 0.35 : 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((col - 3) * SPACING, h / 2, (row - (rows - 1) / 2) * SPACING);
      mesh.userData.day = d;
      group.add(mesh);
      disposables.push(geo, mat);
      cols.push({ mesh, day: d, h, delay: (row + col) * 45, future, level });
    }

    // today: a glowing ring on the floor
    const todayCol = cols.find((x) => x.day === today);
    const ringGeo = new THREE.RingGeometry(0.62, 0.72, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: c.hot, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    if (todayCol) ring.position.set(todayCol.mesh.position.x, 0.01, todayCol.mesh.position.z);
    ring.visible = Boolean(todayCol);
    group.add(ring);
    disposables.push(ringGeo, ringMat);

    // floor: a soft pool of light under the grid
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 256;
    const g = glowCanvas.getContext("2d")!;
    const paintGlow = () => {
      g.clearRect(0, 0, 256, 256);
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, `#${c.accent.getHexString()}55`);
      grad.addColorStop(0.55, `#${c.accent.getHexString()}14`);
      grad.addColorStop(1, `#${c.accent.getHexString()}00`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    };
    paintGlow();
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const floorGeo = new THREE.PlaneGeometry(16, 16);
    const floorMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    scene.add(floor);
    disposables.push(glowTex, floorGeo, floorMat);

    // grid lines between cells
    const lines = new THREE.GridHelper(SPACING * 9, 9, c.line, c.line);
    (lines.material as THREE.Material).transparent = true;
    (lines.material as THREE.Material).opacity = 0.35;
    lines.position.y = 0.001;
    scene.add(lines);
    disposables.push(lines.geometry, lines.material as THREE.Material);

    /* ── lights ── */
    const hemi = new THREE.HemisphereLight(0xffffff, c.bg, 1.2);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 12, 8);
    const rim = new THREE.PointLight(c.accent, 30, 20, 2);
    rim.position.set(-4, 4, -5);
    const warm = new THREE.PointLight(c.hot, 18, 16, 2);
    warm.position.set(5, 3, 4);
    scene.add(hemi, key, rim, warm);

    /* ── camera & controls ── */
    camera.position.set(8.2, 9.4, 12.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 26;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.target.set(0, -0.6, 0);
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.7;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      clearTimeout(idleTimer);
    });
    controls.addEventListener("end", () => {
      clearTimeout(idleTimer);
      if (!reduced) idleTimer = setTimeout(() => (controls.autoRotate = true), 6000);
    });

    /* ── sizing ── */
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // narrower boxes need a wider view so the whole month fits
      camera.zoom = Math.max(0.72, Math.min(1.05, (w / h) / 1.25));
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    /* ── hover & click ── */
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2(9, 9);
    let hovered: Col | null = null;
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onLeave = () => ndc.set(9, 9);
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && hovered && !hovered.future) {
        router.push(`/activity?day=${month.slice(0, 8)}${String(hovered.day).padStart(2, "0")}`);
      }
      down = null;
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    /* ── theme changes ── */
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const retheme = () => {
      c = colors();
      for (const col of cols) {
        const m = col.mesh.material as THREE.MeshStandardMaterial;
        m.color.copy(shade(col.level));
        m.emissive.copy(shade(col.level));
      }
      ringMat.color.copy(c.hot);
      hemi.groundColor.copy(c.bg);
      rim.color.copy(c.accent);
      warm.color.copy(c.hot);
      paintGlow();
      glowTex.needsUpdate = true;
    };
    mq.addEventListener("change", retheme);

    /* ── loop: only while on screen ── */
    const t0 = performance.now();
    const top = new THREE.Vector3();
    let raf = 0, visible = true, lastTip = "";
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const t = now - t0;
      for (const col of cols) {
        const k = reduced ? 1 : Math.min(1, Math.max(0, (t - col.delay) / 900));
        const s = Math.max(0.001, easeOutBack(k));
        col.mesh.scale.y = s;
        col.mesh.position.y = (col.h * s) / 2;
      }
      ring.scale.setScalar(1 + 0.08 * Math.sin(t / 380));
      ringMat.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t / 380));

      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(group.children.filter((o) => o !== ring), false)[0];
      const next = hit ? cols.find((x) => x.mesh === hit.object) ?? null : null;
      if (next !== hovered) {
        if (hovered) { (hovered.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = hovered.level >= 3 ? 0.28 : 0.12; hovered.mesh.scale.x = hovered.mesh.scale.z = 1; }
        hovered = next;
        if (hovered) { (hovered.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9; hovered.mesh.scale.x = hovered.mesh.scale.z = 1.08; }
        canvas.style.cursor = hovered && !hovered.future ? "pointer" : "grab";
      }
      if (hovered) {
        top.set(hovered.mesh.position.x, hovered.h + 0.2, hovered.mesh.position.z).project(camera);
        const x = Math.round(((top.x + 1) / 2) * el.clientWidth), y = Math.round(((1 - top.y) / 2) * el.clientHeight);
        const key = `${hovered.day}:${x}:${y}`;
        if (key !== lastTip) { lastTip = key; setTip({ d: hovered.day, x, y }); }
      } else if (lastTip) { lastTip = ""; setTip(null); }

      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); });
    io.observe(el);
    const onVis = () => !document.hidden && start();
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      io.disconnect();
      ro.disconnect();
      mq.removeEventListener("change", retheme);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposables.forEach((x) => x.dispose());
      renderer.dispose();
      canvas.remove();
    };
  }, [month, today, totals, router]);

  if (failed) return <p className="empty">3D needs WebGL, which this browser has turned off. The calendar view shows the same data.</p>;

  return (
    <div className="skyline" ref={host} role="img" aria-label="3D view of daily spending this month">
      {tip && (
        <div className="itip" style={{ left: tip.x, top: tip.y - 10, transform: "translate(-50%, -100%)" }}>
          <DayTip month={month} day={tip.d} total={totals[tip.d] ?? 0} detail={detail[tip.d]} />
        </div>
      )}
    </div>
  );
}
