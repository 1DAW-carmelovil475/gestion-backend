// ============================================
// HOLA INFORMÁTICA - BACKEND SERVER
// Express + Supabase + JWT Auth
// ============================================

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================
// SUPABASE (con service_role key - acceso total)
// ============================================
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// MIDDLEWARES
// ============================================
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());

// ============================================
// MIDDLEWARE: Verificar JWT en rutas protegidas
// ============================================
function authGuard(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado. Token requerido.' });
    }
    try {
        const token = header.split(' ')[1];
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido o expirado.' });
    }
}

// ============================================
// RUTA: LOGIN
// POST /api/auth/login
// Body: { usuario, password }
// ============================================
app.post('/api/auth/login', (req, res) => {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }

    if (
        usuario  !== process.env.ADMIN_USER ||
        password !== process.env.ADMIN_PASSWORD
    ) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = jwt.sign(
        { usuario, rol: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );

    return res.json({ ok: true, token, usuario, rol: 'admin' });
});

// ============================================
// RUTA: VERIFICAR TOKEN
// GET /api/auth/verify
// ============================================
app.get('/api/auth/verify', authGuard, (req, res) => {
    res.json({ ok: true, user: req.user });
});

// ============================================
// RUTAS: EMPRESAS
// ============================================
app.get('/api/empresas', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('empresas')
        .select('*')
        .order('nombre');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/empresas', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('empresas')
        .insert(req.body)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.put('/api/empresas/:id', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('empresas')
        .update(req.body)
        .eq('id', req.params.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/empresas/:id', authGuard, async (req, res) => {
    const { error } = await supabase
        .from('empresas')
        .delete()
        .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: DISPOSITIVOS (IT)
// ============================================
app.get('/api/dispositivos', authGuard, async (req, res) => {
    const { empresa_id, categoria } = req.query;
    let query = supabase.from('dispositivos').select('*').order('nombre');
    if (empresa_id) query = query.eq('empresa_id', empresa_id);
    if (categoria)  query = query.eq('categoria', categoria);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/dispositivos', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('dispositivos')
        .insert(req.body)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.put('/api/dispositivos/:id', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('dispositivos')
        .update(req.body)
        .eq('id', req.params.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/dispositivos/:id', authGuard, async (req, res) => {
    const { error } = await supabase
        .from('dispositivos')
        .delete()
        .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: CONTRATOS
// ============================================
app.get('/api/contratos', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('contratos')
        .select('*, empresas(nombre)')
        .order('fecha_fin');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/contratos', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('contratos')
        .insert(req.body)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.delete('/api/contratos/:id', authGuard, async (req, res) => {
    const { error } = await supabase
        .from('contratos')
        .delete()
        .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: FACTURAS
// ============================================
app.get('/api/facturas', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('facturas')
        .select('*, empresas(nombre)')
        .order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/facturas', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('facturas')
        .insert(req.body)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.delete('/api/facturas/:id', authGuard, async (req, res) => {
    const { error } = await supabase
        .from('facturas')
        .delete()
        .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: TICKETS
// ============================================
app.get('/api/tickets', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('tickets')
        .select('*, empresas(nombre)')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/tickets', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('tickets')
        .insert(req.body)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.put('/api/tickets/:id', authGuard, async (req, res) => {
    const { data, error } = await supabase
        .from('tickets')
        .update(req.body)
        .eq('id', req.params.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/tickets/:id', authGuard, async (req, res) => {
    const { error } = await supabase
        .from('tickets')
        .delete()
        .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ ok: true, message: 'Hola Informática API running' });
});

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend corriendo en http://localhost:${PORT}`);
});
