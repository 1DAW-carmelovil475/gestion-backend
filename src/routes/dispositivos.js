const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard } = require('../middleware/auth');

router.get('/', authGuard, async (req, res) => {
    const { empresa_id, categoria } = req.query;
    let query = supabaseAdmin.from('dispositivos').select('*').order('nombre');
    if (empresa_id) query = query.eq('empresa_id', empresa_id);
    if (categoria)  query = query.eq('categoria', categoria);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

const CATEGORIAS_VALIDAS = ['equipo', 'servidor', 'nas', 'red', 'correo', 'otro', 'web'];

function sanitizeDisp(str, max = 300) {
    if (!str) return null;
    return String(str).trim().replace(/<[^>]*>/g, '').substring(0, max) || null;
}

function buildSafeDisp(body) {
    return {
        empresa_id:       body.empresa_id,
        categoria:        CATEGORIAS_VALIDAS.includes(body.categoria) ? body.categoria : 'otro',
        nombre:           sanitizeDisp(body.nombre, 200),
        tipo:             sanitizeDisp(body.tipo, 100),
        ip:               sanitizeDisp(body.ip, 50),
        usuario:          sanitizeDisp(body.usuario, 100),
        password:         sanitizeDisp(body.password, 200),
        anydesk_id:       sanitizeDisp(body.anydesk_id, 50),
        sistema_operativo:sanitizeDisp(body.sistema_operativo, 100),
        capacidad:        sanitizeDisp(body.capacidad, 50),
        modelo:           sanitizeDisp(body.modelo, 100),
        numero_serie:     sanitizeDisp(body.numero_serie, 100),
        nombre_cliente:   sanitizeDisp(body.nombre_cliente, 200),
        correo_cliente:   sanitizeDisp(body.correo_cliente, 200),
        password_cliente: sanitizeDisp(body.password_cliente, 200),
        url:              sanitizeDisp(body.url, 500),
        campos_extra:     (typeof body.campos_extra === 'object' && !Array.isArray(body.campos_extra)) ? body.campos_extra : {},
    };
}

router.post('/', authGuard, async (req, res) => {
    const safe = buildSafeDisp(req.body);
    const { data, error } = await supabaseAdmin.from('dispositivos').insert(safe).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

router.put('/:id', authGuard, async (req, res) => {
    const safe = buildSafeDisp(req.body);
    const { data, error } = await supabaseAdmin
        .from('dispositivos').update(safe).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('dispositivos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

module.exports = router;