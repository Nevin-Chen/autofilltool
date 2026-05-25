import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from './PopupApp';
import '../styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('popup: #root not found');

createRoot(container).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
