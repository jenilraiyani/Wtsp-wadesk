import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { SidebarProvider } from './component/SidebarContext';
import ProtectedRoute from './component/ProtectedRoute';
import Layout from './component/layout';
import Campaigns from './page/bulkSend';
import Personalize from './page/Personalize';
import Devices from './page/allDevices';
import Compose from './page/sendMessage';
import Login from './page/Login';
import Users from './page/Users';
import Dashboard from './page/Dashboard';
import History from './page/History';
import Privacy from './page/Privacy';
import Automation from './page/Automation';
import AutomationLogs from './page/AutomationLogs';
import Templates from './page/Templates';
import Contacts from './page/Contacts';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SidebarProvider>
          <div className="app-frame">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                  <Route index element={<Dashboard />} />
                  <Route path="devices" element={<Devices />} />
                  <Route path="compose" element={<Compose />} />
                  <Route path="campaigns" element={<Campaigns />} />
                  <Route path="personalize" element={<Personalize />} />
                  <Route path="templates" element={<Templates />} />
                  <Route path="contacts" element={<Contacts />} />
                  <Route path="automation" element={<Automation />} />
                  <Route path="automation/logs" element={<AutomationLogs />} />
                  <Route path="history" element={<History />} />
                  <Route path="privacy" element={<Privacy />} />
                  <Route path="users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
                </Route>
              </Routes>
            </div>
        </SidebarProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
