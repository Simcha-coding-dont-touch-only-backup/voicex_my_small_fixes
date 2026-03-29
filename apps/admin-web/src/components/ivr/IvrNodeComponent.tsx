import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Phone, MessageSquare, Keyboard, Zap, GitBranch, PhoneOff, ArrowRight, Menu } from 'lucide-react';

const NODE_STYLES: Record<string, { bg: string; border: string; icon: typeof Phone }> = {
  entry: { bg: 'bg-gray-50', border: 'border-gray-300', icon: Phone },
  menu: { bg: 'bg-blue-50', border: 'border-blue-400', icon: Menu },
  input: { bg: 'bg-green-50', border: 'border-green-400', icon: Keyboard },
  action: { bg: 'bg-orange-50', border: 'border-orange-400', icon: Zap },
  branch: { bg: 'bg-purple-50', border: 'border-purple-400', icon: GitBranch },
  hangup: { bg: 'bg-red-50', border: 'border-red-400', icon: PhoneOff },
  submenu: { bg: 'bg-indigo-50', border: 'border-indigo-400', icon: ArrowRight },
  transfer: { bg: 'bg-yellow-50', border: 'border-yellow-400', icon: MessageSquare },
};

function IvrNodeComponent({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const nodeType = (data.node_type as string) || 'menu';
  const style = NODE_STYLES[nodeType] || NODE_STYLES.menu;
  const Icon = style.icon;

  return (
    <div
      className={`rounded-lg border-2 ${style.bg} ${style.border} ${
        selected ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
      } min-w-[200px] max-w-[280px] shadow-sm`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3" />

      <div className="px-3 py-2 border-b border-gray-200/50">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-gray-500 shrink-0" />
          <span className="text-xs font-semibold text-gray-700 truncate">{data.node_key as string}</span>
          <span className="ml-auto text-[10px] rounded bg-white/70 px-1.5 py-0.5 text-gray-500 font-medium">
            {nodeType}
          </span>
        </div>
      </div>

      <div className="px-3 py-2">
        {data.handler_name ? (
          <div className="text-[10px] text-indigo-600 font-mono mb-1 truncate">
            {String(data.handler_name)}
          </div>
        ) : null}
        <p className="text-[11px] text-gray-600 line-clamp-3 leading-tight">
          {(data.prompt_text as string)?.slice(0, 120) || 'No prompt'}
          {(data.prompt_text as string)?.length > 120 ? '...' : ''}
        </p>
      </div>

      {Number(data.intents_count) > 0 ? (
        <div className="px-3 pb-2">
          <span className="text-[10px] text-gray-400">
            {Number(data.intents_count)} intent{Number(data.intents_count) !== 1 ? 's' : ''}
          </span>
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}

export default memo(IvrNodeComponent);
