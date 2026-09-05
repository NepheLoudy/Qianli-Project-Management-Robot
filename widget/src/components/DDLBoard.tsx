import React, { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { projectApi, DDLAlert, botApi } from '../api';

const DDLBoard: React.FC = () => {
  const [alerts, setAlerts] = useState<DDLAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [days, setDays] = useState(7);

  useEffect(() => {
    loadAlerts();
  }, [days]);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const data = await projectApi.getDDLAlerts(days);
      setAlerts(data);
    } catch (err) {
      console.error('加载DDL提醒失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestBroadcast = async () => {
    setTesting(true);
    try {
      const data = await botApi.testBroadcast();
      // 今日已播报过时后端返回 skipped=true：如实提示，不弹「已发送」假成功
      if (data && data.skipped) {
        alert(data.message || '今日已播报过，未重复发送');
      } else {
        alert('测试播报已发送');
      }
    } catch (err) {
      console.error('测试播报失败:', err);
      alert('测试播报失败，请检查后端服务');
    } finally {
      setTesting(false);
    }
  };

  const getUrgencyBadge = (daysLeft: number) => {
    if (daysLeft < 0) {
      return <span className="badge badge-urgent">已逾期</span>;
    }
    if (daysLeft <= 2) {
      return <span className="badge badge-high">紧急</span>;
    }
    if (daysLeft <= 5) {
      return <span className="badge badge-medium">临近</span>;
    }
    return <span className="badge badge-low">正常</span>;
  };

  const getPriorityText = (priority: string) => {
    const map: Record<string, string> = {
      high: '高',
      medium: '中',
      low: '低',
    };
    return map[priority] || priority;
  };

  const urgentCount = alerts.filter(a => a.daysLeft >= 0 && a.daysLeft <= 2).length;
  const overdueCount = alerts.filter(a => a.daysLeft < 0).length;

  return (
    <div>
      <div className="card">
        <div className="flex justify-between items-center mb-16">
          <div className="flex items-center gap-8">
            <select
              className="select"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={2}>2天内</option>
              <option value={7}>7天内</option>
              <option value={14}>14天内</option>
              <option value={30}>30天内</option>
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleTestBroadcast}
            disabled={testing}
          >
            {testing ? '发送中...' : '测试播报'}
          </button>
        </div>

        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-value" style={{ color: '#3370ff' }}>{alerts.length}</div>
            <div className="stat-label">{days}天内DDL</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-red">{overdueCount}</div>
            <div className="stat-label">已逾期</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-orange">{urgentCount}</div>
            <div className="stat-label">2天内到期</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-green">
              {alerts.filter(a => a.daysLeft > 2).length}
            </div>
            <div className="stat-label">正常推进</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">DDL详情</div>
        {loading ? (
          <div className="loading">加载中...</div>
        ) : alerts.length === 0 ? (
          <div className="empty">暂无DDL提醒</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>负责人</th>
                <th>截止日期</th>
                <th>剩余天数</th>
                <th>优先级</th>
                <th>紧急程度</th>
              </tr>
            </thead>
            <tbody>
              {alerts
                .sort((a, b) => a.daysLeft - b.daysLeft)
                .map(alert => (
                  <tr key={alert.projectId}>
                    <td>{alert.projectName}</td>
                    <td>{alert.ownerName}</td>
                    <td>{dayjs(alert.ddl).format('YYYY-MM-DD')}</td>
                    <td className={alert.daysLeft < 0 ? 'text-red' : alert.daysLeft <= 2 ? 'text-orange' : ''}>
                      {alert.daysLeft >= 0 ? `${alert.daysLeft}天` : `逾期${Math.abs(alert.daysLeft)}天`}
                    </td>
                    <td>{getPriorityText(alert.priority)}</td>
                    <td>{getUrgencyBadge(alert.daysLeft)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">播报说明</div>
        <div style={{ lineHeight: 1.8, color: '#4e5969' }}>
          <p>📢 群机器人每天 <strong>12:00</strong> 自动播报DDL情况</p>
          <p>⚠️ 对于 <strong>2天内到期</strong> 的项目，会 @ 对应负责人</p>
          <p>📋 播报内容包括：逾期项目、2天内到期项目、本周到期项目概览</p>
        </div>
      </div>
    </div>
  );
};

export default DDLBoard;
