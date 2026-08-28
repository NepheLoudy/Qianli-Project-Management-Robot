const { Client } = require('ssh2');
const config = { host: '10.253.33.233', port: 8500, username: 'qianli', password: 'cquqianli2026' };
const conn = new Client();
conn.on('ready', () => {
  conn.exec('cd /opt/knowledge-tracker && git remote -v && echo "---BRANCH---" && git branch -vv', (err, stream) => {
    if (err) { console.error(err.message); conn.end(); return; }
    stream.on('data', d => console.log(d.toString()));
    stream.stderr.on('data', d => console.error(d.toString()));
    stream.on('close', () => conn.end());
  });
});
conn.on('error', e => { console.error(e.message); process.exit(1); });
conn.connect(config);
