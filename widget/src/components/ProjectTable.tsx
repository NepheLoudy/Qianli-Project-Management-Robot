import React, { useState, useEffect, Fragment } from 'react';
import dayjs from 'dayjs';
import { projectApi, Project } from '../api';

const ProjectTable: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    owner: '',
    ddl: '',
    priority: 'medium' as 'high' | 'medium' | 'low',
    status: 'pending' as 'pending' | 'in_progress' | 'completed',
    category: '其他',
    fileToken: '',
    parentId: '',
  });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await projectApi.getProjectsWithHierarchy();
      setProjects(data);
    } catch (err) {
      console.error('加载项目失败:', err);
      const flatData = await projectApi.getProjects();
      setProjects(flatData);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingProject(null);
    setFormData({
      name: '',
      owner: '',
      ddl: '',
      priority: 'medium',
      status: 'pending',
      category: '其他',
      fileToken: '',
      parentId: '',
    });
    setShowModal(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      owner: project.owner,
      ddl: project.ddl,
      priority: project.priority,
      status: project.status,
      category: project.category || '其他',
      fileToken: project.fileToken || '',
      parentId: project.parentId || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该项目吗？')) return;
    try {
      await projectApi.deleteProject(id);
      await loadProjects();
    } catch (err) {
      console.error('删除失败:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingProject) {
        await projectApi.updateProject(editingProject.id, formData);
      } else {
        await projectApi.createProject(formData);
      }
      setShowModal(false);
      await loadProjects();
    } catch (err) {
      console.error('保存失败:', err);
    }
  };

  const getPriorityBadge = (priority: string) => {
    const map: Record<string, string> = {
      high: 'badge-high',
      medium: 'badge-medium',
      low: 'badge-low',
    };
    const textMap: Record<string, string> = {
      high: '高',
      medium: '中',
      low: '低',
    };
    return <span className={`badge ${map[priority]}`}>{textMap[priority]}</span>;
  };

  const getStatusText = (status: string) => {
    const map: Record<string, string> = {
      pending: '待开始',
      in_progress: '进行中',
      completed: '已完成',
    };
    return map[status] || status;
  };

  const getDaysLeft = (ddl: string) => {
    const days = dayjs(ddl).diff(dayjs(), 'day');
    return days;
  };

  const getDDLClass = (ddl: string) => {
    const days = getDaysLeft(ddl);
    if (days < 0) return 'text-red';
    if (days <= 2) return 'text-orange';
    return '';
  };

  const renderProjects = (items: Project[], level: number) => {
    return items.map(p => (
      <Fragment key={p.id}>
        <tr>
          <td style={{ paddingLeft: `${level * 20 + 8}px` }}>
            {level > 0 && <span style={{ marginRight: 4 }}>└─</span>}
            {p.name}
          </td>
          <td>{p.category || '其他'}</td>
          <td>{p.ownerName}</td>
          <td className={getDDLClass(p.ddl)}>
            {dayjs(p.ddl).format('YYYY-MM-DD')}
            <span className="text-sm text-gray" style={{ marginLeft: 4 }}>
              ({getDaysLeft(p.ddl) >= 0 ? `${getDaysLeft(p.ddl)}天` : '已逾期'})
            </span>
          </td>
          <td>{getPriorityBadge(p.priority)}</td>
          <td>{getStatusText(p.status)}</td>
          <td>
            <button
              className="btn btn-secondary"
              style={{ marginRight: 8, padding: '4px 12px' }}
              onClick={() => handleEdit(p)}
            >
              编辑
            </button>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 12px', color: '#f53f3f' }}
              onClick={() => handleDelete(p.id)}
            >
              删除
            </button>
          </td>
        </tr>
        {p.children && p.children.length > 0 && renderProjects(p.children, level + 1)}
      </Fragment>
    ));
  };

  return (
    <div>
      <div className="card">
        <div className="flex justify-between items-center mb-16">
          <div className="card-title" style={{ marginBottom: 0 }}>项目列表</div>
          <button className="btn btn-primary" onClick={handleAdd}>
            新增项目
          </button>
        </div>

        {loading ? (
          <div className="loading">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="empty">暂无项目，点击右上角新增</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>分组</th>
                <th>负责人</th>
                <th>截止日期</th>
                <th>优先级</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {renderProjects(projects, 0)}
            </tbody>
          </table>
        )}
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
            <h3 style={{ marginBottom: 16 }}>
              {editingProject ? '编辑项目' : '新增项目'}
            </h3>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  项目名称
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  负责人
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={formData.owner}
                  onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
                  placeholder="输入飞书用户ID（如：ou_xxxx）"
                />
                <div style={{ fontSize: 12, color: '#86909c', marginTop: 4 }}>
                  姓名将从飞书人员信息自动获取
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  截止日期
                </label>
                <input
                  type="date"
                  className="input"
                  style={{ width: '100%' }}
                  value={formData.ddl}
                  onChange={(e) => setFormData({ ...formData, ddl: e.target.value })}
                  required
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  优先级
                </label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                >
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  状态
                </label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                >
                  <option value="pending">待开始</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">已完成</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  分组
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="如：产品组、研发组"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  父项目
                </label>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={formData.parentId}
                  onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                >
                  <option value="">无（作为父项目）</option>
                  {projects.filter(p => p.id !== editingProject?.id).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  关联文档Token
                </label>
                <input
                  className="input"
                  style={{ width: '100%' }}
                  value={formData.fileToken}
                  onChange={(e) => setFormData({ ...formData, fileToken: e.target.value })}
                  placeholder="可选，关联的飞书文档token"
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

export default ProjectTable;
