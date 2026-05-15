"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { Link as NodeLink } from "@/lib/types";
import { colorForRelationship, thicknessForSimilarity } from "@/lib/relationship";

export interface MapNodeDatum {
  id: string;
  label: string;
  weight: number;
  conviction: number; // 0..1
  pulsing?: boolean;
  isOwn?: boolean;
  tension?: number;
  hexColor?: string;
  /** If set, this node orbits around the parent category blob */
  parentId?: string;
  isSatellite?: boolean;
  /** Inferred stance — renders as a small dot below the blob */
  stance?: "yes" | "no" | "abstain" | null;
}

interface NodeMapProps {
  nodes: MapNodeDatum[];
  links?: NodeLink[];
  onSelect?: (id: string) => void;
  onSelectLink?: (link: NodeLink) => void;
  onLinkAnimatedIn?: (linkId: string) => void; // called once per arc after fade-in
  emptyHint?: string;
  radius?: number;
  cameraDistance?: number; // default 22 — lower brings blobs closer/larger
  physicsBoost?: boolean;
  highlightIds?: Set<string>; // nodes rendered with a warm "own" halo (arena)
  isArena?: boolean;
}

const AMBER = "#FFBF00";
const CORAL = "#FF5A6A";
const CYAN = "#00DCFF";
const GRAY = "#888780";

function colorFromConviction(c: number, isArena: boolean): string {
  if (!isArena) {
    // All personal nodes are unified under a single Amber color, scaling purely by emissive intensity!
    return AMBER;
  }

  // Arena palette: two colors only. Cyan = active disagreement, amber = consensus.
  // Below 0.2 agreement we fade to gray so quiet/undiscussed topics recede
  // visually instead of reading as "disagreement". No coral band anywhere.
  const clamped = Math.max(0, Math.min(1, c));
  if (clamped < 0.2) {
    // Barely discussed: lean gray, but still lean a tiny bit toward cyan so
    // the scene isn't a sea of slate.
    const t = clamped / 0.2;
    const mix = new THREE.Color(GRAY).lerp(new THREE.Color(CYAN), t * 0.35);
    return `#${mix.getHexString()}`;
  }
  // Direct amber <-> cyan interpolation across the 0.2..1.0 band.
  const t = (clamped - 0.2) / 0.8;
  const mix = new THREE.Color(CYAN).lerp(new THREE.Color(AMBER), t);
  return `#${mix.getHexString()}`;
}

// nodeRadius scales 0.28–0.92 based on relative weight (conversation volume)
function radiusFromWeight(weight: number, maxWeight: number): number {
  const ratio = maxWeight > 0 ? Math.min(1, weight / maxWeight) : 0;
  return 0.28 + ratio * 0.64;
}

function glowIntensity(confidence: number, isArena: boolean): number {
  // Wide glow range: matte ghost at 0 conviction, white-hot at 1.0
  if (!isArena) return 0.1 + Math.max(0, Math.min(1, confidence)) * 4.2;
  return 0.2 + Math.max(0, Math.min(1, confidence)) * 1.5;
}

