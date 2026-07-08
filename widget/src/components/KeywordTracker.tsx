import React, { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { keywordApi, KeywordRecord } from '../api';

const KeywordTracker: React.FC = () => {
  const [records, setRecords] = useState<KeywordRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<{ enabled: boolean; keywords: string[] }>({
    enabled: false,
    keywords: [],
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadConfig();
    loadRecords();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await keywordApi.getConfig();
      setConfig(data);
    } catch (err) {
      console.error('加载关键词配置失败:', err);
    }
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await keywordApi.getRecords();
      setRecords(data.items);
      const allGroupIds = data.items.map((item: any) => item.record_id);
      setExpandedGroups(new Set(allGroupIds));
    } catch (err) {
      console.error('加载关键词记录失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (recordId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  };

  const getFieldValue = (fields: any, fieldName: string): string => {
    const value = fields[fieldName];
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((v: any) => v.text || v.name || v).join(', ');
    }
    if (typeof value === 'object') {
      if (value.text) return value.text;
      if (value.link) return value.link;
    }
    return String(value);
  };

  const getMessageLink = (fields: any): string => {
    const value = fields['消息链接'];
    if (value && typeof value === 'object' && value.link) return value.link;
    if (typeof value === 'string') return value;
    return '';
  };

  const getImages = (fields: any): string[] => {
    const value = fields['图片'];
    if (Array.isArray(value)) {
      return value.map((v: any) => v.file_token || v);
    }
    return [];
  };

  const isParentRecord = (record: any): boolean => {
    const children = record.children;
    return children && children.length > 0;
  };

  const formatTime = (timeStr: string): string => {
    if (!timeStr) return '-';
    try {
      return dayjs(timeStr).format('MM-DD HH:mm');
    } catch {
      return '-';
    }
  };

  return (
    <div>
      <div className="card">
        <div className="flex justify-between items-center mb-16">
          <div className="card-title" style={{ marginBottom: 0 }}>群聊关键词监听</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={loadRecords}>
              刷新
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 16, padding: 12, background: '#f7f8fa', borderRadius: 6 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>
            监听状态：
            <span style={{ color: config.enabled ? '#00b42a' : '#86909c', marginLeft: 4 }}>
              {config.enabled ? '已启用' : '未启用'}
            </span>
          </div>
          <div>
            <span style={{ color: '#4e5969' }}>监听关键词：</span>
            {config.keywords.length > 0 ? (
              config.keywords.map((kw, idx) => (
                <span
                  key={idx}
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    marginRight: 6,
                    background: '#e8f3ff',
                    color: '#165dff',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {kw}
                </span>
              ))
            ) : (
              <span style={{ color: '#86909c' }}>暂无</span>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#86909c' }}>
            提示：修改关键词配置文件后需重启服务生效。数据以「关键词分组 - 消息记录」的父子层级结构展示。
          </div>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : records.length === 0 ? (
          <div className="empty">暂无关键词记录</div>
        ) : (
          <div>
            {records.map((group: any, groupIndex: number) => {
              const groupName = getFieldValue(group.fields, '组别');
              const isExpanded = expandedGroups.has(group.record_id);
              const children = group.children || [];

              return (
                <div key={group.record_id} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: '#e8f3ff',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleGroup(group.record_id)}
                  >
                    <span style={{ marginRight: 8, fontSize: 12 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <span style={{
                      fontWeight: 600,
                      color: '#165dff',
                      fontSize: 14,
                    }}>
                      {groupName || '未命名分组'}
                    </span>
                    <span style={{
                      marginLeft: 'auto',
                      fontSize: 12,
                      color: '#4e5969',
                      background: '#fff',
                      padding: '2px 8px',
                      borderRadius: 10,
                    }}>
                      {children.length} 条记录
                    </span>
                  </div>

                  {isExpanded && children.length > 0 && (
                    <div style={{ overflowX: 'auto', marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: 130 }}>时间</th>
                            <th style={{ width: 100 }}>发送人</th>
                            <th>消息内容</th>
                            <th style={{ width: 70 }}>图片</th>
                            <th style={{ width: 80 }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {children.map((child: any) => {
                            const fields = child.fields || {};
                            const time = getFieldValue(fields, '时间');
                            const sender = getFieldValue(fields, '发送人');
                            const content = getFieldValue(fields, '消息内容');
                            const images = getImages(fields);
                            const link = getMessageLink(fields);

                            return (
                              <tr key={child.record_id}>
                                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                                  {formatTime(time)}
                                </td>
                                <td style={{ fontSize: 13 }}>{sender || '-'}</td>
                                <td>
                                  <div style={{
                                    fontSize: 13,
                                    lineHeight: 1.5,
                                    maxWidth: 400,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                  }}>
                                    {content || '-'}
                                  </div>
                                </td>
                                <td>
                                  {images.length > 0 ? (
                                    <span style={{ color: '#165dff', fontSize: 12 }}>
                                      {images.length}张
                                    </span>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                                <td>
                                  {link ? (
                                    <a
                                      href={link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: '#165dff', textDecoration: 'none', fontSize: 12 }}
                                    >
                                      查看消息
                                    </a>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {isExpanded && children.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: '#86909c', fontSize: 13 }}>
                      暂无消息记录
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">功能说明</div>
        <div style={{ lineHeight: 1.8, color: '#4e5969' }}>
          <p>🔍 自动监听群聊消息，匹配预设关键词后自动记录</p>
          <p>📁 按关键词分组，以父子层级结构展示（父记录=关键词，子记录=消息）</p>
          <p>📝 记录内容包括：时间、发送人、消息内容、图片、消息链接</p>
          <p>⚙️ 关键词配置文件：<code>server/src/config/keywords.json</code></p>
          <p>📊 数据存储在飞书多维表格的「关键词监听」表中</p>
        </div>
      </div>
    </div>
  );
};

export default KeywordTracker;
