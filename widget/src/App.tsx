import React, { useState } from 'react';
import ProjectTable from './components/ProjectTable';
import DDLBoard from './components/DDLBoard';
import MaintenanceLog from './components/MaintenanceLog';
import KeywordTracker from './components/KeywordTracker';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'project' | 'ddl' | 'log' | 'keyword'>('project');

  const tabs = [
    { key: 'project', label: '项目管理' },
    { key: 'ddl', label: 'DDL看板' },
    { key: 'log', label: '维护日志' },
    { key: 'keyword', label: '关键词监听' },
  ];

  return (
    <div className="app">
      <div className="tabs">
        {tabs.map(tab => (
          <div
            key={tab.key}
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {activeTab === 'project' && <ProjectTable />}
      {activeTab === 'ddl' && <DDLBoard />}
      {activeTab === 'log' && <MaintenanceLog />}
      {activeTab === 'keyword' && <KeywordTracker />}
    </div>
  );
};

export default App;
