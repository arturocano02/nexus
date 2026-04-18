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
  weight: number; // conversation volume (raw_excerpts.length or word_count proxy)
  conviction: number; // 0..1 confidence_score (your view) OR agreement_pct/100 (arena)
  pulsing?: boolean;
  isOwn?: boolean;
  // Arena-only: 0..1 disagreement signal. Higher means the topic is
  // contested, which we use to jitter the blob more vigorously.
  tension?: number;
}

interface NodeMapProps {
  nodes: MapNodeDatum[];
  links?: NodeLink[];
  onSelect?: (id: string) => void;
  onSelectLink?: (link: NodeLink) => void;
  onLinkAnimatedIn?: (linkId: string) => void; // called once per arc after fade-in
  emptyHint?: string;
  radius?: number;
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

// nodeRadius = 0.3 + (wordCount / maxWordCount) * 0.7   (range 0.3..1.0)
function radiusFromWeight(weight: number, maxWeight: number): number {
  const ratio = maxWeight > 0 ? Math.min(1, weight / maxWeight) : 0;
  return 0.25 + ratio * 0.65;
}

function glowIntensity(confidence: number, isArena: boolean): number {
  // Wider glow range. 0 confidence is a matte ghost sphere. 1.0 is white hot.
  if (!isArena) return 0.05 + Math.max(0, Math.min(1, confidence)) * 3.5;
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

  const hexColor = useMemo(() => colorFromConviction(data.conviction, !data.isOwn), [data.conviction, data.isOwn]);
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
          emissiveIntensity={(data.pulsing ? 3 : 1.4) * (hovered ? 1.3 : 1)}
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
    </group>
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
    return (link.relationship_label || "related").toUpperCase();
  }, [link.relationship_label]);

  return (
    <group>
      {/* 
        Native WebGL <line>. Guaranteed dot-free razor-thin 1px rendering. 
        Additive blending makes it pop like a laser rather than a thick tube.
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
          // Normal blending: additive was stacking overlapping arcs into
          // a solid cyan beam across the screen.
          blending={THREE.NormalBlending}
        />
      </line>

      <Html position={midpoint} center distanceFactor={12} zIndexRange={[0, 4]} occlude={false}>
        <button
          ref={labelRef as any}
          onClick={(e) => {
            e.stopPropagation();
            onSelectLink?.(link);
          }}
          className="px-2 py-1 font-display text-[9px] font-bold tracking-[0.2em] uppercase whitespace-nowrap transition-all hover:scale-110 pointer-events-auto rounded-sm"
          style={{
            color: targetColor,
            background: "#0c101c", // Solid dark distinct background
            border: `1px solid ${targetColor}44`,
            boxShadow: `0 4px 12px rgba(0,0,0,0.8), 0 0 10px ${targetColor}22`,
            opacity: 0,
            transition: "color 300ms ease, opacity 200ms ease",
          }}
        >
          {relationshipText}
        </button>
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
  const nodeStates = useRef(new Map<string, { pos: THREE.Vector3; vel: THREE.Vector3 }>());
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
        nodeStates.current.set(n.id, { pos, vel: new THREE.Vector3() });
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
    const repulsion = 16 * (physicsBoost ? (isExploding ? 80 : -40) : 1);
    const attraction = 0.55 * (physicsBoost ? 18 : 1);
    const gravity = physicsBoost ? (isExploding ? 0.02 : 1.8) : 0.07;

    nodes.forEach((ni) => {
      const stateI = nodeStates.current.get(ni.id);
      if (!stateI) return;
      nodes.forEach((nj) => {
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

    links.forEach((link) => {
      const stateA = nodeStates.current.get(link.node_a_id);
      const stateB = nodeStates.current.get(link.node_b_id);
      if (!stateA || !stateB) return;

      const diff = new THREE.Vector3().subVectors(stateB.pos, stateA.pos);
      const sim = Number(link.similarity_score || 0.5);

      // Magnetic resting distance: Strong connections pull tight.
      const restingDistance = Math.max(0.5, 10 - (sim * 12));

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
      state.vel.multiplyScalar(physicsBoost ? 0.94 : 0.86);
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
        // Inject arena color prop natively
        n.isOwn = !isArena; // So the color engine knows how to react
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
}: NodeMapProps) {
  const maxWeight = useMemo(
    () => nodes.reduce((m, n) => Math.max(m, n.weight), 1),
    [nodes],
  );
  return (
    <div className="absolute inset-0 bg-[#080a18]">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 22], fov: 45 }}>
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
          />
        )}
        <OrbitControls
          enablePan={false}
          autoRotate
          autoRotateSpeed={physicsBoost ? 14 : 0.8}
          minDistance={6}
          maxDistance={60}
        />
      </Canvas>
    </div>
  );
}
