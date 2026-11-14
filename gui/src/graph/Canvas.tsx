import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, Controls, MiniMap, ReactFlow, applyNodeChanges, useNodesInitialized, useReactFlow,
  type Connection, type Edge, type FinalConnectionState, type NodeChange, type OnConnectEnd, type OnReconnect,
} from "@xyflow/react";
import { buildEdges, buildNodes, type EdgeData, type SurfaceNodeT, type XY } from "./build.ts";
import { SurfaceNode } from "./SurfaceNode.tsx";
import { UIContext } from "../ui/context.ts";
import type { Plan } from "../model/plan.ts";

const nodeTypes = { surface: SurfaceNode };

interface Props {
  plan: Plan;
  positions: Record<string, XY>;
  onMoved: (id: string, pos: XY) => void;
  showCalls: boolean;
  onConnect: (sourceSurface: string, sourceHandle: string, targetSurface: string) => void;
  onRetarget: (outcomeId: string, targetSurface: string) => void;
}

export function Canvas({ plan, positions, onMoved, showCalls, onConnect, onRetarget }: Props) {
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
    if (initialized && !didFit.current) {
      didFit.current = true;
      rf.fitView({ padding: 0.15 });
    }
  }, [initialized, rf]);

  const edges = useMemo(() => buildEdges(plan, ui.index, ui.selected, showCalls), [plan, ui.index, ui.selected, showCalls]);

  const onNodesChange = useCallback((changes: NodeChange<SurfaceNodeT>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

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
    <ReactFlow<SurfaceNodeT, Edge<EdgeData>>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_e, n) => onMoved(n.id, n.position)}
      onConnect={handleConnect}
      onConnectEnd={handleConnectEnd}
      onReconnect={handleReconnect}
      onReconnectStart={() => { reconnecting.current = true; }}
      onReconnectEnd={handleReconnectEnd}
      edgesReconnectable
      onEdgeClick={(_e, edge) => ui.select(edge.data?.kind === "outcome" ? edge.data.outcomeId! : edge.data!.interactionId)}
      onPaneClick={() => ui.select(null)}
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      minZoom={0.15}
      maxZoom={1.75}
      colorMode="system"
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={3} className="minimap" />
    </ReactFlow>
  );
}
