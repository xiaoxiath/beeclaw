import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, Loader2, AlertCircle } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { JSON_MONACO_OPTIONS } from '../lib/editor-config';

export default function SettingsPage() {
  const [editedConfig, setEditedConfig] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();
  const hasInitialized = useRef(false);

  // Fetch current config
  const { data: configData, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Failed to fetch config');
      return response.json();
    },
  });

  // Update config mutation
  const updateMutation = useMutation({
    mutationFn: async (newConfig: any) => {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update config');
      }
      return response.json();
    },
    onSuccess: () => {
      setHasChanges(false);
      hasInitialized.current = false; // Reset to allow reload
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  // Initialize edited config when data loads (only once)
  useEffect(() => {
    if (configData?.config && !hasInitialized.current) {
      setEditedConfig(JSON.stringify(configData.config, null, 2));
      hasInitialized.current = true;
    }
  }, [configData]);

  const handleConfigChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditedConfig(value);
      setHasChanges(true);
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editedConfig);
      updateMutation.mutate(parsed);
    } catch (error) {
      alert('Invalid JSON format');
    }
  };

  const handleReset = () => {
    if (configData?.config) {
      setEditedConfig(JSON.stringify(configData.config, null, 2));
      setHasChanges(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
              <p className="text-sm text-gray-500 mt-1">
                View and edit Beeclaw configuration
              </p>
            </div>
          </div>

          {hasChanges && (
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="px-4 py-2 border rounded hover:bg-gray-50 transition"
              >
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition flex items-center gap-2"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Display */}
      {updateMutation.isError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-red-900">Failed to update configuration</h3>
            <p className="text-sm text-red-700 mt-1">
              {updateMutation.error instanceof Error
                ? updateMutation.error.message
                : 'Unknown error'}
            </p>
          </div>
        </div>
      )}

      {/* Success Message */}
      {updateMutation.isSuccess && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">
            ✓ Configuration updated successfully. Some changes may require a restart.
          </p>
        </div>
      )}

      {/* Config Editor */}
      <div className="bg-white border rounded-lg shadow-sm">
        <div className="px-4 py-3 border-b bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">Configuration File</span>
              <span className="text-xs text-gray-500">
                {configData?.path}
              </span>
            </div>
            {hasChanges && (
              <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div className="p-4">
          <div className="border rounded overflow-hidden">
            <Editor
              height="600px"
              defaultLanguage="json"
              value={editedConfig}
              onChange={handleConfigChange}
              theme="vs"
              options={JSON_MONACO_OPTIONS}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t bg-gray-50">
          <p className="text-xs text-gray-500">
            ⚠️ Note: API keys and tokens are masked for security. Direct editing of sensitive fields is not supported through this interface.
          </p>
        </div>
      </div>
    </div>
  );
}
