import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { AppErrorBoundary } from './app/App';
import './styles/index.css';
import { StoreProvider } from './app/store';
import { initTheme } from './app/theme';

// Reconcile the pre-paint theme and subscribe to system preference changes.
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
