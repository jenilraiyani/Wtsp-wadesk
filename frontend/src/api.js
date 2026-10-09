const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export const getToken = () => localStorage.getItem('wa_token');

export const getStoredUser = () => {
    try {
        return JSON.parse(localStorage.getItem('wa_user') || 'null');
    } catch {
        return null;
    }
};

export const setAuth = (token, user) => {
    localStorage.setItem('wa_token', token);
    localStorage.setItem('wa_user', JSON.stringify(user));
};

export const clearAuth = () => {
    localStorage.removeItem('wa_token');
    localStorage.removeItem('wa_user');
};

export const authHeaders = (extra = {}) => {
    const token = getToken();
    const headers = { ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
};

export const apiFetch = async (path, options = {}) => {
    const headers = {
        ...authHeaders(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {})
    };

    const res = await fetch(`${API_URL}${path}`, { ...options, headers });

    if (res.status === 401 && !path.startsWith('/api/auth/login')) {
        clearAuth();
        if (!window.location.pathname.startsWith('/login')) {
            window.location.href = '/login';
        }
    }

    return res;
};

export const apiJson = async (path, options = {}) => {
    const res = await apiFetch(path, options);
    const data = await res.json().catch(() => ({}));
    return { res, data };
};

export { API_URL };
