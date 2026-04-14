import { useState, useMemo } from 'react';
import {
  Phone, MessageSquare, Keyboard, Zap, GitBranch,
  PhoneOff, ArrowRight, Menu, Search, Filter,
} from 'lucide-react';

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

interface IvrListViewProps {
  nodes: IvrNodeData[];
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
}

const NODE_TYPES = ['entry', 'menu', 'input', 'action', 'branch', 'hangup', 'submenu', 'transfer'] as const;

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

export default function IvrListView({ nodes, selectedNodeId, onNodeClick }: IvrListViewProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return nodes.filter((n) => {
      if (typeFilter && n.node_type !== typeFilter) return false;
      if (!q) return true;
      return (
        n.node_key.toLowerCase().includes(q) ||
        n.node_type.toLowerCase().includes(q) ||
        (n.handler_name || '').toLowerCase().includes(q) ||
        (n.prompt_text || '').toLowerCase().includes(q)
      );
    });
  }, [nodes, search, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      counts[n.node_type] = (counts[n.node_type] || 0) + 1;
    }
    return counts;
  }, [nodes]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Search + Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes by key, type, handler, or prompt..."
            className="w-full rounded-lg border pl-8 pr-3 py-1.5 text-sm focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border pl-8 pr-8 py-1.5 text-sm appearance-none bg-white cursor-pointer focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 outline-none"
          >
            <option value="">All types ({nodes.length})</option>
            {NODE_TYPES.filter((t) => typeCounts[t]).map((t) => (
              <option key={t} value={t}>{t} ({typeCounts[t]})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results count */}
      <div className="px-3 py-1.5 text-[11px] text-gray-400 border-b bg-gray-50/50">
        {filtered.length} of {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        {(search || typeFilter) && ' matching'}
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-400 text-sm">
            {nodes.length === 0 ? 'No nodes in this flow version.' : 'No nodes match your search.'}
          </div>
        )}
        <div className="divide-y divide-gray-100">
          {filtered.map((node) => {
            const style = NODE_ICONS[node.node_type] || NODE_ICONS.menu;
            const Icon = style.icon;
            const isSelected = selectedNodeId === node.id;
            const numDigits = node.config?.num_digits;
            const timeout = node.config?.timeout_seconds;
            const intentsCount = node.config?.intents?.length || 0;

            return (
              <div
                key={node.id}
                onClick={() => onNodeClick(node.id)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-l-2 transition-colors ${
                  isSelected
                    ? 'bg-indigo-50 border-l-indigo-500'
                    : 'border-l-transparent hover:bg-gray-50'
                }`}
              >
                <span className={`shrink-0 rounded-lg p-1.5 ${style.bg}`}>
                  <Icon size={16} className={style.color} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-800 truncate">
                      {node.node_key}
                    </span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                      {node.node_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {node.handler_name && (
                      <span className="text-[11px] font-mono text-indigo-500 truncate">
                        {node.handler_name}
                      </span>
                    )}
                    {node.prompt_text && (
                      <span className="text-[11px] text-gray-400 truncate">
                        {node.prompt_text.slice(0, 60)}{node.prompt_text.length > 60 ? '...' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick config badges */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {numDigits && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
                      {numDigits}d
                    </span>
                  )}
                  {timeout && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
                      {timeout}s
                    </span>
                  )}
                  {intentsCount > 0 && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-mono text-blue-500">
                      {intentsCount} intent{intentsCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
