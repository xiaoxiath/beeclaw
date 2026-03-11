import { useQuery } from '@tanstack/react-query';
import { Activity, Brain, MessageSquare, Clock } from 'lucide-react';
import { api } from '../lib/api';

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const response = await api.api.stats.$get();
        return response.json();
      },
      refetchInterval: 5000, // Refresh every 5 seconds
    });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Active Sessions',
      value: stats?.sessions || 0,
      icon: MessageSquare,
      color: 'blue',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600',
    },
    {
      title: 'Skills Loaded',
      value: stats?.skills || 0,
      icon: Brain,
      color: 'purple',
      bgColor: 'bg-purple-50',
      iconColor: 'text-purple-600',
    },
    {
      title: 'Uptime',
      value: `${stats?.uptime || 0}s`,
      icon: Clock,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600',
    },
    {
      title: 'Status',
      value: stats?.status || 'unknown',
      icon: Activity,
      color: 'emerald',
      bgColor: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your Beeclaw instance
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.title}
            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{card.title}</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {card.value}
                </p>
              </div>
              <div className={`rounded-lg ${card.bgColor} p-3`}>
                <card.icon className={`h-6 w-6 ${card.iconColor}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <a
            href="/chat"
            className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50"
          >
            <MessageSquare className="h-5 w-5 text-blue-600" />
            <div>
              <p className="font-medium text-gray-900">Start Chat</p>
              <p className="text-sm text-gray-500">Chat with Beeclaw</p>
            </div>
          </a>

          <a
            href="/memory"
            className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50"
          >
            <Brain className="h-5 w-5 text-purple-600" />
            <div>
              <p className="font-medium text-gray-900">Browse Memory</p>
              <p className="text-sm text-gray-500">View stored memories</p>
            </div>
          </a>

          <a
            href="/sessions"
            className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50"
          >
            <Activity className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium text-gray-900">View Sessions</p>
              <p className="text-sm text-gray-500">Chat history</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
