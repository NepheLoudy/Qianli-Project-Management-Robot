const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const localBase = path.join(__dirname, 'server');
const remoteBase = '/opt/knowledge-tracker/server';

const filesToCopy = [
  '.env',
];

conn.on('ready', () => {
  console.log('SSH OK');
  
  let fileIndex = 0;
  
  function copyNextFile() {
    if (fileIndex >= filesToCopy.length) {
      console.log('\n所有文件已上传');
      restartService();
      return;
    }
    
    const localFile = path.join(localBase, filesToCopy[fileIndex]);
    const remoteFile = `${remoteBase}/${filesToCopy[fileIndex]}`;
    
    console.log(`\n上传 ${filesToCopy[fileIndex]}...`);
    
    fs.readFile(localFile, (err, data) => {
      if (err) {
        console.error(`读取文件失败: ${err.message}`);
        fileIndex++;
        copyNextFile();
        return;
      }
      
      const remoteDir = remoteFile.substring(0, remoteFile.lastIndexOf('/'));
      conn.exec(`mkdir -p ${remoteDir}`, (err) => {
        if (err) {
          console.error(`创建目录失败: ${err.message}`);
          fileIndex++;
          copyNextFile();
          return;
        }
        
        const sftp = conn.sftp((err, sftp) => {
          if (err) {
            console.error(`SFTP连接失败: ${err.message}`);
            fileIndex++;
            copyNextFile();
            return;
          }
          
          const writeStream = sftp.createWriteStream(remoteFile);
          writeStream.on('close', () => {
            console.log(`✓ ${filesToCopy[fileIndex]} 上传成功`);
            fileIndex++;
            copyNextFile();
          });
          writeStream.on('error', (err) => {
            console.error(`上传失败: ${err.message}`);
            fileIndex++;
            copyNextFile();
          });
          writeStream.end(data);
        });
      });
    });
  }
  
  function restartService() {
    console.log('\n重启PM2服务...');
    conn.exec('pm2 restart knowledge-tracker --update-env', (err, stream) => {
      if (err) {
        console.error(`重启失败: ${err.message}`);
        conn.end();
        return;
      }
      stream.on('data', d => console.log(d.toString().trim()));
      stream.on('close', () => {
        console.log('\n✅ 部署完成');
        conn.end();
      });
    });
  }
  
  copyNextFile();
});

conn.on('error', e => console.error(`SSH连接失败: ${e.message}`));
conn.connect({ 
  host: '10.253.33.233', 
  port: 8500,
  username: 'qianli', 
  password: 'cquqianli2026' 
});