import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router';

interface AuthGuardProps {
  children?: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const _location = useLocation();

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();

      if (data.authenticated) {
        setIsAuthenticated(true);
      } else {
        // Redirect to login page
        navigate({ to: '/login' });
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      // Redirect to login page
      navigate({ to: '/login' });
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-4xl">🐝</div>
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect to login
  }

  return <>{children || <Outlet />}</>;
}
