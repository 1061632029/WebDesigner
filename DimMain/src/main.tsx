import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

/**
 * 应用入口
 * 将根组件 App 渲染到 DOM 中的 #root 元素
 */
const rootElement: HTMLElement | null = document.getElementById('root');

if (rootElement) {
  const root: ReactDOM.Root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