function ThoughtBlob({
  data,
  position,
  maxWeight,
  onSelect,
  isVortexing,
  isHighlighted,
}: {
  data: MapNodeDatum;
  position: THREE.Vector3;
  maxWeight: number;
  onSelect?: (id: string) => void;
  isVortexing?: boolean;
  isHighlighted?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const scaleCurrent = useRef(0.01);
  const glowCurrent = useRef(0.2);
  const radiusCurrent = useRef(0.3);
  const [hovered, setHovered] = useState(false);

  // Tension (arena disagreement) drives vigorous motion: a contested topic
  // wobbles and distorts visibly. Personal views default to tension 0.
  const tension = Math.max(0, Math.min(1, data.tension ?? 0));
  const motionSpeed = data.pulsing ? 2.8 : 0.8 + tension * 2.2;
  const distortionAmount = data.pulsing ? 0.7 : 0.45 + tension * 0.35;

  const targetRadius = useMemo(
    () => radiusFromWeight(data.weight, maxWeight),
    [data.weight, maxWeight],
  );
  const targetGlow = useMemo(() => glowIntensity(data.conviction, !!data.isOwn), [data.conviction, data.isOwn]);

  useFrame((state, dt) => {
    if (!groupRef.current || !meshRef.current || dt > 0.1) return;
    groupRef.current.position.lerp(position, 1 - Math.exp(-14 * dt));

    const t = state.clock.getElapsedTime();
    const pulse = 1 + Math.sin(t * motionSpeed + data.id.charCodeAt(0) * 0.1) * 0.04;

    // Smooth toward word-count radius (spec: 600ms feel, we use exponential lerp).
    radiusCurrent.current += (targetRadius - radiusCurrent.current) * 4 * dt;
    const effective = isVortexing ? radiusCurrent.current * 2 : radiusCurrent.current;
    scaleCurrent.current += (effective - scaleCurrent.current) * 8 * dt;

    const sx = scaleCurrent.current * pulse * (hovered ? 1.08 : 1);
    const sy = scaleCurrent.current * (1 + Math.cos(t * motionSpeed * 0.8) * 0.04) * (hovered ? 1.08 : 1);
    meshRef.current.scale.set(sx, sy, sx);
    meshRef.current.rotation.y += (data.pulsing ? 1.2 : 0.3) * dt;
    meshRef.current.rotation.z += (data.pulsing ? 0.8 : 0.2) * dt;

    // Glow tween (spec: 400ms-ish).
    glowCurrent.current += (targetGlow - glowCurrent.current) * 6 * dt;
    if (lightRef.current) {
      // Light intensity scales with both confidence and blob size for a natural
      // feel: big certain blobs dominate the scene, small tentative ones flicker.
      lightRef.current.intensity =
        glowCurrent.current * (1.4 + radiusCurrent.current) * (hovered ? 1.6 : 1);
    }
  });

  const hexColor = useMemo(
    () => data.hexColor ?? colorFromConviction(data.conviction, !data.isOwn),
    [data.hexColor, data.conviction, data.isOwn],
  );
  const labelOffset = useMemo<[number, number, number]>(
    () => [0, targetRadius + 0.35, 0],
    [targetRadius],
  );

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(data.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[1, 48, 48]} />
        <MeshDistortMaterial
          color={hexColor}
          distort={isVortexing ? 0.8 : distortionAmount}
          speed={isVortexing ? 6 : motionSpeed}
          emissive={hexColor}
          emissiveIntensity={(data.pulsing ? 3 : (0.7 + data.conviction * 1.8)) * (hovered ? 1.3 : 1)}
          // Matte surface: metalness 1 + roughness 0 was reflecting every
          // neighboring blob's pointLight as sharp specular dots, which looked
          // like white sparkles crawling across the blobs. Going full diffuse
          // + emissive gives us the smooth self-lit glow we had before.
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Per-node point light so glow scales with confidence in world space.
          For "your own" nodes in the arena, we brighten the light slightly
          via intensity multiplier below (no ring, no overlay). The user
          explicitly wanted the natural emissive + pointLight glow back. */}
      <pointLight
        ref={lightRef}
        color={isHighlighted ? AMBER : hexColor}
        intensity={0.5}
        distance={6}
        decay={2}
      />

      <Html
        position={labelOffset}
        center
        distanceFactor={7}
        zIndexRange={[0, 10]}
        occlude={false}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="px-3 py-1.5 rounded-full border shadow-2xl backdrop-blur-3xl flex items-center gap-1.5 select-none"
          style={{
            borderColor: `${hexColor}77`,
            backgroundColor: "rgba(2, 3, 8, 0.88)",
            boxShadow: `0 8px 32px -8px ${hexColor}44, 0 0 0 1px ${hexColor}22`,
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: hexColor, boxShadow: `0 0 8px ${hexColor}` }}
          />
          <p
            className="font-display text-[10px] font-extrabold whitespace-nowrap tracking-[0.18em] uppercase"
            style={{ color: hexColor, textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}
          >
            {data.label}
          </p>
        </div>
      </Html>

      {/* Stance indicator dot — green yes / red no / gray abstain */}
      {data.stance && (
        <Html
          position={[0, -(targetRadius + 0.28), 0]}
          center
          distanceFactor={7}
          zIndexRange={[0, 9]}
          style={{ pointerEvents: "none" }}
        >
          <div style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: data.stance === "yes" ? "#4ade80" : data.stance === "no" ? "#FF5A6A" : "#888780",
            boxShadow: `0 0 6px ${data.stance === "yes" ? "#4ade80" : data.stance === "no" ? "#FF5A6A" : "#888780"}`,
            border: "1px solid rgba(0,0,0,0.4)",
          }} />
        </Html>
      )}
    </group>
  );
}

