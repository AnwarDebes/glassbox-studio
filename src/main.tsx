import '@fontsource-variable/instrument-sans/standard.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { capturePwaEvents, registerServiceWorker } from './app/pwa';

capturePwaEvents();
void registerServiceWorker();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
