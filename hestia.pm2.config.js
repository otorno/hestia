module.exports = {
  apps: [
    {
      name: 'hestia',
      script: 'build-prod/backend/hestia.js',
      watch: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
