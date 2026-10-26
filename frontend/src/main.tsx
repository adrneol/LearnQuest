import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { AppErrorBoundary } from './app/App';
import './styles/index.css';
import { StoreProvider } from './app/store';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
