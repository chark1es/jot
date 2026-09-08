import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@jolt/tokens/tokens.css';
import App from './App';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('root element missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
