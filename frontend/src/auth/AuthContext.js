import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiJson, clearAuth, getStoredUser, getToken, setAuth } from '../api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(getStoredUser());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            setUser(null);
            setLoading(false);
            return;
        }

        apiJson('/api/auth/me')
            .then(({ res, data }) => {
                if (res.ok && data.user) {
                    setUser(data.user);
                    setAuth(token, data.user);
                } else {
                    clearAuth();
                    setUser(null);
                }
            })
            .catch(() => {
                setUser(getStoredUser());
            })
            .finally(() => setLoading(false));
    }, []);

    const login = async (email, password) => {
        const { res, data } = await apiJson('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        if (!res.ok || !data.token) {
            throw new Error(data.error || 'Login failed');
        }
        setAuth(data.token, data.user);
        setUser(data.user);
        return data.user;
    };

    const loginWithGoogle = async (credential) => {
        const { res, data } = await apiJson('/api/auth/google', {
            method: 'POST',
            body: JSON.stringify({ credential })
        });
        if (!res.ok || !data.token) {
            throw new Error(data.error || 'Google login failed');
        }
        setAuth(data.token, data.user);
        setUser(data.user);
        return data.user;
    };

    const logout = () => {
        clearAuth();
        setUser(null);
    };

    const value = useMemo(() => ({
        user,
        loading,
        login,
        loginWithGoogle,
        logout,
        isAdmin: user?.role === 'admin'
    }), [user, loading]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used inside AuthProvider');
    }
    return context;
};
