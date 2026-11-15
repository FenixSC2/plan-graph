// Group visuals: a labelled region drawn behind each group's surfaces, and the group cards
// used by the group map (one card per group, linked by how the groups connect).
import { memo, useContext } from "react";
import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { UIContext } from "../ui/context.ts";
import type { Cluster, ClusterStats } from "./groups.ts";

export const groupHue = (i: number) => (i * 137.5 + 210) % 360;

export interface GroupData extends Record<string, unknown> {
  cluster: Cluster;
  stats: ClusterStats;
  hue: number;
}

export type RegionNodeT = Node<GroupData, "region">;
export type RegionLabelT = Node<GroupData & { regionWidth: number }, "regionLabel">;
export type GroupCardT = Node<GroupData, "groupCard">;

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const summary = (st: ClusterStats) => [plural(st.surfaces, "surface"), plural(st.actions, "action"), plural(st.outcomes, "outcome")];

/** Tinted region behind a group's surfaces. */
function RegionNodeImpl({ data }: NodeProps<RegionNodeT>) {
  return <div className="region" style={{ "--g": `${data.hue}` } as React.CSSProperties} />;
}
export const RegionNode = memo(RegionNodeImpl);

/**
 * A group's title, drawn above the surfaces (its own layer) so nothing covers it. It scales up
 * as you zoom out so the map stays legible, but never grows wider than its region.
 */
function RegionLabelImpl({ data }: NodeProps<RegionLabelT>) {
  const ui = useContext(UIContext);
  const zoom = useStore((s) => s.transform[2]);
  const { cluster, stats, hue, regionWidth } = data;
  const fit = (regionWidth * 0.95) / Math.max(5, cluster.name.length * 0.6);
  const font = Math.max(16, Math.min(16 / zoom, fit));
  const far = zoom < 0.3;
  return (
    <button
      className={`region-head${far ? " far" : ""}`}
      style={{ fontSize: font, maxWidth: regionWidth, "--g": `${hue}` } as React.CSSProperties}
      onClick={(e) => { e.stopPropagation(); ui.openGroup?.(cluster.id); }}
      title={cluster.description ? `${cluster.description}\n\nClick to zoom to this group` : "Click to zoom to this group"}
    >
      <span className="region-name">{cluster.name}</span>
      {!far && <span className="region-meta">{summary(stats).join(" · ")}</span>}
      {!far && stats.unreviewed > 0 && <span className="region-todo">{stats.unreviewed} to review</span>}
      {!far && stats.problems > 0 && <span className="region-warn">{plural(stats.problems, "issue")}</span>}
    </button>
  );
}
export const RegionLabel = memo(RegionLabelImpl);

/** One group in the group map. */
function GroupCardImpl({ data }: NodeProps<GroupCardT>) {
  const ui = useContext(UIContext);
  const { cluster, stats, hue } = data;
  const reviewedPct = stats.items ? Math.round(100 * (1 - stats.unreviewed / stats.items)) : 100;
  return (
    <div className="gcard" style={{ "--g": `${hue}` } as React.CSSProperties} onClick={() => ui.openGroup?.(cluster.id)} title="Open this group">
      <Handle type="target" id="in" position={Position.Left} className="gcard-handle" isConnectable={false} />
      <div className="gcard-name">{cluster.name}</div>
      {cluster.description && <div className="gcard-desc">{cluster.description}</div>}
      <div className="gcard-profiles">
        {Object.entries(stats.profiles).map(([p, n]) => (
          <span key={p} className={`ptag gp-${p}`}>{p} {n}</span>
        ))}
      </div>
      <div className="gcard-counts">{summary(stats).join(" · ")}</div>
      <div className="gcard-flags">
        {stats.sketches > 0 && <span className="gflag gflag-sketch">{plural(stats.sketches, "sketch", "sketches")}</span>}
        {stats.openDecisions > 0 && <span className="gflag gflag-todo">{plural(stats.openDecisions, "open decision")}</span>}
        {stats.problems > 0 && <span className="gflag gflag-warn">{plural(stats.problems, "issue")}</span>}
      </div>
      <div className="gcard-progress" title={`${stats.unreviewed} item(s) not yet reviewed`}>
        <div style={{ width: `${reviewedPct}%` }} />
        <span>{stats.unreviewed ? `${stats.unreviewed} to review` : "all reviewed"}</span>
      </div>
      <Handle type="source" id="out" position={Position.Right} className="gcard-handle" isConnectable={false} />
    </div>
  );
}
export const GroupCard = memo(GroupCardImpl);
