import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RootLayout from './components/layout/RootLayout';
import AuthGuard from './components/AuthGuard';
import Dashboard from './pages/Dashboard';
import Skills from './pages/Skills';
import SkillEditor from './pages/SkillEditor';
import LoginPage from './pages/Login';
import Chat from './pages/Chat';
import Memory from './pages/Memory';
import Sessions from './pages/Sessions';
import Settings from './pages/Settings';

// Create query client
const queryClient = new QueryClient();

// Single root route with layout
const rootRoute = createRootRoute({
  component: RootLayout,
});

// Login route (public - no auth guard)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

// Protected routes wrapper
const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  component: AuthGuard,
});

// Dashboard (protected)
const indexRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/',
  component: Dashboard,
});

// Skills list (protected)
const skillsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/skills',
  component: Skills,
});

// Skill editor - new (protected)
const skillNewRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/skills/new',
  component: () => <SkillEditor name="new" />,
});

// Skill editor - new/edit (protected, alias)
const skillNewEditRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/skills/new/edit',
  component: () => <SkillEditor name="new" />,
});

// Skill editor - edit (protected)
const skillEditRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/skills/$name/edit',
  component: () => {
    const params = skillEditRoute.useParams();
    return <SkillEditor name={params.name} />;
  },
});

// Chat (protected)
const chatRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/chat',
  component: Chat,
});

// Memory (protected)
const memoryRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/memory',
  component: Memory,
});

// Sessions (protected)
const sessionsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/sessions',
  component: Sessions,
});

// Settings (protected)
const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/settings',
  component: Settings,
});

// Create route tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([
    indexRoute,
    skillsRoute,
    skillNewRoute,
    skillNewEditRoute,
    skillEditRoute,
    chatRoute,
    memoryRoute,
    sessionsRoute,
    settingsRoute,
  ]),
]);

// Create router
const router = createRouter({ routeTree });

// Create App component
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
