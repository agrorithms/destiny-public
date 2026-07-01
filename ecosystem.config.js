module.exports = {
    apps: [
        {
            name: 'crawler',
            script: 'dist/scripts/scripts/start-crawler.js',
            interpreter: 'node',
            cwd: '/home/ubuntu/destiny-farm-finder',
            watch: false,
            env: { NODE_ENV: 'production' }
        },
        {
            name: 'scanner',
            script: 'dist/scripts/scripts/start-scanner.js',
            interpreter: 'node',
            cwd: '/home/ubuntu/destiny-farm-finder',
            watch: false,
            env: { NODE_ENV: 'production' }
        },
        {
            name: 'web',
            script: 'node_modules/next/dist/bin/next',
            args: 'start -H 127.0.0.1 -p 3000',
            exec_mode: 'cluster',
            instances: 2,
            kill_timeout: 5000,
            cwd: '/home/ubuntu/destiny-farm-finder'
        },
        {
            name: 'cloudflared',
            script: 'cloudflared',
            args: 'tunnel --config /home/ubuntu/.cloudflared/config.yml run',
            interpreter: 'none'
        }
    ]
}