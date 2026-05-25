import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OptionsApp } from './OptionsApp';
import '../styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('options: #root not found');

createRoot(container).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);
