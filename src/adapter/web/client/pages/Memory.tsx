import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Brain,
  Loader2,
  Calendar,
  Tag,
  File,
  Folder,
  ChevronRight,
  ChevronDown,
  Search,
  Eye,
  Code,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import Editor from '@monaco-editor/react';
import { READONLY_MONACO_OPTIONS, detectLanguageFromPath } from '../lib/editor-config';

interface MemoryEntry {
  path: string;
  category: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

interface MemoryData {
  entries: MemoryEntry[];
  byCategory: Record<string, MemoryEntry[]>;
  total: number;
}

interface MemoryDetail {
  entry: {
    path: string;
    category: string;
    content: string;
    metadata?: any;
    createdAt?: string;
    updatedAt?: string;
  };
}

interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

// Recursive tree node component
function TreeNode({
  node,
  level,
  selectedPath,
  onSelect,
  onLoadChildren
}: {
  node: TreeNode;
  level: number;
  selectedPath: string | null;
  onSelect: (path: string, type: 'file' | 'directory') => void;
  onLoadChildren: (path: string) => Promise<TreeNode[]>;
}) {
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
    if (isDirectory) {
      handleToggle();
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1 px-2 py-1 text-sm hover:bg-gray-100 rounded ${
          isSelected ? 'bg-blue-50 text-blue-600' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {isDirectory && (
          <span className="flex-shrink-0">
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
            ) : isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400" />
            )}
          </span>
        )}
        {!isDirectory && <span className="w-3" />}
        {isDirectory ? (
          <Folder className="w-3 h-3 text-blue-500 flex-shrink-0" />
        ) : (
          <File className="w-3 h-3 text-gray-400 flex-shrink-0" />
        )}
        <span className="truncate text-left flex-1">{node.name}</span>
      </button>

      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
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

export default function Memory() {
  const [search, setSearch] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [isLoadingRoot, setIsLoadingRoot] = useState(true);
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');

  // Search memory
  const { data: searchResults, isLoading: isSearching } = useQuery<MemoryData>({
    queryKey: ['memory-search', search],
    queryFn: async () => {
      if (!search.trim()) return null;
      const response = await fetch(`/api/memory?search=${encodeURIComponent(search)}`);
      if (!response.ok) throw new Error('Search failed');
      return response.json();
    },
    enabled: !!search.trim(),
  });

  // Fetch selected memory entry
  const { data: memoryDetail, isLoading: isLoadingDetail } = useQuery<MemoryDetail>({
    queryKey: ['memory-detail', selectedPath],
    queryFn: async () => {
      if (!selectedPath) return null;
      const response = await fetch(`/api/memory/${encodeURIComponent(selectedPath)}`);
      if (!response.ok) throw new Error('Failed to fetch memory detail');
      return response.json();
    },
    enabled: !!selectedPath,
  });

  // Load directory children
  const loadDirectoryChildren = async (path: string): Promise<TreeNode[]> => {
    // Remove leading slash for API call
    const apiPath = path.replace(/^\//, '');
    const response = await fetch(`/api/memory?path=${encodeURIComponent(apiPath)}`);
    if (!response.ok) throw new Error('Failed to load directory');
    const data = await response.json();

    // Transform API response to TreeNode format
    // Filter out empty directories (those with name like "(empty)" or "mpty)")
    return (data.entries || [])
      .filter((entry: any) => {
        const name = entry.path.split('/').pop() || '';
        return name && !name.includes('empty') && !name.includes('mpty)');
      })
      .map((entry: any) => ({
        path: entry.path,
        name: entry.path.split('/').pop() || entry.path,
        type: entry.type,
      }));
  };

  // Handle selection
  const handleSelect = (path: string, type: 'file' | 'directory') => {
    if (type === 'file') {
      setSelectedPath(path);
    }
  };

  // Load root nodes on mount
  useEffect(() => {
    const loadRoot = async () => {
      try {
        const response = await fetch('/api/memory');
        if (!response.ok) throw new Error('Failed to load root');
        const data = await response.json();

        // Transform API response to TreeNode format
        const nodes = (data.entries || []).map((entry: any) => ({
          path: entry.path,
          name: entry.path.replace(/^\//, '').split('/')[0] || entry.path,
          type: entry.type,
        }));

        setRootNodes(nodes);
      } catch (error) {
        console.error('Failed to load root nodes:', error);
      } finally {
        setIsLoadingRoot(false);
      }
    };

    loadRoot();
  }, []);

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <div className="w-64 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Memory Browser
          </h2>
        </div>

        {/* Search */}
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search memory..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Directory Tree or Search Results */}
        <div className="flex-1 overflow-y-auto">
          {search.trim() ? (
            // Search results
            isSearching ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : searchResults?.entries ? (
              <div className="p-2">
                {searchResults.entries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => handleSelect(entry.path, entry.type)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 rounded ${
                      selectedPath === entry.path ? 'bg-blue-50 text-blue-600' : ''
                    }`}
                  >
                    <File className="w-3 h-3 text-gray-400" />
                    <span className="truncate text-left">{entry.path}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm text-gray-500 text-center">
                No results found
              </div>
            )
          ) : (
            // Directory tree
            isLoadingRoot ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="p-2">
                {rootNodes.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    level={0}
                    selectedPath={selectedPath}
                    onSelect={handleSelect}
                    onLoadChildren={loadDirectoryChildren}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col">
        {!selectedPath ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <Brain className="w-16 h-16 mb-4 text-gray-300" />
            <p className="text-lg">Select a memory entry</p>
            <p className="text-sm mt-1">Browse directories or search to view memory content</p>
          </div>
        ) : isLoadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : memoryDetail && memoryDetail.entry ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="bg-white border rounded-lg shadow-sm">
              {/* Header */}
              <div className="px-4 py-3 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <File className="w-5 h-5 text-blue-500" />
                    <span className="font-medium">{memoryDetail.entry.path || 'Unknown'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* View mode toggle */}
                    <div className="flex items-center gap-1 border rounded p-0.5">
                      <button
                        onClick={() => setViewMode('rendered')}
                        className={`p-1.5 rounded ${
                          viewMode === 'rendered' ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                        }`}
                        title="Rendered view"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setViewMode('source')}
                        className={`p-1.5 rounded ${
                          viewMode === 'source' ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'
                        }`}
                        title="Source view"
                      >
                        <Code className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      {memoryDetail.entry.category && (
                        <div className="flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          {memoryDetail.entry.category}
                        </div>
                      )}
                      {memoryDetail.entry.updatedAt && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(memoryDetail.entry.updatedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                {viewMode === 'source' ? (
                  // Source code view with Monaco Editor
                  <div className="border rounded overflow-hidden">
                    <Editor
                      height="500px"
                      language={detectLanguageFromPath(memoryDetail.entry.path || '')}
                      value={memoryDetail.entry.content || ''}
                      theme="vs"
                      options={READONLY_MONACO_OPTIONS}
                    />
                  </div>
                ) : (
                  // Rendered Markdown view
                  <ReactMarkdown
                    className="prose prose-sm max-w-none"
                    components={{
                      h1: ({ children }) => (
                        <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-2">{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-xl font-bold mb-3 mt-4 first:mt-2">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-lg font-bold mb-2 mt-3">{children}</h3>
                      ),
                      p: ({ children }) => (
                        <p className="mb-2 last:mb-0">{children}</p>
                      ),
                      ul: ({ children }) => (
                        <ul className="mb-2 list-disc pl-4 space-y-1">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="mb-2 list-decimal pl-4 space-y-1">{children}</ol>
                      ),
                      li: ({ children }) => <li className="ml-2">{children}</li>,
                      code: ({ className, children }) => {
                        const isInline = !className;
                        return isInline ? (
                          <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">
                            {children}
                          </code>
                        ) : (
                          <code className="block bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto">
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {memoryDetail.entry.content || ''}
                  </ReactMarkdown>
                )}
              </div>

              {/* Metadata */}
              {memoryDetail.entry.metadata && (
                <div className="px-4 py-3 border-t bg-gray-50">
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-gray-700">
                      View Metadata
                    </summary>
                    <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                      {JSON.stringify(memoryDetail.entry.metadata, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
