// server.js
const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');

const app = next({ dev: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    createServer(
        {
            key: fs.readFileSync('./localhost.key'),
            cert: fs.readFileSync('./localhost.crt'),
        },
        (req, res) => {
            handle(req, res, parse(req.url, true));
        }
    ).listen(3000, '0.0.0.0', () => {
        console.log('> Ready on https://127.0.0.1:3000');
    });
});