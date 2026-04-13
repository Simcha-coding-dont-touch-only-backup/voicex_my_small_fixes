import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Phone, MessageSquare, Keyboard, Zap, GitBranch,
  PhoneOff, ArrowRight, Menu, ChevronRight, ChevronDown,
  CornerDownRight, RotateCcw, Hash, ChevronsDown,
} from 'lucide-react';

function Tooltip({ text, anchorRef }: { text: string; anchorRef: React.RefObject<HTMLSpanElement | null> }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tooltipW = 224;
    let left = rect.right - tooltipW;
    if (left < 8) left = 8;
    if (left + tooltipW > window.innerWidth - 8) left = window.innerWidth - tooltipW - 8;
    setPos({ top: rect.bottom + 6, left });
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[9999] w-56 rounded-lg bg-gray-900 text-white text-sm leading-relaxed p-3 shadow-lg whitespace-normal break-words pointer-events-none"
    >
      {text}
    </div>,
    document.body,
  );
}

function PromptTextWithTooltip({ text }: { text: string }) {
  const [hovered, setHovered] = useState(false);
  const spanRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={spanRef}
      className="text-[11px] text-black truncate ml-auto max-w-[30%]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {text.slice(0, 80)}
      {text.length > 80 ? '...' : ''}
      {hovered && <Tooltip text={text} anchorRef={spanRef} />}
    </span>
  );
}

interface IvrNodeData {
  id: string;
  node_key: string;
  node_type: string;
  handler_name: string | null;
  prompt_text: string | null;
  config: any;
  position_x: number;
  position_y: number;
  flow_version_id: string;
}

interface IvrEdgeData {
  id: string;
  source_node_id: string;
  target_node_id: string;
  condition_type: string;
  condition_value: string | null;
  priority: number;
  flow_version_id: string;
}

interface IvrRowViewProps {
  nodes: IvrNodeData[];
  edges: IvrEdgeData[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
}

const NODE_ICONS: Record<string, { icon: typeof Phone; color: string; bg: string }> = {
  entry:    { icon: Phone,          color: 'text-gray-600',   bg: 'bg-gray-100' },
  menu:     { icon: Menu,           color: 'text-blue-600',   bg: 'bg-blue-50' },
  input:    { icon: Keyboard,       color: 'text-green-600',  bg: 'bg-green-50' },
  action:   { icon: Zap,            color: 'text-orange-600', bg: 'bg-orange-50' },
  branch:   { icon: GitBranch,      color: 'text-purple-600', bg: 'bg-purple-50' },
  hangup:   { icon: PhoneOff,       color: 'text-red-600',    bg: 'bg-red-50' },
  submenu:  { icon: ArrowRight,     color: 'text-indigo-600', bg: 'bg-indigo-50' },
  transfer: { icon: MessageSquare,  color: 'text-yellow-600', bg: 'bg-yellow-50' },
};

function NodeRow({
  node,
  edges,
  nodeMap,
  edgesBySource,
  depth,
  visited,
  expanded,
  toggleExpand,
  selectedNodeId,
  selectedEdgeId,
  onNodeClick,
  onEdgeClick,
}: {
  node: IvrNodeData;
  edges: IvrEdgeData[];
  nodeMap: Map<string, IvrNodeData>;
  edgesBySource: Map<string, IvrEdgeData[]>;
  depth: number;
  visited: Set<string>;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
}) {
  const outgoing = edgesBySource.get(node.id) || [];
  const hasChildren = outgoing.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedNodeId === node.id;

  const style = NODE_ICONS[node.node_type] || NODE_ICONS.menu;
  const Icon = style.icon;

  return (
    <div>
      {/* Node row */}
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 transition-colors ${
          isSelected
            ? 'bg-indigo-50 border-l-indigo-500'
            : 'border-l-transparent hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => onNodeClick(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(node.id);
            }}
            className="shrink-0 rounded p-0.5 hover:bg-gray-200 text-gray-400"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}

        <span className={`shrink-0 rounded p-1 ${style.bg}`}>
          <Icon size={14} className={style.color} />
        </span>

        <span className="font-mono text-sm font-semibold text-gray-800 truncate">
          {node.node_key}
        </span>

        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          {node.node_type}
        </span>

        {node.handler_name && (
          <span className="text-[11px] font-mono text-indigo-500 truncate">
            {node.handler_name}
          </span>
        )}

        {node.prompt_text && (
          <PromptTextWithTooltip text={node.prompt_text} />
        )}
      </div>

