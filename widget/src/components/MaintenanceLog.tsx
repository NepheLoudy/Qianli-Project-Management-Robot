import React, { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { logApi, MaintenanceLog } from '../api';

const MaintenanceLog: React.FC = () => {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    version: '',
    content: '',
  });

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await logApi.getLogs();
      setLogs(data.items);
    } catch (err) {
      console.error('加载维护日志失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.version || !formData.content) {
      alert('请填写版本号和更新内容');
      return;
    }
    try {
      await logApi.createLog(formData.version, formData.content);
      setShowModal(false);
      setFormData({ version: '', content: '' });
      await loadLogs();
      alert('维护日志已记录');
    } catch (err) {
      console.error('写入维护日志失败:', err);
      alert('写入失败，请检查配置');
    }
  };

  return (
    <div>
      <div className="card">
        <div className="flex justify-between items-center mb-16">
          <div className="card-title" style={{ marginBottom: 0 }}>维护日志</div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            添加日志
          </button>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="empty">暂无维护日志</div>
        ) : (
          <div className="log-list">
            {logs.map(log => (
              <div key={log.id} className="log-item">
                <div className="log-header">
                  <span className="log-version">{log.version}</span>
                  <span className="log-time">{dayjs(log.createdAt).format('YYYY-MM-DD HH:mm')}</span>
                </div>
                <div className="log-content">{log.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">版本更新说明</div>
        <div style={{ lineHeight: 1.8, color: '#4e5969' }}>
          <p>📝 每次版本更新后，填写版本号和更新内容，系统会自动记录到维护日志表中</p>
          <p>🔄 日志按时间倒序排列，最新的日志显示在最上方</p>
          <p>📊 维护日志存储在飞书多维表格的「维护日志」表中</p>
        </div>
      </div>

      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 8,
            padding: 24,
            width: 500,
            maxHeight: '90vh',
            overflow: 'auto',
          }}>
            <h3 style={{ marginBottom: 16 }}>添加维护日志</h3>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  版本号
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={formData.version}
                  onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                  placeholder="如：v1.2.0"
                  required
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  更新内容
                </label>
                <textarea
                  className="input"
                  style={{ width: '100%', minHeight: 120, resize: 'vertical' }}
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="描述本次版本更新的功能内容..."
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaintenanceLog;
