// PM2:  bun run build && pm2 startOrReload ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'suku-deploy',
      script: 'dist/main.js',
      instances: 2, // or 'max' for one per CPU core
      exec_mode: 'cluster',
      kill_timeout: 15000, // longer than the shutdown deadline in src/main.ts
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
        TRUST_PROXY: 0,
        APP_VERSION: 'pm2',
      },
    },
  ],
};