      {/* Expanded children: edges + target nodes */}
      {isExpanded && outgoing.map((edge) => {
        const target = nodeMap.get(edge.target_node_id);
        const isCycle = visited.has(edge.target_node_id);
        const isEdgeSelected = selectedEdgeId === edge.id;

        const dtmfKey = edge.condition_type === 'intent' && edge.condition_value
          ? (node.config?.intents as Array<{ name: string; dtmf_key?: string }> | undefined)
              ?.find((i) => i.name === edge.condition_value)?.dtmf_key
          : undefined;

        return (
          <div key={edge.id}>
            {/* Edge row */}
            <div
              className={`flex items-center gap-2 py-1.5 cursor-pointer border-l-2 transition-colors ${
                isEdgeSelected
                  ? 'bg-indigo-50/60 border-l-indigo-400'
                  : 'border-l-transparent hover:bg-gray-50'
              }`}
              style={{ paddingLeft: `${(depth + 1) * 24 + 12}px` }}
              onClick={() => onEdgeClick(edge.id)}
            >
              <CornerDownRight size={12} className="shrink-0 text-gray-300" />
              {dtmfKey && (
                <span className="inline-flex items-center gap-0.5 shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 font-mono tabular-nums">
                  <Hash size={10} className="text-emerald-500" />
                  {dtmfKey}
                </span>
              )}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                edge.condition_type === 'intent' ? 'bg-blue-100 text-blue-700'
                : edge.condition_type === 'timeout' ? 'bg-amber-100 text-amber-700'
                : edge.condition_type === 'error' ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600'
              }`}>
                {edge.condition_type}
              </span>
              {edge.condition_value && (
                <span className="text-xs font-mono text-gray-600">
                  {edge.condition_value}
                </span>
              )}
              {target && (
                <span className="text-[11px] text-gray-400">
                  → {target.node_key}
                </span>
              )}
            </div>

            {/* Target node (recursive, or cycle indicator) */}
            {target && !isCycle && (
              <NodeRow
                node={target}
                edges={edges}
                nodeMap={nodeMap}
                edgesBySource={edgesBySource}
                depth={depth + 2}
                visited={new Set([...visited, node.id])}
                expanded={expanded}
                toggleExpand={toggleExpand}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
              />
            )}
            {target && isCycle && (
              <div
                className="flex items-center gap-2 py-1.5 text-xs text-gray-400 italic"
                style={{ paddingLeft: `${(depth + 2) * 24 + 12}px` }}
              >
                <RotateCcw size={12} />
                loops back to {target.node_key}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function IvrRowView({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onNodeClick,
  onEdgeClick,
}: IvrRowViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const didAutoExpand = useRef(false);

  useEffect(() => {
    if (didAutoExpand.current || nodes.length === 0) return;
    const entry = nodes.find((n) => n.node_type === 'entry');
    if (!entry) return;
    didAutoExpand.current = true;
    const ids = [entry.id];
    for (const e of edges) {
      if (e.source_node_id === entry.id) ids.push(e.target_node_id);
    }
    setExpanded(new Set(ids));
  }, [nodes, edges]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(nodes.map((n) => n.id)));
  }, [nodes]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, IvrNodeData>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const edgesBySource = useMemo(() => {
    const m = new Map<string, IvrEdgeData[]>();
    for (const e of edges) {
      const arr = m.get(e.source_node_id) || [];
      arr.push(e);
      m.set(e.source_node_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.priority - b.priority);
    return m;
  }, [edges]);

  const entryNodes = useMemo(
    () => nodes.filter((n) => n.node_type === 'entry'),
    [nodes],
  );

  const orphanNodes = useMemo(() => {
    const targetIds = new Set(edges.map((e) => e.target_node_id));
    return nodes.filter(
      (n) => n.node_type !== 'entry' && !targetIds.has(n.id),
    );
  }, [nodes, edges]);

  const roots = useMemo(
    () => [...entryNodes, ...orphanNodes],
    [entryNodes, orphanNodes],
  );

  const allExpanded = nodes.length > 0 && nodes.every((n) => expanded.has(n.id));

  return (
    <div className="h-full overflow-y-auto bg-white">
      {roots.length > 0 && (
        <div className="flex items-center justify-end px-3 pt-2">
          <button
            onClick={expandAll}
            disabled={allExpanded}
            className="flex items-center gap-1 rounded border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-default"
          >
            <ChevronsDown size={14} /> Expand All
          </button>
        </div>
      )}
      <div className="py-2 divide-y divide-gray-100">
        {roots.length === 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">
            No nodes in this flow version.
          </div>
        )}
        {roots.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            edges={edges}
            nodeMap={nodeMap}
            edgesBySource={edgesBySource}
            depth={0}
            visited={new Set<string>()}
            expanded={expanded}
            toggleExpand={toggleExpand}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
          />
        ))}
      </div>
    </div>
  );
}
