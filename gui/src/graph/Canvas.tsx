import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, Controls, MarkerType, MiniMap, ReactFlow, applyNodeChanges, useNodesInitialized, useReactFlow, useStore,
  type Connection, type Edge, type FinalConnectionState, type Node, type NodeChange, type OnConnectEnd, type OnReconnect,
} from "@xyflow/react";
import { buildEdges, buildNodes, type EdgeData, type SurfaceNodeT, type XY } from "./build.ts";
import { SurfaceNode } from "./SurfaceNode.tsx";
import { GroupCard, RegionLabel, RegionNode, groupHue, type GroupData } from "./GroupNodes.tsx";
import { REGION_HEAD, REGION_PAD, UNGROUPED, clusterLinks, clusterStats, clusters, flowOrder } from "./groups.ts";
import { CompactContext, UIContext } from "../ui/context.ts";
import type { Plan } from "../model/plan.ts";
import type { Issue } from "../model/lint.ts";

const nodeTypes = { surface: SurfaceNode, region: RegionNode, regionLabel: RegionLabel, groupCard: GroupCard };
const CARD_W = 300, CARD_H = 190;

/**
 * On large plans, below this zoom node details are too small to read: draw compact nodes and
 * unlabeled, bundled edges. Small plans are cheap to draw, so they always show full detail.
 */
const DETAIL_ZOOM = 0.55;
const LARGE_PLAN_SURFACES = 30;

interface Props {
  plan: Plan;
  positions: Record<string, XY>;
  onMoved: (id: string, pos: XY) => void;
  showCalls: boolean;
  onConnect: (sourceSurface: string, sourceHandle: string, targetSurface: string) => void;
  onRetarget: (outcomeId: string, targetSurface: string) => void;
  /** Show the group map (one card per group) instead of individual surfaces. */
  overview: boolean;
  issues: Issue[];
}