// -----------------------------------------------------------------------
// Satellite blob — sized by weight (argument count), orbiting parent
// -----------------------------------------------------------------------
function SatelliteBlob({
  data,
  position,
  onSelect,
}: {
  data: MapNodeDatum;
  position: THREE.Vector3;
  onSelect?: (id: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const [hovered, setHovered] = useState(false);
  const posRef = useRef(position.clone());
  const scaleCurrent = useRef(0.01);

  // weight ∈ [0.3, 0.9] → baseScale ∈ [0.32, 0.50]
  const baseScale = 0.26 + data.weight * 0.26;

  useFrame((state, dt) => {
    if (!groupRef.current || !meshRef.current || dt > 0.1) return;
    posRef.current.lerp(position, 1 - Math.exp(-14 * dt));
    groupRef.current.position.copy(posRef.current);
    const t = state.clock.getElapsedTime();
    const pulse = 1 + Math.sin(t * 1.4 + data.id.charCodeAt(0) * 0.9) * 0.07;
    // Smoothly grow toward target scale so adding arguments feels organic
    scaleCurrent.current += (baseScale - scaleCurrent.current) * 3 * dt;
    const s = scaleCurrent.current * pulse * (hovered ? 1.18 : 1);
    meshRef.current.scale.setScalar(s);
    if (lightRef.current) {
      lightRef.current.intensity = (hovered ? 1.8 : 1.1) * (0.8 + data.weight * 0.4);
    }
  });

  const hexColor = data.hexColor ?? AMBER;

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onSelect?.(data.id); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = "default"; }}
      >
        <sphereGeometry args={[1, 24, 24]} />
        <MeshDistortMaterial
          color={hexColor}
          distort={0.25}
          speed={1.4}
          emissive={hexColor}
          emissiveIntensity={hovered ? 4.5 : 2.8}
          roughness={0.9}
          metalness={0}
        />
      </mesh>
      <pointLight ref={lightRef} color={hexColor} intensity={1.1} distance={3.5} decay={2} />
      {/* Hover-only tooltip: show label only when directly hovered */}
      {hovered && (
        <Html
          position={[0, baseScale + 0.22, 0]}
          center
          distanceFactor={7}
          zIndexRange={[0, 8]}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="px-2 py-1 rounded-full font-bold uppercase tracking-widest whitespace-nowrap"
            style={{
              fontSize: "9px",
              background: "rgba(2,3,8,0.92)",
              border: `1px solid ${hexColor}55`,
              color: hexColor,
              boxShadow: `0 0 10px ${hexColor}33`,
            }}
          >
            {data.label}
          </div>
        </Html>
      )}
    </group>
  );
}

// -----------------------------------------------------------------------
// Thin glowing line connecting a satellite to its parent category blob
// -----------------------------------------------------------------------
function SatelliteConnector({
  start,
  end,
  color,
}: {
  start: THREE.Vector3; // satellite pos (mutated each frame by physics)
  end: THREE.Vector3;   // parent pos (mutated each frame by physics)
  color: string;
}) {
  const geomRef = useRef<THREE.BufferGeometry>(null);
  const opacityRef = useRef(0);
  const matRef = useRef<THREE.LineBasicMaterial>(null);

  useFrame((_, dt) => {
    if (dt > 0.1) return;
    // Fade in
    opacityRef.current = Math.min(0.38, opacityRef.current + dt * 1.2);
    if (geomRef.current) {
      geomRef.current.setFromPoints([start, end]);
    }
    if (matRef.current) {
      matRef.current.opacity = opacityRef.current;
    }
  });

  return (
    // @ts-ignore — R3F line primitive
    <line>
      <bufferGeometry ref={geomRef} />
      <lineBasicMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </line>
  );
}

