import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { api } from '../lib/api';

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.api.auth.me.$get();
      const data = await response.json();
      setIsAuthenticated(data.authenticated || false);
    } catch (_error) {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.api.auth.logout.$post();
      setIsAuthenticated(false);
      router.navigate({ to: '/login' });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return { isAuthenticated, isLoading, checkAuth, logout };
}
