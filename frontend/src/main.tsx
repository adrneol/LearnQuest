import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { AppErrorBoundary } from './app/App';
import './styles/index.css';
import { StoreProvider } from './app/store';
import { initTheme } from './app/theme';

// Re-assert the saved theme (the inline script in index.html already ran;
// this covers dev HMR / embedded hosts and keeps the DOM attribute canonical).
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
