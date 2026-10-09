import React, { createContext, useContext, useMemo, useState } from 'react';

export const SidebarContext = createContext(null);

export const SidebarProvider = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const value = useMemo(() => ({
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar: () => setSidebarOpen((open) => !open),
    closeSidebar: () => setSidebarOpen(false)
  }), [sidebarOpen]);

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => useContext(SidebarContext);
