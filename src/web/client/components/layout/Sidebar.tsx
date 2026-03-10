import { Link, useLocation } from '@tanstack/react-router';
import {
  LayoutDashboard,
  MessageSquare,
  Brain,
  History,
  Settings,
} from 'lucide-react';
import { cn } from '../../lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Skills', href: '/skills', icon: Brain },
  { name: 'Chat', href: '/chat', icon: MessageSquare },
  { name: 'Memory', href: '/memory', icon: Brain },
  { name: 'Sessions', href: '/sessions', icon: History },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <div className="flex w-64 flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-gray-200 px-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐝</span>
          <span className="text-xl font-bold text-gray-900">Beeclaw</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-200 p-4">
        <p className="text-xs text-gray-500">
          Beeclaw v0.2.1
        </p>
      </div>
    </div>
  );
}
