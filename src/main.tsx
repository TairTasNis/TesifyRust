/**
 * @fileoverview Main application backend module
 * @copyright Copyright (c) 2026 Tair Tasmukhambetov (@ttfotg)
 * @license TFG License
 * @see {@link ../LICENSE} for full terms and commercial requirement (10% gross royalty).
 * Commercial contact: Telegram @ttfotg | tasmuhambetovtair@gmail.com
 */

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './material3.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
