import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// NOTE: React.StrictMode is intentionally not used. StrictMode double-mounts
// components in development only, which breaks @cardknox/react-ifields: the
// iframe postMessage handshake (placeholder/style/config) is lost on the
// simulated unmount/remount, so the secure card fields render blank and reject
// input on dev while working in production (where StrictMode is inactive).
ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
