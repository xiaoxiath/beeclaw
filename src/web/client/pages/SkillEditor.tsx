import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Save, X, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { MARKDOWN_MONACO_OPTIONS } from '../lib/editor-config';

interface SkillEditorProps {
  name?: string;
}

export default function SkillEditor({ name: propName }: SkillEditorProps = {}) {
  const skillName = propName || '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = skillName === 'new' || skillName === '';

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    content: '',
    triggers: [] as string[],
    examples: [] as string[],
    maturity: 'seed' as 'seed' | 'growing' | 'mature' | 'deprecated',
  });

  const [triggerInput, setTriggerInput] = useState('');
  const [exampleInput, setExampleInput] = useState('');

  // Generic handler factory for array fields
  const createListHandlers = <K extends 'triggers' | 'examples'>(
    field: K,
    input: string,
    setInput: (v: string) => void
  ) => ({
    add: () => {
      if (input.trim()) {
        setFormData({ ...formData, [field]: [...formData[field], input.trim()] });
        setInput('');
      }
    },
    remove: (index: number) => {
      setFormData({ ...formData, [field]: formData[field].filter((_, i) => i !== index) });
    },
  });

  const triggerHandlers = createListHandlers('triggers', triggerInput, setTriggerInput);
  const exampleHandlers = createListHandlers('examples', exampleInput, setExampleInput);

  // Fetch skill if editing
  const { data: skillData, isLoading } = useQuery({
    queryKey: ['skill', skillName],
    queryFn: async () => {
      if (isNew) return null;
      const response = await fetch(`/api/skills/${encodeURIComponent(skillName)}`);
      if (!response.ok) throw new Error('Failed to fetch skill');
      return response.json();
    },
    enabled: !isNew,
  });

  // Populate form when skill data loads
  useEffect(() => {
    if (skillData?.skill) {
      const skill = skillData.skill;
      setFormData({
        name: skill.name || '',
        description: skill.description || '',
        content: skill.content || '',
        triggers: skill.triggers || [],
        examples: skill.examples || [],
        maturity: skill.maturity || 'seed',
      });
    }
  }, [skillData]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to create skill');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      navigate({ to: '/skills' });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch(`/api/skills/${encodeURIComponent(skillName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to update skill');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      navigate({ to: '/skills' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isNew) {
      createMutation.mutate(formData);
    } else {
      updateMutation.mutate(formData);
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
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate({ to: '/skills' })}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Skills
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isNew ? 'Create New Skill' : `Edit Skill: ${skillName}`}
        </h1>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Skill Name
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={!isNew}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            placeholder="my-skill-name"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <input
            type="text"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Brief description of what this skill does"
            required
          />
        </div>

        {/* Content */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Content (Markdown)
          </label>
          <div className="border rounded overflow-hidden">
            <Editor
              height="500px"
              defaultLanguage="markdown"
              value={formData.content}
              onChange={(value) => setFormData({ ...formData, content: value || '' })}
              theme="vs"
              options={MARKDOWN_MONACO_OPTIONS}
            />
          </div>
        </div>

        {/* Triggers */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Triggers
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={triggerInput}
              onChange={(e) => setTriggerInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), triggerHandlers.add())}
              className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add a trigger phrase"
            />
            <button
              type="button"
              onClick={triggerHandlers.add}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {formData.triggers.map((trigger, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
              >
                {trigger}
                <button
                  type="button"
                  onClick={() => triggerHandlers.remove(index)}
                  className="hover:text-blue-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Examples */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Examples
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={exampleInput}
              onChange={(e) => setExampleInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), exampleHandlers.add())}
              className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add an example"
            />
            <button
              type="button"
              onClick={exampleHandlers.add}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Add
            </button>
          </div>
          <div className="space-y-2">
            {formData.examples.map((example, index) => (
              <div
                key={index}
                className="flex items-start gap-2 p-2 bg-gray-50 rounded"
              >
                <span className="flex-1 text-sm">{example}</span>
                <button
                  type="button"
                  onClick={() => exampleHandlers.remove(index)}
                  className="text-gray-400 hover:text-red-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Maturity */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Maturity Level
          </label>
          <select
            value={formData.maturity}
            onChange={(e) => setFormData({ ...formData, maturity: e.target.value as any })}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="seed">Seed - Initial idea</option>
            <option value="growing">Growing - Under development</option>
            <option value="mature">Mature - Production ready</option>
            <option value="deprecated">Deprecated - No longer maintained</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t">
          <button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {createMutation.isPending || updateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {isNew ? 'Create Skill' : 'Save Changes'}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/skills' })}
            className="px-6 py-2 border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
