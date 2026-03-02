// ============================================
// HOLA INFORMÁTICA — BACKEND SERVER
// ============================================

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsOptions = {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Inicializar email transporter ─────────────────────────────────────────────
require('./helpers/email');

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ── RUTAS ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',                    require('./routes/auth'));
app.use('/api/usuarios',                require('./routes/usuarios'));
app.use('/api/empresas',                require('./routes/empresas'));
app.use('/api/dispositivos',            require('./routes/dispositivos'));
app.use('/api/tickets',                 require('./routes/tickets'));         // legacy v1
app.use('/api/v2/operarios',            require('./routes/operarios'));
app.use('/api/v2/tickets',              require('./routes/ticketsV2'));
app.use('/api/v2/estadisticas',         require('./routes/estadisticas'));
app.use('/api/v2/chat',                 require('./routes/chat'));
app.use('/api/v2',                      require('./routes/recursos'));        // archivos, horas, comentarios sueltos

// ── CATCH-ALL ─────────────────────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
    console.error('Error no controlado:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

// ── ARRANQUE ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`   Backend corriendo en http://localhost:${PORT}`);
    console.log(`   Supabase: ${process.env.SUPABASE_URL}`);
    console.log(`   Frontend: ${process.env.FRONTEND_URL || '*'}`);
});