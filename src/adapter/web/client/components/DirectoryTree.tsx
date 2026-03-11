import { useState } from 'react';
import { Folder, File, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';

interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

interface DirectoryTreeProps {
  node: TreeNode;
  level: number;
  selectedPath: string | null;
  onSelect: (path: string, type: 'file' | 'directory') => void;
  onLoadChildren: (path: string) => Promise<TreeNode[]>;
}

function DirectoryTreeNode({ node, level, selectedPath, onSelect, onLoadChildren }: DirectoryTreeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedChildren, setHasLoadedChildren] = useState(false);

  const isDirectory = node.type === 'directory';
  const isSelected = selectedPath === node.path;

  const handleToggle = async () => {
    if (!isDirectory) return;

    if (!hasLoadedChildren) {
      setIsLoading(true);
      try {
        const loadedChildren = await onLoadChildren(node.path);
        setChildren(loadedChildren);
        setHasLoadedChildren(true);
      } catch (error) {
        console.error('Failed to load children:', error);
      } finally {
        setIsLoading(false);
      }
    }

    setIsExpanded(!isExpanded);
  };

  const handleClick = () => {
    onSelect(node.path, node.type);
    if (isDirectory && !isExpanded) {
      handleToggle();
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 hover:bg-gray-100 cursor-pointer ${
          isSelected ? 'bg-blue-50 text-blue-600' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {isDirectory && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggle();
            }}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
            ) : isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-500" />
            )}
          </button>
        )}
        {!isDirectory && <div className="w-4" />}

        {isDirectory ? (
          <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
        ) : (
          <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}

        <span className="text-sm truncate">{node.name}</span>
      </div>

      {isDirectory && isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <DirectoryTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onLoadChildren={onLoadChildren}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DirectoryTreePropsRoot {
  rootPath?: string;
  selectedPath: string | null;
  onSelect: (path: string, type: 'file' | 'directory') => void;
}

export default function DirectoryTree({ rootPath = '', selectedPath, onSelect }: DirectoryTreePropsRoot) {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadChildren = async (path: string): Promise<TreeNode[]> => {
    const response = await fetch(`/api/memory?path=${encodeURIComponent(path)}`);
    if (!response.ok) return [];

    const data = await response.json();

    if (data.type === 'directory' && data.entries) {
      return data.entries.map((entry: any) => ({
        path: entry.path,
        name: entry.path.split('/').pop() || entry.path,
        type: entry.type,
      }));
    }

    return [];
  };

  // Load root nodes on mount
  useState(() => {
    const loadRootNodes = async () => {
      setIsLoading(true);
      try {
        const nodes = await loadChildren(rootPath);
        setRootNodes(nodes);
      } catch (error) {
        console.error('Failed to load root nodes:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadRootNodes();
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="py-1">
      {rootNodes.map((node) => (
        <DirectoryTreeNode
          key={node.path}
          node={node}
          level={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onLoadChildren={loadChildren}
        />
      ))}
    </div>
  );
}
