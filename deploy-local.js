const { Client } = require('ssh2');
const fs = require('fs');

const config = {
  host: '10.253.33.233',
  port: 8500,
  username: 'qianli',
  password: 'cquqianli2026'
};

const conn = new Client();

conn.on('ready', () => {
  console.log('SSH连接成功！');
  
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP连接失败:', err.message);
      conn.end();
      return;
    }
    
    console.log('SFTP连接成功，开始上传src目录...');
    
    uploadDirectory(sftp, './server/src', '/opt/knowledge-tracker/server/src', (err) => {
      if (err) {
        console.error('上传失败:', err.message);
        sftp.end();
        conn.end();
        return;
      }
      
      console.log('src目录上传完成！');
      sftp.end();
      
      const commands = [
        { cmd: 'ls -la /opt/knowledge-tracker/server/src/' },
        { cmd: 'pm2 start /opt/knowledge-tracker/server/src/index.js --name knowledge-tracker' },
        { cmd: 'pm2 status' }
      ];
      
      executeCommands(commands, 0, () => {
        conn.end();
      });
    });
  });
});

function uploadFile(sftp, localPath, remotePath, callback) {
  const readStream = fs.createReadStream(localPath);
  const writeStream = sftp.createWriteStream(remotePath);
  
  writeStream.on('close', () => {
    console.log(`上传: ${localPath} -> ${remotePath}`);
    callback(null);
  });
  
  writeStream.on('error', (err) => {
    callback(err);
  });
  
  readStream.pipe(writeStream);
}

function uploadDirectory(sftp, localDir, remoteDir, callback) {
  fs.readdir(localDir, { withFileTypes: true }, (err, entries) => {
    if (err) return callback(err);
    
    sftp.mkdir(remoteDir, { recursive: true }, (err) => {
      if (err && err.code !== 4) return callback(err);
      
      let completed = 0;
      const total = entries.length;
      
      if (total === 0) return callback(null);
      
      entries.forEach(entry => {
        const localPath = localDir + '/' + entry.name;
        const remotePath = remoteDir + '/' + entry.name;
        
        if (entry.isDirectory()) {
          uploadDirectory(sftp, localPath, remotePath, (err) => {
            if (err) return callback(err);
            completed++;
            if (completed === total) callback(null);
          });
        } else {
          uploadFile(sftp, localPath, remotePath, (err) => {
            if (err) return callback(err);
            completed++;
            if (completed === total) callback(null);
          });
        }
      });
    });
  });
}

function executeCommands(commands, index, onComplete) {
  if (index >= commands.length) {
    if (onComplete) onComplete();
    return;
  }
  
  const cmd = commands[index];
  console.log(`\n[${index + 1}/${commands.length}] 执行: ${cmd.cmd}`);
  
  conn.exec(cmd.cmd, (err, stream) => {
    if (err) {
      console.error('命令执行失败:', err.message);
      conn.end();
      return;
    }
    
    let stdout = '';
    let stderr = '';
    
    stream.on('data', (data) => {
      stdout += data.toString();
    });
    
    stream.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    stream.on('close', (code) => {
      if (stdout.trim()) {
        console.log(stdout.trim());
      }
      if (stderr.trim()) {
        console.error('错误:', stderr.trim());
      }
      
      if (code === 0) {
        console.log(`命令执行成功 (退出码: ${code})`);
        executeCommands(commands, index + 1, onComplete);
      } else {
        console.error(`命令执行失败 (退出码: ${code})`);
        conn.end();
      }
    });
  });
}

conn.on('error', (err) => {
  console.error('SSH连接失败:', err.message);
  process.exit(1);
});

conn.on('end', () => {
  console.log('SSH连接已关闭');
});

console.log('正在连接到 NAS...');
conn.connect(config);
