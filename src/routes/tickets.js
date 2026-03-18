const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');
const { registrarHistorial } = require('../helpers/historial');

const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Urgente'];
const ESTADOS     = ['Pendiente', 'En curso', 'Completado', 'Pendiente de facturar', 'Facturado'];
function s(str, max = 500) {
    if (!str) return null;
    return String(str).trim().replace(/<[^>]*>/g, '').substring(0, max) || null;
}

router.get('/', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .select('id, numero, asunto, descripcion, prioridad, estado, created_at, empresa_id, empresas(id, nombre)')
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.post('/', authGuard, async (req, res) => {
    const { empresa_id } = req.body;
    const asunto = s(req.body.asunto, 200);
    if (!empresa_id || !asunto) return res.status(400).json({ error: 'empresa_id y asunto son obligatorios.' });
    const prioridad = PRIORIDADES.includes(req.body.prioridad) ? req.body.prioridad : 'Media';
    const estado    = ESTADOS.includes(req.body.estado)        ? req.body.estado    : 'Pendiente';
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .insert({ empresa_id, asunto, descripcion: s(req.body.descripcion, 2000), prioridad, estado, created_by: req.user.id })
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    await registrarHistorial(data.id, req.user.id, 'creacion', `Ticket creado por ${req.user.nombre || req.user.email}`);
    res.status(201).json(data);
});

router.put('/:id', authGuard, async (req, res) => {
    const estado = ESTADOS.includes(req.body.estado) ? req.body.estado : undefined;
    const updates = {};
    if (req.body.asunto)      updates.asunto      = s(req.body.asunto, 200);
    if (req.body.descripcion !== undefined) updates.descripcion = s(req.body.descripcion, 2000);
    if (req.body.prioridad && PRIORIDADES.includes(req.body.prioridad)) updates.prioridad = req.body.prioridad;
    if (estado) {
        updates.estado = estado;
        if (estado === 'En curso')               updates.started_at   = new Date().toISOString();
        if (estado === 'Completado')             updates.completed_at = new Date().toISOString();
        if (estado === 'Pendiente de facturar')  updates.completed_at = new Date().toISOString();
        if (estado === 'Facturado')              updates.invoiced_at  = new Date().toISOString();
    }
    const { data, error } = await supabaseAdmin
        .from('tickets_v2').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/:id', authGuard, adminGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('tickets_v2').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

module.exports = router;