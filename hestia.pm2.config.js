module.exports = {
  apps: [
    {
      name: 'hestia',
      script: 'build/backend/hestia.js',
      watch: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
