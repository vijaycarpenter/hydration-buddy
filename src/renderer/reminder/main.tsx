import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { ReminderPopup } from './ReminderPopup';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReminderPopup />
  </StrictMode>,
);