export function Canvas({ plan, positions, onMoved, showCalls, onConnect, onRetarget, overview, issues }: Props) {
  const ui = useContext(UIContext);
  // Build synchronously so the first render has nodes (React Flow's fitView only fits initial nodes).
  const [nodes, setNodes] = useState<SurfaceNodeT[]>(() => buildNodes(plan, positions));

  // Rebuild nodes when the plan or stored positions change, keeping React Flow's measurements.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return buildNodes(plan, positions).map((n) => {
        const p = byId.get(n.id);
        return p ? { ...n, measured: p.measured, selected: p.selected } : n;
      });
    });
  }, [plan, positions]);

  // Fit once, after React Flow has measured the nodes (robust to slow first paint).
  const rf = useReactFlow();
  const initialized = useNodesInitialized();
  const didFit = useRef(false);
  useEffect(() => {
    const fit = () => { if (!didFit.current) { didFit.current = true; rf.fitView({ padding: 0.15 }); } };
    if (initialized) fit();
    // Off-screen nodes are never measured (onlyRenderVisibleElements), so don't wait forever.
    const t = setTimeout(fit, 350);
    return () => clearTimeout(t);
  }, [initialized, rf]);

  // Selector returns a boolean, so this re-renders only when the zoom crosses the threshold.
  const zoomedOut = useStore((s) => s.transform[2] < DETAIL_ZOOM);
  const compact = zoomedOut && plan.surfaces.length > LARGE_PLAN_SURFACES;
  const edges = useMemo(() => buildEdges(plan, ui.index, ui.selected, showCalls, !compact), [plan, ui.index, ui.selected, showCalls, compact]);

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    // Region and group-map nodes are derived; only surface nodes carry state.
    const mine = changes.filter((c) => !("id" in c) || !(c.id.startsWith("region:") || c.id.startsWith("rlabel:") || c.id.startsWith("card:")));
    if (mine.length) setNodes((nds) => applyNodeChanges(mine as NodeChange<SurfaceNodeT>[], nds));
  }, []);

  // ── groups ──
  const groupList = useMemo(() => clusters(plan), [plan]);
  const hues = useMemo(() => new Map(groupList.map((c, i) => [c.id, groupHue(i)])), [groupList]);
  const stats = useMemo(() => clusterStats(plan, ui.index, issues), [plan, ui.index, issues]);

  // A labelled region behind each group, sized to its surfaces as they are laid out and measured.
  const regions = useMemo(() => {
    if (overview) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: Node<GroupData>[] = [];
    for (const c of groupList) {
      if (c.id === UNGROUPED) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const sid of c.surfaces) {
        const n = byId.get(sid);
        if (!n) continue;
        const w = n.measured?.width ?? 280, h = n.measured?.height ?? 160;
        x0 = Math.min(x0, n.position.x); y0 = Math.min(y0, n.position.y);
        x1 = Math.max(x1, n.position.x + w); y1 = Math.max(y1, n.position.y + h);
      }
      if (!Number.isFinite(x0)) continue;
      const width = x1 - x0 + 2 * REGION_PAD, height = y1 - y0 + REGION_HEAD + REGION_PAD;
      out.push({
        id: `region:${c.id}`, type: "region",
        position: { x: x0 - REGION_PAD, y: y0 - REGION_HEAD },
        width, height, style: { width, height },
        zIndex: -1, draggable: false, selectable: false, focusable: false,
        data: { cluster: c, stats: stats.get(c.id)!, hue: hues.get(c.id)! },
      });
      out.push({
        id: `rlabel:${c.id}`, type: "regionLabel",
        position: { x: x0 - REGION_PAD, y: y0 - REGION_HEAD },
        zIndex: 1000, draggable: false, selectable: false, focusable: false,
        data: { cluster: c, stats: stats.get(c.id)!, hue: hues.get(c.id)!, regionWidth: width },
      });
    }
    return out;
  }, [overview, nodes, groupList, stats, hues]);

  // The group map: one card per group, edges summarising how groups connect.
  const map = useMemo(() => {
    if (!overview) return null;
    const links = clusterLinks(plan, ui.index);
    // Cards in a grid, in flow order (groups that lead to others first), so the map fits on screen.
    const order = flowOrder(
      groupList.map((c) => ({ id: c.id, w: CARD_W, h: CARD_H })),
      new Map(links.map((l) => [`${l.source}\u0000${l.target}`, l.outcomes + l.calls])),
    );
    const cols = Math.max(2, Math.ceil(Math.sqrt(groupList.length / 1.4)));
    const byId = new Map(groupList.map((c) => [c.id, c]));
    const cards: Node<GroupData>[] = order.map((id, i) => {
      const c = byId.get(id)!;
      return {
        id: `card:${c.id}`, type: "groupCard", position: { x: (i % cols) * (CARD_W + 90), y: Math.floor(i / cols) * (CARD_H + 80) },
        style: { width: CARD_W }, draggable: false, selectable: false,
        data: { cluster: c, stats: stats.get(c.id)!, hue: hues.get(c.id)! },
      };
    });
    const links2: Edge[] = links
      .filter((l) => l.outcomes || (showCalls && l.calls))
      .map((l) => {
        const parts = [l.outcomes ? `${l.outcomes} path${l.outcomes === 1 ? "" : "s"}` : "", showCalls && l.calls ? `${l.calls} call${l.calls === 1 ? "" : "s"}` : ""].filter(Boolean);
        const n = l.outcomes + (showCalls ? l.calls : 0);
        return {
          id: `link:${l.source}->${l.target}`, source: `card:${l.source}`, sourceHandle: "out", target: `card:${l.target}`, targetHandle: "in",
          label: parts.join(" · "), className: l.outcomes ? "edge-link" : "edge-link edge-call",
          style: { strokeWidth: Math.min(6, 1.4 + Math.log2(n)) },
          labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          reconnectable: false, selectable: false,
        };
      });
    return { cards, links: links2 };
  }, [overview, plan, ui.index, groupList, stats, hues, showCalls]);

  // Fit the view whenever the map is shown.
  useEffect(() => {
    if (overview) setTimeout(() => rf.fitView({ padding: 0.12, duration: 300 }), 30);
  }, [overview, rf]);

  const handleConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.sourceHandle) onConnect(c.source, c.sourceHandle, c.target);
    },
    [onConnect],
  );

  /** React Flow only connects when released on a handle; also accept a release anywhere on a surface. */
  const surfaceUnderPointer = (event: MouseEvent | TouchEvent): string | null => {
    const pt = "changedTouches" in event ? event.changedTouches[0] : event;
    const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest(".react-flow__node");
    return el?.getAttribute("data-id") ?? null;
  };

  // React Flow also fires onConnectEnd when a reconnect (edge drag) ends; don't treat that as a new connection.
  const reconnecting = useRef(false);

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (reconnecting.current || state.isValid || !state.fromNode || !state.fromHandle?.id) return;
      const target = surfaceUnderPointer(event);
      if (target) onConnect(state.fromNode.id, state.fromHandle.id, target);
    },
    [onConnect],
  );

  const handleReconnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, edge: Edge<EdgeData>, _type: unknown, state: FinalConnectionState) => {
      setTimeout(() => { reconnecting.current = false; }, 0); // after any onConnectEnd for this gesture
      if (state.isValid || edge.data?.kind !== "outcome" || !edge.data.outcomeId) return;
      const target = surfaceUnderPointer(event);
      if (target && target !== edge.target) onRetarget(edge.data.outcomeId, target);
    },
    [onRetarget],
  );

  const handleReconnect: OnReconnect<Edge<EdgeData>> = useCallback(
    (old, c) => {
      if (old.data?.kind === "outcome" && old.data.outcomeId && c.target && c.target !== old.target) {
        onRetarget(old.data.outcomeId, c.target);
      }
    },
    [onRetarget],
  );

  return (
    <CompactContext.Provider value={compact}>
    <ReactFlow<Node, Edge>
      nodes={map ? map.cards : [...regions, ...nodes]}
      edges={map ? map.links : edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_e, n) => { if (n.type === "surface") onMoved(n.id, n.position); }}
      onConnect={handleConnect}
      onConnectEnd={handleConnectEnd}
      onReconnect={handleReconnect as unknown as OnReconnect<Edge>}
      onReconnectStart={() => { reconnecting.current = true; }}
      onReconnectEnd={handleReconnectEnd as unknown as (e: MouseEvent | TouchEvent, edge: Edge, t: unknown, s: FinalConnectionState) => void}
      edgesReconnectable
      onEdgeClick={(_e, edge) => {
        const d = edge.data as EdgeData | undefined;
        if (d) ui.select(d.kind === "outcome" ? d.outcomeId! : d.interactionId);
      }}
      onPaneClick={() => ui.select(null)}
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      minZoom={0.04}
      maxZoom={1.75}
      colorMode="system"
      onlyRenderVisibleElements
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={3} className="minimap" />
    </ReactFlow>
    </CompactContext.Provider>
  );
}
