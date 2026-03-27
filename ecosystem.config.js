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
        }
    ]
}