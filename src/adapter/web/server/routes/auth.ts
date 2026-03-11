import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { WebConfig } from '@/infra/config/schema';

const loginSchema = z.object({
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

export function createAuthRoutes(config: WebConfig) {
  return new Hono()
    // Login page
    .get('/login', (c) => {
      const authLevel = config.auth?.level || 'none';

      // If no auth required, redirect to home
      if (authLevel === 'none') {
        return c.redirect('/');
      }

      // Return login HTML
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Beeclaw</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
    <div class="text-center mb-8">
      <div class="text-6xl mb-4">🐝</div>
      <h1 class="text-3xl font-bold text-gray-900">Welcome to Beeclaw</h1>
      <p class="text-gray-600 mt-2">Sign in to continue</p>
    </div>

    ${authLevel === 'token' ? `
    <form id="loginForm" class="space-y-6">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">Access Token</label>
        <input
          type="password"
          id="token"
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter your access token"
          required
        />
      </div>
      <button
        type="submit"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
      >
        Sign In with Token
      </button>
    </form>
    ` : ''}

    ${authLevel === 'basic' ? `
    <form id="loginForm" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">Username</label>
        <input
          type="text"
          id="username"
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter your username"
          required
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
        <input
          type="password"
          id="password"
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter your password"
          required
        />
      </div>
      <button
        type="submit"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
      >
        Sign In
      </button>
    </form>
    ` : ''}

    <div id="error" class="hidden mt-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg"></div>

    <div class="mt-6 text-center text-sm text-gray-500">
      <p>Secure authentication powered by Beeclaw</p>
    </div>
  </div>

  <script>
    const form = document.getElementById('loginForm');
    const errorDiv = document.getElementById('error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const authLevel = '${authLevel}';
      let body = {};

      if (authLevel === 'token') {
        body.token = document.getElementById('token').value;
      } else if (authLevel === 'basic') {
        body.username = document.getElementById('username').value;
        body.password = document.getElementById('password').value;
      }

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (response.ok) {
          const data = await response.json();
          window.location.href = '/';
        } else {
          const error = await response.json();
          errorDiv.textContent = error.message || 'Login failed';
          errorDiv.classList.remove('hidden');
        }
      } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.remove('hidden');
      }
    });
  </script>
</body>
</html>
      `;

      return c.html(html);
    })

    // Login API
    .post('/login', zValidator('json', loginSchema), async (c) => {
      const body = c.req.valid('json');
      const authLevel = config.auth?.level || 'none';

      if (authLevel === 'token') {
        const token = body.token;
        const validToken = config.auth?.token || process.env.WEB_AUTH_TOKEN;

        if (!token || token !== validToken) {
          return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
        }

        // Set cookie
        setCookie(c, 'auth_token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 60 * 60 * 24 * 7, // 7 days
          path: '/',
        });

        return c.json({ success: true, message: 'Login successful' });
      }

      if (authLevel === 'basic') {
        const { username, password } = body;
        const validUsers = config.auth?.basicUsers || [];
        const validUser = validUsers.find(u => u.username === username && u.password === password);

        if (!validUser) {
          return c.json({ error: 'Unauthorized', message: 'Invalid credentials' }, 401);
        }

        // Set cookie
        setCookie(c, 'auth_token', Buffer.from(`${username}:${password}`).toString('base64'), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 60 * 60 * 24 * 7, // 7 days
          path: '/',
        });

        return c.json({ success: true, message: 'Login successful' });
      }

      return c.json({ error: 'Bad Request', message: 'Invalid auth level' }, 400);
    })

    // Logout
    .post('/logout', async (c) => {
      setCookie(c, 'auth_token', '', {
        httpOnly: true,
        maxAge: 0,
        path: '/',
      });
      return c.json({ success: true, message: 'Logged out' });
    })

    // Check auth status
    .get('/me', async (c) => {
      const authLevel = config.auth?.level || 'none';

      if (authLevel === 'none') {
        return c.json({ authenticated: true, level: 'none' });
      }

      const cookieToken = c.req.header('Cookie')
        ?.split(';')
        .find(c => c.trim().startsWith('auth_token='))
        ?.split('=')[1];

      if (!cookieToken) {
        return c.json({ authenticated: false }, 401);
      }

      if (authLevel === 'token') {
        const validToken = config.auth?.token || process.env.WEB_AUTH_TOKEN;
        if (cookieToken === validToken) {
          return c.json({ authenticated: true, level: 'token' });
        }
      }

      if (authLevel === 'basic') {
        const credentials = Buffer.from(cookieToken, 'base64').toString();
        const [username, password] = credentials.split(':');
        const validUsers = config.auth?.basicUsers || [];
        const validUser = validUsers.find(u => u.username === username && u.password === password);

        if (validUser) {
          return c.json({ authenticated: true, level: 'basic', user: username });
        }
      }

      return c.json({ authenticated: false }, 401);
    });
}
