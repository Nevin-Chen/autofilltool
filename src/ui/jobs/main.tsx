import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JobsApp } from './JobsApp';
import '../styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('jobs: #root not found');

createRoot(container).render(
  <StrictMode>
    <JobsApp />
  </StrictMode>,
);
