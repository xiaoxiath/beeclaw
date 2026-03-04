/**
 * PM2 Ecosystem Configuration
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs              # Start in development mode
 *   pm2 start ecosystem.config.cjs --env production  # Start in production mode
 *   pm2 stop ecosystem.config.cjs               # Stop all apps
 *   pm2 restart ecosystem.config.cjs            # Restart all apps
 *   pm2 delete ecosystem.config.cjs             # Delete all apps
 */

module.exports = {
  apps: [
    {
      name: 'beeclaw',
      script: 'src/bot.ts',
      interpreter: 'bun',
      cwd: './',
      args: '--daemon',  // Enable daemon mode for proactive scheduling

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
      },
      env_production: {
        NODE_ENV: 'production',
      },

      // Log configuration
      error_file: './logs/beeclaw-error.log',
      out_file: './logs/beeclaw-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      combine_logs: true,

      // Advanced options
      time: true,  // Timestamp logs
    },

    // Optional: CLI mode (for testing)
    // Uncomment to enable
    // {
    //   name: 'beeclaw-cli',
    //   script: 'src/cli.ts',
    //   interpreter: 'bun',
    //   instances: 1,
    //   autorestart: false,
    //   watch: false,
    //   error_file: './logs/cli-error.log',
    //   out_file: './logs/cli-out.log',
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // },
  ],
};
