import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App.js';
import { ErrorBoundary } from './app/ErrorBoundary.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
);
