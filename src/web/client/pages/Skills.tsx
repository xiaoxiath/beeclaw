import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search, Plus, Edit, Trash2, ToggleLeft, ToggleRight, Brain, FileText } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export default function Skills() {
  const [search, setSearch] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch skills
  const { data: skillsData, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const response = await api.api.skills.$get();
      return response.json();
    },
  });

  // Toggle skill mutation
  const toggleMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.api.skills[':name'].toggle.$post({
        param: { name },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  // Delete skill mutation
  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.api.skills[':name'].$delete({
        param: { name },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setSelectedSkill(null);
    },
  });

  const skills = skillsData?.skills || [];
  const filteredSkills = skills.filter((skill: any) =>
    skill.name.toLowerCase().includes(search.toLowerCase()) ||
    skill.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = (name: string) => {
    toggleMutation.mutate(name);
  };

  const handleDelete = (name: string) => {
    if (confirm(`Are you sure you want to delete skill "${name}"?`)) {
      deleteMutation.mutate(name);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Loading skills...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Skills</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage your AI assistant skills
          </p>
        </div>
        <Link
          to="/skills/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Skill
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2">
              <Brain className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{skillsData?.total || 0}</p>
              <p className="text-sm text-gray-500">Total Skills</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{skillsData?.user || 0}</p>
              <p className="text-sm text-gray-500">User Skills</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-50 p-2">
              <Brain className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{skillsData?.builtin || 0}</p>
              <p className="text-sm text-gray-500">Built-in Skills</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Skills Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Skill Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Maturity
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Category
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredSkills.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  {search ? 'No skills found matching your search' : 'No skills yet. Create your first skill!'}
                </td>
              </tr>
            ) : (
              filteredSkills.map((skill: any) => (
                <tr key={skill.name} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-gray-400" />
                      <span className="font-medium text-gray-900">{skill.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="max-w-md truncate text-sm text-gray-500">
                      {skill.description || 'No description'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-1 text-xs font-semibold',
                        skill.maturity === 'mature' && 'bg-green-100 text-green-800',
                        skill.maturity === 'growing' && 'bg-blue-100 text-blue-800',
                        skill.maturity === 'seed' && 'bg-yellow-100 text-yellow-800',
                        skill.maturity === 'deprecated' && 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {skill.maturity || 'seed'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-1 text-xs font-semibold',
                        skill.category === 'builtin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-blue-100 text-blue-800'
                      )}
                    >
                      {skill.category}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-1 text-xs font-semibold',
                        skill.enabled !== false
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      )}
                    >
                      {skill.enabled !== false ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleToggle(skill.name)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title={skill.enabled !== false ? 'Disable' : 'Enable'}
                      >
                        {skill.enabled !== false ? (
                          <ToggleRight className="h-5 w-5 text-green-600" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-gray-400" />
                        )}
                      </button>
                      <Link
                        to={`/skills/${encodeURIComponent(skill.name)}/edit`}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                        title="Edit"
                      >
                        <Edit className="h-5 w-5" />
                      </Link>
                      {skill.category !== 'builtin' && (
                        <button
                          onClick={() => handleDelete(skill.name)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
