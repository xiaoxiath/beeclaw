import { Bell, User } from 'lucide-react';

export default function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">
          AI Assistant Dashboard
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <button className="rounded-lg p-2 text-gray-600 hover:bg-gray-100">
          <Bell className="h-5 w-5" />
        </button>
        <button className="rounded-lg p-2 text-gray-600 hover:bg-gray-100">
          <User className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