function Arc({
  link,
  start,
  end,
  onSelectLink,
  onAnimatedIn,
  lowDetail,
}: {
  link: NodeLink;
  start: THREE.Vector3;
  end: THREE.Vector3;
  onSelectLink?: (link: NodeLink) => void;
  onAnimatedIn?: (id: string) => void;
  lowDetail?: boolean;
}) {
  const geomRef = useRef<THREE.BufferGeometry>(null);
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const labelPosRef = useRef(new THREE.Vector3());

  // Target visuals
  const targetColor = useMemo(
    () => link.arc_color || colorForRelationship(link.relationship_label),
    [link.arc_color, link.relationship_label],
  );

  // Native WebGL lines are ~1px so we express "strength" purely through
  // opacity, not thickness. Cap at 0.7 so a cluster of overlapping arcs
  // doesn't stack into a visual beam.
  const targetOpacity = useMemo(() => {
    const sim = Number(link.similarity_score || 0.75);
    return Math.max(0.2, Math.min(0.7, sim));
  }, [link.similarity_score]);

  const opacity = useRef(link.animated_in ? 1 : 0);
  const color = useRef(new THREE.Color(targetColor));
  const animProgress = useRef(link.animated_in ? 1 : 0);
  const notifiedAnimatedIn = useRef(false);

  // Define initial structural data
  const initialCurve = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(end, start);
    const dist = dir.length();
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const arch = mid.clone().add(mid.clone().normalize().multiplyScalar(dist * 0.25));
    return new THREE.QuadraticBezierCurve3(start, arch, end);
  }, [start, end]);

  const [midpoint, setMidpoint] = useState(() => initialCurve.getPoint(0.5));

  useFrame((_, dt) => {
    if (dt > 0.1) return;

    if (animProgress.current < 1) {
      animProgress.current = Math.min(1, animProgress.current + dt / 0.8);
      opacity.current = animProgress.current;
      if (!notifiedAnimatedIn.current && animProgress.current >= 1 && link.id && onAnimatedIn) {
        notifiedAnimatedIn.current = true;
        onAnimatedIn(link.id);
      }
    } else {
      opacity.current += (1 - opacity.current) * 6 * dt;
    }

    const nextColor = new THREE.Color(targetColor);
    color.current.lerp(nextColor, Math.min(1, 6 * dt));

    // RECALCULATE CURVE EVERY FRAME
    // Absolutely glues the arc physically to the center of the nodes.
    const dir = new THREE.Vector3().subVectors(end, start);
    const dist = dir.length();
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const arch = mid.clone().add(mid.clone().normalize().multiplyScalar(dist * 0.25));
    const curve = new THREE.QuadraticBezierCurve3(start, arch, end);

    labelPosRef.current.copy(curve.getPoint(0.5));
    // Soft hack: occasionally push state to cause Html div to recenter without trashing 60fps
    if (Math.random() < 0.1) setMidpoint(labelPosRef.current.clone());

    if (geomRef.current) {
      geomRef.current.setFromPoints(curve.getPoints(lowDetail ? 16 : 32));
    }

    if (matRef.current) {
      matRef.current.color.copy(color.current);
      matRef.current.opacity = opacity.current * targetOpacity;
    }

    if (labelRef.current) {
      const p = animProgress.current;
      const labelAlpha = p < 0.75 ? 0 : Math.min(1, (p - 0.75) / 0.25);
      labelRef.current.style.opacity = String(Math.max(labelAlpha, animProgress.current >= 1 ? 1 : 0));
    }
  });

  const relationshipText = useMemo(() => {
    if (link.arc_color === "#22c55e" || link.relationship_label === "builds on") return "STRENGTHENS";
    if (link.arc_color === "#FF5A6A" || link.relationship_label === "contradicts") return "CONTRADICTS";
    const label = link.relationship_label || "";
    if (label === "challenges") return "CONTRADICTS";
    return label ? label.toUpperCase() : "RELATED";
  }, [link.arc_color, link.relationship_label]);

  const [tooltipOpen, setTooltipOpen] = useState(false);

  return (
    <group>
      {/*
        Native WebGL <line>. Guaranteed dot-free razor-thin 1px rendering.
      */}
      <line
        onClick={(e) => {
          e.stopPropagation();
          onSelectLink?.(link);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
          if (matRef.current) matRef.current.opacity = 1;
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        <bufferGeometry ref={geomRef} />
        <lineBasicMaterial
          ref={matRef}
          color={targetColor}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </line>

      <Html position={midpoint} center distanceFactor={12} zIndexRange={[0, 4]} occlude={false}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <button
            ref={labelRef as any}
            onClick={(e) => {
              e.stopPropagation();
              onSelectLink?.(link);
            }}
            onMouseEnter={() => link.link_summary && setTooltipOpen(true)}
            onMouseLeave={() => setTooltipOpen(false)}
            className="px-2 py-1 font-display text-[9px] font-bold tracking-[0.2em] uppercase whitespace-nowrap transition-all hover:scale-110 pointer-events-auto rounded-sm"
            style={{
              color: targetColor,
              background: "#0c101c",
              border: `1px solid ${targetColor}44`,
              boxShadow: `0 4px 12px rgba(0,0,0,0.8), 0 0 10px ${targetColor}22`,
              opacity: 0,
              transition: "color 300ms ease, opacity 200ms ease",
            }}
          >
            {relationshipText}
          </button>

          {tooltipOpen && link.link_summary && (
            <div
              className="pointer-events-none"
              style={{
                background: "rgba(6,8,22,0.96)",
                border: `1px solid ${targetColor}33`,
                borderRadius: 8,
                padding: "8px 12px",
                maxWidth: 220,
                fontSize: 10,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.85)",
                boxShadow: `0 8px 24px rgba(0,0,0,0.9), 0 0 12px ${targetColor}22`,
                textAlign: "center",
                whiteSpace: "normal",
              }}
            >
              {link.link_summary}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

function NodeField({
  nodes,
  links = [],
  onSelect,
  onSelectLink,
  onLinkAnimatedIn,
  radius = 6,
  physicsBoost = false,
  highlightIds,
  maxWeight,
  isArena,
}: NodeMapProps & { maxWeight: number }) {
  const nodeStates = useRef(new Map<string, { pos: THREE.Vector3; vel: THREE.Vector3; floatPhase: number }>());
  const [, setTick] = useState(0);
  const camera = useRef<THREE.Camera | null>(null);

  useEffect(() => {
    // Add newly seen nodes with a spawn position.
    const live = new Set<string>();
    nodes.forEach((n) => {
      live.add(n.id);
      if (!nodeStates.current.has(n.id)) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const pos = new THREE.Vector3(
          radius * Math.cos(theta) * Math.sin(phi),
          radius * Math.sin(theta) * Math.sin(phi),
          radius * Math.cos(phi),
        );
        nodeStates.current.set(n.id, {
          pos,
          vel: new THREE.Vector3(),
          floatPhase: Math.random() * Math.PI * 2,
        });
      }
    });
    // Purge stale positions from merged / deleted nodes so arcs can never
    // hook into an orphan position and draw a beam across empty space.
    for (const id of Array.from(nodeStates.current.keys())) {
      if (!live.has(id)) nodeStates.current.delete(id);
    }
  }, [nodes, radius]);

  useFrame((state, dt) => {
    camera.current = state.camera;
    if (dt > 0.1) return;
    const t = state.clock.getElapsedTime();
    const isExploding = physicsBoost && (t % 4 > 2.5);
    // Normal mode: low repulsion + stronger gravity → nodes cluster, don't drift apart
    const repulsion = physicsBoost ? (isExploding ? 1280 : -640) : 3.5;
    const attraction = 0.38 * (physicsBoost ? 18 : 1);
    const gravity = physicsBoost ? (isExploding ? 0.02 : 1.8) : 0.16;

    // Separate category nodes from satellite nodes
    const categoryNodes = nodes.filter(n => !n.isSatellite);
    const satelliteNodes = nodes.filter(n => n.isSatellite);

    categoryNodes.forEach((ni) => {
      const stateI = nodeStates.current.get(ni.id);
      if (!stateI) return;
      // Repulsion only between category nodes
      categoryNodes.forEach((nj) => {
        if (ni.id === nj.id) return;
        const stateJ = nodeStates.current.get(nj.id);
        if (!stateJ) return;
        const diff = new THREE.Vector3().subVectors(stateI.pos, stateJ.pos);
        const distSq = diff.lengthSq();
        if (distSq < 0.1) return;
        stateI.vel.add(diff.normalize().multiplyScalar(repulsion / distSq).multiplyScalar(dt));
      });
      stateI.vel.add(new THREE.Vector3().copy(stateI.pos).multiplyScalar(-gravity).multiplyScalar(dt));
    });

    // Satellites: orbit their parent with a spring force
    satelliteNodes.forEach((ni) => {
      const stateI = nodeStates.current.get(ni.id);
      if (!stateI) return;
      const parentState = ni.parentId ? nodeStates.current.get(ni.parentId) : null;
      if (parentState) {
        const toParent = new THREE.Vector3().subVectors(parentState.pos, stateI.pos);
        const dist = toParent.length();
        const orbitRadius = 1.7;
        // Spring toward orbit radius from parent
        const springForce = (dist - orbitRadius) * 12 * dt;
        stateI.vel.add(toParent.normalize().multiplyScalar(springForce));
        // Slight sideways drift to make them orbit rather than stack
        const tangent = new THREE.Vector3(
          Math.sin(t * 0.6 + ni.id.charCodeAt(0) * 1.3),
          Math.cos(t * 0.5 + ni.id.charCodeAt(1) * 1.1),
          Math.sin(t * 0.7 + ni.id.charCodeAt(2) * 0.9),
        ).normalize().multiplyScalar(0.4 * dt);
        stateI.vel.add(tangent);
      }
      // Mild repulsion between satellites of the same parent
      satelliteNodes.forEach((nj) => {
        if (ni.id === nj.id || ni.parentId !== nj.parentId) return;
        const stateJ = nodeStates.current.get(nj.id);
        if (!stateJ) return;
        const diff = new THREE.Vector3().subVectors(stateI.pos, stateJ.pos);
        const distSq = Math.max(0.05, diff.lengthSq());
        stateI.vel.add(diff.normalize().multiplyScalar(2 / distSq).multiplyScalar(dt));
      });
      stateI.vel.multiplyScalar(0.82); // stronger damping for satellites
    });

    // Only category nodes apply standard gravity
    nodes.filter(n => !n.isSatellite).forEach(ni => {
      const stateI = nodeStates.current.get(ni.id);
      if (!stateI) return;
      // (already handled above)
    });

    links.forEach((link) => {
      const stateA = nodeStates.current.get(link.node_a_id);
      const stateB = nodeStates.current.get(link.node_b_id);
      if (!stateA || !stateB) return;

      const diff = new THREE.Vector3().subVectors(stateB.pos, stateA.pos);
      const sim = Number(link.similarity_score || 0.5);

      // Linked nodes pull toward each other but keep a comfortable gap
      const restingDistance = Math.max(0.5, 5 - sim * 4);

      const force = diff
        .normalize()
        .multiplyScalar(
          (diff.length() - (physicsBoost ? 1 : restingDistance)) * attraction * sim,
        );
      stateA.vel.add(force.multiplyScalar(dt));
      stateB.vel.sub(force);
    });

    nodeStates.current.forEach((state) => {
      state.pos.add(state.vel.clone().multiplyScalar(dt * (physicsBoost ? 3 : 1)));
      // Gentle per-node float — unique phase so each blob drifts independently
      if (!physicsBoost) {
        const fp = state.floatPhase;
        const amp = 0.007;
        state.pos.x += Math.sin(t * 0.21 + fp) * amp;
        state.pos.y += Math.cos(t * 0.17 + fp * 1.4) * amp;
        state.pos.z += Math.sin(t * 0.13 + fp * 0.8) * amp;
      }
      // High damping in normal mode: velocity dies fast → no runaway drift
      state.vel.multiplyScalar(physicsBoost ? 0.94 : 0.97);
    });

    setTick((k) => (k + 1) % 1_000_000);
  });

  const visibleLinks = useMemo(() => {
    // Only keep links whose BOTH endpoints are in the current node set.
    // Without this, freshly merged / deleted nodes leave orphan arcs that
    // render to stale spawn positions and look like rogue beams.
    const liveIds = new Set(nodes.map((n) => n.id));
    const filtered = links.filter(
      (l) => liveIds.has(l.node_a_id) && liveIds.has(l.node_b_id) && l.node_a_id !== l.node_b_id,
    );
    const sorted = filtered.sort((a, b) => {
      const ta = a.last_seen_at ? Date.parse(a.last_seen_at) : 0;
      const tb = b.last_seen_at ? Date.parse(b.last_seen_at) : 0;
      return tb - ta;
    });
    return sorted.slice(0, 50);
  }, [links, nodes]);

  const lowDetail = visibleLinks.length > 100;

  return (
    <>
      {/* Satellite → parent connector lines (behind everything) */}
      {nodes.filter(n => n.isSatellite && n.parentId).map((n) => {
        const satState = nodeStates.current.get(n.id);
        const parentState = nodeStates.current.get(n.parentId!);
        if (!satState || !parentState) return null;
        return (
          <SatelliteConnector
            key={`conn-${n.id}`}
            start={satState.pos}
            end={parentState.pos}
            color={n.hexColor ?? AMBER}
          />
        );
      })}

      {visibleLinks.map((link) => {
        const start = nodeStates.current.get(link.node_a_id)?.pos;
        const end = nodeStates.current.get(link.node_b_id)?.pos;
        if (!start || !end) return null;
        return (
          <Arc
            key={link.id}
            link={link}
            start={start}
            end={end}
            onSelectLink={onSelectLink}
            onAnimatedIn={onLinkAnimatedIn}
            lowDetail={lowDetail}
          />
        );
      })}
      {nodes.map((n) => {
        const state = nodeStates.current.get(n.id);
        if (!state) return null;
        n.isOwn = !isArena;
        if (n.isSatellite) {
          return (
            <SatelliteBlob
              key={n.id}
              data={n}
              position={state.pos}
              onSelect={onSelect}
            />
          );
        }
        return (
          <ThoughtBlob
            key={n.id}
            data={n}
            position={state.pos}
            maxWeight={maxWeight}
            onSelect={onSelect}
            isVortexing={physicsBoost}
            isHighlighted={highlightIds?.has(n.id)}
          />
        );
      })}
    </>
  );
}

export default function NodeMap({
  nodes,
  links = [],
  onSelect,
  onSelectLink,
  onLinkAnimatedIn,
  physicsBoost = false,
  highlightIds,
  isArena,
  radius,
  cameraDistance = 22,
  emptyHint,
}: NodeMapProps) {
  const maxWeight = useMemo(
    () => nodes.filter(n => !n.isSatellite).reduce((m, n) => Math.max(m, n.weight), 1),
    [nodes],
  );

  // Show "click to begin" hint only on the personal map (not arena), and only when no panel is open
  const showHint = !isArena && nodes.length > 0 && nodes.every(n => !n.pulsing);

  return (
    <div className="absolute inset-0 bg-[#080a18]">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, cameraDistance], fov: 50 }}>
        <fog attach="fog" args={["#080a18", 20, 60]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[10, 10, 10]} intensity={1.4} color={CYAN} />
        <pointLight position={[-10, -10, -10]} intensity={1.0} color={AMBER} />
        {nodes.length > 0 && (
          <NodeField
            nodes={nodes}
            links={links}
            onSelect={onSelect}
            onSelectLink={onSelectLink}
            onLinkAnimatedIn={onLinkAnimatedIn}
            physicsBoost={physicsBoost}
            highlightIds={highlightIds}
            maxWeight={maxWeight}
            isArena={isArena}
            radius={radius}
          />
        )}
        {showHint && (
          <Html
            position={[0, -3.5, 0]}
            center
            distanceFactor={10}
            zIndexRange={[0, 5]}
            style={{ pointerEvents: "none" }}
          >
            <p
              className="font-mono text-[9px] uppercase tracking-[0.4em] animate-pulse text-center"
              style={{ color: "rgba(255,191,0,0.35)", whiteSpace: "nowrap" }}
            >
              Click a blob to begin
            </p>
          </Html>
        )}
        <OrbitControls
          enablePan={false}
          autoRotate
          autoRotateSpeed={physicsBoost ? 14 : 0.6}
          minDistance={6}
          maxDistance={40}
        />
      </Canvas>
    </div>
  );
}
