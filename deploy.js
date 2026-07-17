const { Client } = require('ssh2');

const config = {
  host: '10.253.33.233',
  port: 8500,
  username: 'qianli',
  password: 'cquqianli2026'
};

const commands = [
  { cmd: 'mkdir -p /opt/knowledge-tracker/server', sudo: true },
  { cmd: 'chown -R qianli:qianli /opt/knowledge-tracker', sudo: true },
  { cmd: 'cd /opt/knowledge-tracker && if [ -d .git ]; then git fetch origin main && git reset --hard origin/main; else git init && git remote add origin https://github.com/NepheLoudy/Qianli-Project-Management-Robot.git && git fetch origin main && git reset --hard origin/main; fi', sudo: false },
  { cmd: 'cd /opt/knowledge-tracker/server && npm install --production', sudo: false },
  { cmd: `cat > /opt/knowledge-tracker/server/.env << 'EOF'\nAPP_ID=cli_aac7e6f6cdf8dcc0\nAPP_SECRET=Z11s3UBWL2pivBCcc1zJnfJInKWmaYjN\nBITABLE_APP_TOKEN=ZlVZbXDkRayUzSsFRiycznmZn5b\nBITABLE_PROJECT_TABLE_ID=tblIcyn9814CsgaH\nBITABLE_LOG_TABLE_ID=tblMKWLbuHmGRHEY\nBITABLE_KEYWORD_TABLE_ID=tblkLvg2yr1LQY8t\nFEISHU_VERIFICATION_TOKEN=\nFEISHU_ENCRYPT_KEY=\nFEISHU_USE_LONG_CONNECTION=true\nBOT_NAME=爆米花机-对话型\nBOT_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/86aaf3f6-5536-498a-9355-7f3c18bcbb22\nCHAT_CHAT_ID=oc_4994e3f0ca73f76b1243b38622637f47\nKEYWORD_CHAT_ID=oc_ece7ea157e086eb80f7affb23c124310\nPORT=2174\nNODE_ENV=production\nCRON_SCHEDULE=0 0 12 * * *\nDDL_ALERT_DAYS=2\nBOT2_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/f2bdbe28-6f9a-4cd9-91b7-3a7f7392aaf4\nBOT2_CHAT_ID=oc_b2f0cc87181441dfb57ff6835aed556a\nMEETING_CHAT_IDS=oc_cf47b73e1984f4f8ac797eb360b4f154,oc_59d4ee020c17c651184bf7dc45130168,oc_f3fb4fe4a88e07e3c54f2460d6387d55,oc_0d5cdec1909d96feb0968c6a78fed08b,oc_19637c02bb74e630740c777a4ef5b06f,oc_8a75ab429017338ebc0333a0950a4a7d\nPRINT_SERVER_URL=http://localhost:3001\nEOF`, sudo: false },
  { cmd: 'pm2 delete knowledge-tracker 2>/dev/null || true', sudo: false },
  { cmd: 'pm2 start /opt/knowledge-tracker/server/src/index.js --name knowledge-tracker', sudo: false },
  { cmd: 'pm2 save', sudo: false },
  { cmd: 'ufw allow 2174/tcp', sudo: true }
];

const conn = new Client();

conn.on('ready', () => {
  console.log('SSH连接成功！');
  executeNextCommand(0);
});

conn.on('error', (err) => {
  console.error('SSH连接失败:', err.message);
  process.exit(1);
});

conn.on('end', () => {
  console.log('SSH连接已关闭');
});

function executeNextCommand(index) {
  if (index >= commands.length) {
    console.log('\n所有命令执行完成！');
    conn.end();
    return;
  }
  
  const { cmd, sudo } = commands[index];
  const displayCmd = cmd.substring(0, 60) + (cmd.length > 60 ? '...' : '');
  console.log(`\n[${index + 1}/${commands.length}] 执行${sudo ? '(sudo)' : ''}: ${displayCmd}`);
  
  const execCmd = sudo ? `echo "cquqianli2026" | sudo -S ${cmd}` : cmd;
  
  conn.exec(execCmd, (err, stream) => {
    if (err) {
      console.error('命令执行失败:', err.message);
      conn.end();
      return;
    }
    
    stream.on('data', (data) => {
      const output = data.toString().trim();
      if (output && !output.includes('[sudo] password') && !output.includes('cquqianli2026')) {
        console.log(output);
      }
    });
    
    stream.stderr.on('data', (data) => {
      const error = data.toString().trim();
      if (error && !error.includes('[sudo] password') && !error.includes('cquqianli2026')) {
        console.error('错误:', error);
      }
    });
    
    stream.on('close', (code) => {
      if (code === 0) {
        console.log(`命令执行成功 (退出码: ${code})`);
        executeNextCommand(index + 1);
      } else {
        console.error(`命令执行失败 (退出码: ${code})`);
        conn.end();
      }
    });
  });
}

console.log('正在连接到 NAS...');
conn.connect(config);
