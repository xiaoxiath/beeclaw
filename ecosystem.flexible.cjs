/**
 * PM2 Ecosystem Configuration (Flexible)
 *
 * Support both daemon and non-daemon modes via environment variable
 *
 * Usage:
 *   # With daemon (default)
 *   pm2 start ecosystem.flexible.cjs
 *
 *   # Without daemon
 *   ENABLE_DAEMON=false pm2 start ecosystem.flexible.cjs
 *
 *   # Production with daemon
 *   pm2 start ecosystem.flexible.cjs --env production
 */

module.exports = {
  apps: [
    {
      name: 'beeclaw',
      script: 'src/entries/bot.ts',
      interpreter: 'bun',
      cwd: './',

      // Args can be controlled via environment variable
      // Default: --daemon (enabled)
      // Set ENABLE_DAEMON=false to disable
      args: process.env.ENABLE_DAEMON === 'false' ? '' : '--daemon',

      // Process management
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 3000,
      max_restarts: 10,
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 3000,

      // Environment variables
      env: {
        NODE_ENV: 'development',
        ENABLE_DAEMON: 'true',  // Default to true
      },
      env_production: {
        NODE_ENV: 'production',
        ENABLE_DAEMON: 'true',
      },
      env_no_daemon: {
        NODE_ENV: 'development',
        ENABLE_DAEMON: 'false',
      },

      // Log configuration
      error_file: './logs/beeclaw-error.log',
      out_file: './logs/beeclaw-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      combine_logs: true,

      // Advanced options
      cron_restart: '0 4 * * *',  // Daily restart at 4 AM
      time: true,  // Timestamp logs
    },
  ],
};
