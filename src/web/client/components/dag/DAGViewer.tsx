import { useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  MarkerType,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import {
  Wrench,
  CheckCircle,
  Loader2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface DAGNode {
  id: string;
  type?: 'task';
  data: {
    label: string;
    arguments?: any;
    status?: string;
    timestamp?: string;
  };
  position?: { x: number; y: number };
}

interface DAGEdge {
  id: string;
  source: string;
  target: string;
}

interface DAGViewerProps {
  nodes: DAGNode[];
  edges: DAGEdge[];
}

const nodeWidth = 200;
const nodeHeight = 80;

// Auto-layout nodes using Dagre
const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  // Create a new dagre instance for each layout to avoid memory leaks and race conditions
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: 'LR', // Left to right layout
    nodesep: 100,
    ranksep: 150,
    marginx: 50,
    marginy: 50,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// Custom Task Node Component
function TaskNode({ data, id }: { data: any; id: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusConfig = {
    completed: { icon: CheckCircle, color: 'text-green-500', bg: 'border-green-500' },
    failed: { icon: XCircle, color: 'text-red-500', bg: 'border-red-500' },
    running: { icon: Loader2, color: 'text-blue-500', bg: 'border-blue-500', animate: true },
    pending: { icon: Clock, color: 'text-yellow-500', bg: 'border-yellow-500' },
  };

  const config = statusConfig[data.status as keyof typeof statusConfig] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div
      className={`bg-white border-2 rounded-lg shadow-lg min-w-[200px] ${config.bg} transition-all hover:shadow-xl`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Wrench className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-900 truncate">
              {data.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon
              className={`w-4 h-4 ${config.color} ${config.animate ? 'animate-spin' : ''}`}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-2">
        {data.timestamp && (
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
            <Clock className="w-3 h-3" />
            {new Date(data.timestamp).toLocaleTimeString()}
          </div>
        )}

        {data.arguments && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-between w-full text-xs text-gray-600 hover:text-gray-900"
          >
            <span className="font-medium">Arguments</span>
            {isExpanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        )}

        {isExpanded && data.arguments && (
          <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto">
            {JSON.stringify(data.arguments, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  task: TaskNode,
};

export default function DAGViewer({ nodes: initialNodes, edges: initialEdges }: DAGViewerProps) {
  console.log('[DAGViewer] Render with:', {
    nodesCount: initialNodes?.length || 0,
    edgesCount: initialEdges?.length || 0,
    firstNode: initialNodes?.[0]?.id,
  });

  // Convert to React Flow format and apply layout in a single computation
  const { nodes, edges } = useMemo(() => {
    console.log('[DAGViewer] Computing layout...');
    if (!initialNodes || initialNodes.length === 0) {
      console.log('[DAGViewer] Empty nodes, returning empty arrays');
      return { nodes: [], edges: [] };
    }

    const nodes: Node[] = initialNodes.map((node) => ({
      id: node.id,
      type: 'task',
      position: node.position || { x: 0, y: 0 },
      data: node.data,
    }));

    const edges: Edge[] = initialEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#3b82f6',
      },
      style: {
        stroke: '#3b82f6',
        strokeWidth: 2,
      },
    }));

    const layouted = getLayoutedElements(nodes, edges);
    console.log('[DAGViewer] Layout complete:', {
      nodesCount: layouted.nodes.length,
      edgesCount: layouted.edges.length,
    });
    return layouted;
  }, [initialNodes, initialEdges]);

  console.log('[DAGViewer] After useMemo:', {
    nodesReady: nodes.length,
    edgesReady: edges.length,
  });

  // Empty state
  if (!initialNodes || initialNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <Wrench className="w-16 h-16 mb-4 text-gray-300" />
        <p className="text-lg font-medium">No DAG data available</p>
        <p className="text-sm mt-1 text-gray-400">This session has no tool executions</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background color="#e2e8f0" gap={16} />

        {/* Default Controls */}
        <Controls
          className="bg-white border rounded-lg shadow-lg"
          showZoom={true}
          showFitView={true}
          showInteractive={true}
        />

        {/* MiniMap */}
        <MiniMap
          nodeColor={(node) => {
            if (node.data.status === 'completed') return '#10b981';
            if (node.data.status === 'failed') return '#ef4444';
            return '#3b82f6';
          }}
          maskColor="rgba(0, 0, 0, 0.05)"
          className="bg-white border rounded-lg shadow-lg"
          style={{ background: 'white' }}
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3 text-xs">
        <div className="font-semibold mb-2 text-gray-700">Status Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-3 h-3 text-green-500" />
            <span>Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="w-3 h-3 text-red-500" />
            <span>Failed</span>
          </div>
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 text-blue-500" />
            <span>Running</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-yellow-500" />
            <span>Pending</span>
          </div>
        </div>
      </div>
    </div>
  );
}
